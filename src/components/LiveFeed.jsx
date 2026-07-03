import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, Clock, Radio, Zap, Users } from 'lucide-react';

// Map ESPN event type IDs / text to a category
function classifyEvent(type) {
  if (!type) return 'default';
  const text = (type.text || '').toLowerCase();
  const id = String(type.id || '');
  if (text.includes('goal') || id === '59' || id === '70') return 'goal';
  if (id === '63') return 'red';
  if (id === '60' || id === '62') return 'yellow';
  if (text.includes('substitut') || text.includes('sub') || id === '61') return 'sub';
  if (text.includes('half') || text.includes('kick off') || text.includes('full time') || text.includes('end') || text.includes('start') || id === '65' || id === '68' || id === '69') return 'milestone';
  if (text.includes('penalty') || id === '71') return 'penalty';
  if (text.includes('var') || text.includes('review')) return 'var';
  return 'default';
}

function formatStatValue(statName, rawValue) {
  const val = parseFloat(rawValue);
  if (isNaN(val)) return rawValue;
  if (statName === 'possessionPct') return rawValue + '%';
  return rawValue;
}

const STAT_SECTION = {
  totalShots: 'Shooting', shotsOnTarget: 'Shooting',
  blockedShots: 'Shooting', penaltyKickGoals: 'Shooting', penaltyKickShots: 'Shooting',
  insideBoxAttempts: 'Shooting', outsideBoxAttempts: 'Shooting', hitWoodwork: 'Shooting',
  possessionPct: 'Possession & Passing',
  totalPasses: 'Possession & Passing',
  totalCrosses: 'Possession & Passing',
  totalLongBalls: 'Possession & Passing', wonCorners: 'Possession & Passing',
  saves: 'Defense',
  totalTackles: 'Defense',
  interceptions: 'Defense',
  totalClearance: 'Defense',
  foulsCommitted: 'Discipline',
  yellowCards: 'Discipline', redCards: 'Discipline', offsides: 'Discipline',
};

const SECTION_ORDER = ['Shooting', 'Possession & Passing', 'Defense', 'Discipline'];

const STAT_ORDER = [
  'totalShots', 'shotsOnTarget',
  'insideBoxAttempts', 'outsideBoxAttempts', 'hitWoodwork',
  'blockedShots', 'penaltyKickGoals', 'penaltyKickShots',
  'possessionPct', 'totalPasses',
  'totalCrosses',
  'totalLongBalls', 'wonCorners',
  'saves', 'totalTackles',
  'interceptions', 'totalClearance',
  'foulsCommitted', 'yellowCards', 'redCards', 'offsides',
];

function eventIcon(category) {
  switch (category) {
    case 'goal':    return '⚽';
    case 'red':     return '🟥';
    case 'yellow':  return '🟨';
    case 'sub':     return '🔄';
    case 'penalty': return '🎯';
    case 'milestone': return '🕐';
    case 'var':     return '📺';
    default:        return '•';
  }
}

// Compute hypothetical points for a single prediction against a current (live) score
function calcLivePoints(pred, match, liveHomeScore, liveAwayScore, liveTotalCards, liveFirstScorer, liveHighestHalf, liveCleanSheet) {
  if (!pred) return { total: 0, breakdown: {} };

  const homeScore = liveHomeScore;
  const awayScore = liveAwayScore;

  let winnerResult = 'draw';
  if (homeScore > awayScore) winnerResult = 'home';
  else if (awayScore > homeScore) winnerResult = 'away';
  else winnerResult = 'draw';

  const ouLine = match.over_under_line || 2.5;
  const totalGoals = homeScore + awayScore;
  const ouResult = totalGoals > ouLine ? 'over' : 'under';

  // Winner: 3 pts
  const pWinner = pred.predicted_winner === winnerResult ? 3 : 0;

  // O/U: 1 pt
  const pOu = pred.predicted_over_under === ouResult ? 1 : 0;

  // Exact score: 4 pts
  const pScore = (
    pred.predicted_home_score !== null &&
    pred.predicted_away_score !== null &&
    pred.predicted_home_score === homeScore &&
    pred.predicted_away_score === awayScore
  ) ? 4 : 0;

  // Underdog bonus: 1 pt
  let pUnderdog = 0;
  if (pWinner > 0 && match.home_win_pct != null && match.away_win_pct != null && match.draw_pct != null) {
    const maxPct = Math.max(match.home_win_pct, match.away_win_pct, match.draw_pct);
    if (winnerResult === 'home' && match.home_win_pct < maxPct) pUnderdog = 1;
    else if (winnerResult === 'away' && match.away_win_pct < maxPct) pUnderdog = 1;
    else if (winnerResult === 'draw' && match.draw_pct < maxPct) pUnderdog = 1;
  }

  // Clean sheet: 1 pt
  const pCleanSheet = pred.predicted_clean_sheet === liveCleanSheet ? 1 : 0;

  // Total Cards: 3 pts
  const pTotalCards = (pred.predicted_total_cards !== null && pred.predicted_total_cards === liveTotalCards) ? 3 : 0;

  // First Scorer: 2 pts
  const pFirstScorer = (pred.predicted_first_scorer && liveFirstScorer && pred.predicted_first_scorer === liveFirstScorer) ? 2 : 0;

  // Highest Scoring Half: 2 pts
  const pHalf = (pred.predicted_highest_scoring_half && liveHighestHalf && pred.predicted_highest_scoring_half === liveHighestHalf) ? 2 : 0;

  const total = pWinner + pOu + pScore + pUnderdog + pCleanSheet + pTotalCards + pFirstScorer + pHalf;

  return {
    total,
    breakdown: { pWinner, pOu, pScore, pUnderdog, pCleanSheet, pTotalCards, pFirstScorer, pHalf },
  };
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds when live

export default function LiveFeed({ espnEventId, matchStatus, homeCode, awayCode, match = null, tab, onScoreUpdate }) {
  const [commentary, setCommentary] = useState([]);
  const [stats, setStats] = useState([]);
  const [liveScore, setLiveScore] = useState({ home: null, away: null });
  const [goalsByHalf, setGoalsByHalf] = useState({ homeFirst: 0, homeSecond: 0, awayFirst: 0, awaySecond: 0 });
  const [liveStats, setLiveStats] = useState({
    totalCards: 0,
    firstScorer: 'none',
    highestScoringHalf: 'equal',
    cleanSheet: 'yes',
  });
  const [subTab, setSubTab] = useState(tab); // 'commentary' | 'stats' | 'points'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);
  const isLive = matchStatus === 'live';
  const isScheduled = matchStatus === 'scheduled';

  // Sync subTab when parent changes tab
  useEffect(() => {
    if (tab) setSubTab(tab);
  }, [tab]);

  const fetchFeed = useCallback(async (showRefreshing = false) => {
    if (!espnEventId) {
      setError('No ESPN event ID linked to this match.');
      setLoading(false);
      return;
    }

    if (showRefreshing) setRefreshing(true);

    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnEventId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
      const data = await res.json();

      // Pull commentary array — most detailed text play-by-play
      const rawCommentary = data.commentary || [];

      // Also pull key plays (goals, cards, subs) for enrichment
      const plays = (data.plays || []).filter(p => p.scoringPlay || p.type?.id === '60' || p.type?.id === '63' || p.type?.id === '61');

      let items = [];

      if (rawCommentary.length > 0) {
        items = rawCommentary.map((c, i) => ({
          id: `c-${i}`,
          minute: c.time?.displayValue || '',
          text: c.text || '',
          category: classifyEvent(c.type),
          period: c.period?.displayValue || '',
        }));
      } else if (plays.length > 0) {
        // Fallback to structured plays if no commentary text
        items = plays.map((p, i) => ({
          id: `p-${i}`,
          minute: p.clock?.displayValue || '',
          text: p.text || p.type?.text || '',
          category: classifyEvent(p.type),
          period: p.period?.displayValue || '',
        }));
      }

      // Reverse so latest commentary is at the top (newest first)
      items.reverse();

      // Pull live score and stats from competition status
      try {
        const competitions = data.header?.competitions || [];
        if (competitions.length > 0) {
          const comp = competitions[0];
          const homeTeam = comp.competitors?.find(c => c.homeAway === 'home');
          const awayTeam = comp.competitors?.find(c => c.homeAway === 'away');
          if (homeTeam && awayTeam) {
            const hScore = parseInt(homeTeam.score) || 0;
            const aScore = parseInt(awayTeam.score) || 0;
            setLiveScore({
              home: hScore,
              away: aScore,
            });
            if (onScoreUpdate) onScoreUpdate(hScore, aScore);

            // Clean Sheet
            const cleanSheet = (hScore === 0 || aScore === 0) ? 'yes' : 'no';

            // Get team IDs for first scorer verification
            const homeTeamId = homeTeam.id || homeTeam.team?.id;
            const awayTeamId = awayTeam.id || awayTeam.team?.id;

            // Total Cards from boxscore
            let homeYellow = 0, awayYellow = 0, homeRed = 0, awayRed = 0;
            if (data.boxscore && data.boxscore.teams) {
              const bHome = data.boxscore.teams.find(t => t.homeAway === 'home');
              const bAway = data.boxscore.teams.find(t => t.homeAway === 'away');
              if (bHome && bHome.statistics) {
                const yStat = bHome.statistics.find(st => st.name === 'yellowCards');
                const rStat = bHome.statistics.find(st => st.name === 'redCards');
                if (yStat) homeYellow = parseInt(yStat.displayValue) || 0;
                if (rStat) homeRed = parseInt(rStat.displayValue) || 0;
              }
              if (bAway && bAway.statistics) {
                const yStat = bAway.statistics.find(st => st.name === 'yellowCards');
                const rStat = bAway.statistics.find(st => st.name === 'redCards');
                if (yStat) awayYellow = parseInt(yStat.displayValue) || 0;
                if (rStat) awayRed = parseInt(rStat.displayValue) || 0;
              }
            }
            const totalCards = homeYellow + awayYellow + homeRed + awayRed;

            // First Scorer & Highest Scoring Half
            let firstGoalTime = Infinity;
            let firstScorer = 'none';
            let homeFirst = 0, homeSecond = 0, awayFirst = 0, awaySecond = 0;

            const currentPeriod = comp.status?.period || 1;

            const details = comp.details || [];
            const rawPlays = data.plays || [];

            if (details.length > 0) {
              for (const detail of details) {
                const isGoal = detail.scoringPlay || (detail.type && detail.type.text?.toLowerCase().includes('goal'));
                if (isGoal) {
                  const detailTeamId = detail.team?.id;
                  const isHome = detailTeamId && homeTeamId && String(detailTeamId) === String(homeTeamId);
                  const isAway = detailTeamId && awayTeamId && String(detailTeamId) === String(awayTeamId);

                  const clockVal = detail.clock?.value || 0;

                  // First Scorer
                  if (clockVal < firstGoalTime && (isHome || isAway)) {
                    firstGoalTime = clockVal;
                    firstScorer = isHome ? 'home' : 'away';
                  }

                  // Goals by half per team
                  const periodNum = detail.period?.number || (clockVal <= 2700 ? 1 : 2);
                  if (periodNum === 1) {
                    if (isHome) homeFirst++;
                    if (isAway) awayFirst++;
                  } else {
                    if (isHome) homeSecond++;
                    if (isAway) awaySecond++;
                  }
                }
              }
            } else {
              for (const p of rawPlays) {
                const isGoal = p.scoringPlay || (p.type && p.type.text?.toLowerCase().includes('goal'));
                if (isGoal) {
                  const pTeamId = p.team?.id;
                  const isHome = pTeamId && homeTeamId && String(pTeamId) === String(homeTeamId);
                  const isAway = pTeamId && awayTeamId && String(pTeamId) === String(awayTeamId);

                  const clockVal = p.clock?.value || 0;

                  // First Scorer
                  if (clockVal < firstGoalTime && (isHome || isAway)) {
                    firstGoalTime = clockVal;
                    firstScorer = isHome ? 'home' : 'away';
                  }

                  // Goals by half per team
                  const periodNum = p.period?.number || (clockVal <= 2700 ? 1 : 2);
                  if (periodNum === 1) {
                    if (isHome) homeFirst++;
                    if (isAway) awayFirst++;
                  } else {
                    if (isHome) homeSecond++;
                    if (isAway) awaySecond++;
                  }
                }
              }
            }

            // Fallback for First Scorer if plays are missing but goals exist
            if (firstScorer === 'none') {
              if (hScore > 0 && aScore === 0) {
                firstScorer = 'home';
              } else if (aScore > 0 && hScore === 0) {
                firstScorer = 'away';
              }
            }

            // Fallback goals by half from total score if details/plays were incomplete
            const firstHalfGoals = homeFirst + awayFirst;
            const secondHalfGoals = homeSecond + awaySecond;
            if (firstHalfGoals + secondHalfGoals < hScore + aScore) {
              const remaining = (hScore + aScore) - (firstHalfGoals + secondHalfGoals);
              if (currentPeriod === 1) {
                homeFirst += hScore - homeFirst - homeSecond;
                awayFirst += aScore - awayFirst - awaySecond;
              } else {
                homeSecond += hScore - homeFirst - homeSecond;
                awaySecond += aScore - awayFirst - awaySecond;
              }
            }

            setGoalsByHalf({ homeFirst, homeSecond, awayFirst, awaySecond });

            let highestScoringHalf = 'equal';
            if (firstHalfGoals > secondHalfGoals) highestScoringHalf = 'first';
            else if (secondHalfGoals > firstHalfGoals) highestScoringHalf = 'second';
            else highestScoringHalf = 'equal';

            setLiveStats({
              totalCards,
              firstScorer,
              highestScoringHalf,
              cleanSheet,
            });
          }
        }
      } catch (err) {
        console.warn('ESPN live stats parse error:', err);
      }

      // Pull all stats from boxscore
      if (data.boxscore && data.boxscore.teams) {
        const homeTeam = data.boxscore.teams.find(t => t.homeAway === 'home');
        const awayTeam = data.boxscore.teams.find(t => t.homeAway === 'away');
        if (homeTeam && awayTeam && homeTeam.statistics && awayTeam.statistics) {
          const allStats = homeTeam.statistics.map(s => {
            const opposingStat = awayTeam.statistics.find(os => os.name === s.name) || {};
            return {
              name: s.name,
              label: s.name === 'saves' ? 'Keeper Saves' : s.name === 'blockedShots' ? 'Blocked Shots (By Def)' : s.label,
              homeVal: s.displayValue || '0',
              awayVal: opposingStat.displayValue || '0',
            };
          });

          const hiddenStats = ['shotPct', 'passPct', 'crossPct', 'longballPct', 'tacklePct', 'penaltyKickGoals', 'penaltyKickShots'];
          const filteredStats = allStats.filter(s => {
            if (s.name === 'penaltyKickGoals' || s.name === 'penaltyKickShots') {
              return s.homeVal !== '0' || s.awayVal !== '0';
            }
            return !hiddenStats.includes(s.name);
          });

          // Count play-based stats from commentary: inside/outside box attempts & woodwork
          const rawCommentary = data.commentary || [];
          const competitions = data.header?.competitions || [];
          let homeTeamName = null, awayTeamName = null;
          if (competitions.length > 0) {
            const comp = competitions[0];
            const hTeam = comp.competitors?.find(c => c.homeAway === 'home');
            const aTeam = comp.competitors?.find(c => c.homeAway === 'away');
            if (hTeam) homeTeamName = hTeam.team?.displayName;
            if (aTeam) awayTeamName = aTeam.team?.displayName;
          }
          let homeInside = 0, awayInside = 0;
          let homeOutside = 0, awayOutside = 0;
          let homeWoodwork = 0, awayWoodwork = 0;
          const shotTypes = ['goal', 'shot-on-target', 'shot-off-target', 'shot-blocked', 'shot-hit-woodwork'];
          for (const entry of rawCommentary) {
            const play = entry.play;
            if (!play || play.fieldPositionX == null) continue;
            const type = play.type?.type;
            if (!shotTypes.includes(type)) continue;
            const teamName = play.team?.displayName;
            const isHome = homeTeamName && teamName === homeTeamName;
            const isAway = awayTeamName && teamName === awayTeamName;
            if (!isHome && !isAway) continue;
            const x = parseFloat(play.fieldPositionX);
            if (x >= 84) { if (isHome) homeInside++; else awayInside++; }
            else { if (isHome) homeOutside++; else awayOutside++; }
            if (type === 'shot-hit-woodwork') {
              if (isHome) homeWoodwork++; else awayWoodwork++;
            }
          }
          const playStats = [
            { name: 'insideBoxAttempts', label: 'Inside Box', homeVal: String(homeInside), awayVal: String(awayInside) },
            { name: 'outsideBoxAttempts', label: 'Outside Box', homeVal: String(homeOutside), awayVal: String(awayOutside) },
            { name: 'hitWoodwork', label: 'Hit Woodwork', homeVal: String(homeWoodwork), awayVal: String(awayWoodwork) },
          ].filter(st => {
    if (st.name === 'hitWoodwork' || st.name === 'insideBoxAttempts' || st.name === 'outsideBoxAttempts') {
      return parseInt(st.homeVal) > 0 || parseInt(st.awayVal) > 0;
    }
    return true;
  });

          const combinedStats = [...filteredStats, ...playStats];
          combinedStats.sort((a, b) => {
            const aIdx = STAT_ORDER.indexOf(a.name);
            const bIdx = STAT_ORDER.indexOf(b.name);
            return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
          });
          setStats(combinedStats);
        }
      }

      setCommentary(items);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [espnEventId]);

  // Initial fetch
  useEffect(() => {
    if (isScheduled) {
      setLoading(false);
      return;
    }
    fetchFeed(false);
  }, [fetchFeed, isScheduled]);

  // Poll every 30s when live, and reload immediately on tab focus
  useEffect(() => {
    if (!isLive) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchFeed(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    intervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchFeed(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isLive, fetchFeed]);

  // ---- Scheduled match ----
  if (isScheduled) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <Radio size={18} style={{ opacity: 0.4 }} />
        <span>Feed goes live when the match kicks off</span>
      </div>
    );
  }

  // ---- Loading ----
  if (loading) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <RefreshCw size={16} className="spin-icon" />
        <span>Loading feed…</span>
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <WifiOff size={16} style={{ color: 'var(--accent)', opacity: 0.7 }} />
        <span style={{ color: 'var(--accent)', opacity: 0.8 }}>{error}</span>
      </div>
    );
  }

  // ---- No events yet ----
  if (subTab === 'commentary' && commentary.length === 0) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <Clock size={16} style={{ opacity: 0.4 }} />
        <span>No commentary available yet</span>
        {isLive && <span style={{ fontSize: '11px', color: 'var(--success)', marginLeft: 4 }}>• polling…</span>}
      </div>
    );
  }

  const timeLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    : null;

  // Determine if the points tab can show useful data
  const hasLiveScore = liveScore.home !== null && liveScore.away !== null;
  // Fallback to match's stored score if live score not parsed
  const effectiveHomeScore = hasLiveScore ? liveScore.home : (match?.home_score ?? 0);
  const effectiveAwayScore = hasLiveScore ? liveScore.away : (match?.away_score ?? 0);

  // Reverted to simple layout without points tab variables

  const homeIsUnderdog = match?.home_win_pct != null && match?.away_win_pct != null && match?.draw_pct != null && match.home_win_pct < Math.max(match.home_win_pct, match.away_win_pct, match.draw_pct);
  const awayIsUnderdog = match?.home_win_pct != null && match?.away_win_pct != null && match?.draw_pct != null && match.away_win_pct < Math.max(match.home_win_pct, match.away_win_pct, match.draw_pct);
  const drawIsUnderdog = match?.home_win_pct != null && match?.away_win_pct != null && match?.draw_pct != null && match.draw_pct < Math.max(match.home_win_pct, match.away_win_pct, match.draw_pct);

  const handleScroll = (e, matchId) => {
    const scrollLeft = e.target.scrollLeft;
    const elements = document.querySelectorAll(`.live-bets-scroll-${matchId}`);
    elements.forEach(el => {
      if (el !== e.target && el.scrollLeft !== scrollLeft) {
        el.scrollLeft = scrollLeft;
      }
    });
  };

  return (
    <div className="live-feed-panel">
      {/* Feed Header */}
      <div className="live-feed-header" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div className="live-feed-title">
          {isLive && <span className="live-dot" />}
          {subTab === 'commentary' ? 'Live Commentary' : 'Match Stats'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {timeLabel && (
            <span className="live-feed-timestamp">
              <Wifi size={11} /> {timeLabel}
            </span>
          )}
          <button
            className="live-feed-refresh-btn"
            onClick={() => fetchFeed(true)}
            disabled={refreshing}
            aria-label="Refresh feed"
            title="Refresh"
          >
            <RefreshCw size={12} className={refreshing ? 'spin-icon' : ''} />
          </button>
        </div>
      </div>

      {/* Feed List */}
      <div className="live-feed-list" style={{ padding: subTab === 'stats' ? '16px' : '0', maxHeight: subTab === 'stats' ? 'none' : undefined, overflowY: subTab === 'stats' ? 'visible' : undefined }}>
        {subTab === 'commentary' ? (
          commentary.map(item => {
            const cat = item.category;
            return (
              <div key={item.id} className={`feed-event feed-event-${cat}`}>
                <div className="feed-event-left">
                  <span className="feed-event-icon">{eventIcon(cat)}</span>
                  {item.minute && (
                    <span className="feed-event-time">{item.minute}</span>
                  )}
                </div>
                <span className="feed-event-text">{item.text}</span>
              </div>
            );
          })
        ) : subTab === 'stats' ? (
          <>
            {/* Team Names Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '10px', marginBottom: '12px', fontWeight: '800', fontSize: '14px', letterSpacing: '0.03em' }}>
              <span style={{ color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {match?.home_flag && <img src={match.home_flag} alt="" style={{ width: 24, height: 16, borderRadius: 2, objectFit: 'cover' }} />}
                {homeCode}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '800', fontSize: '14px' }}>
                <span style={{ color: '#ffffff' }}>{effectiveHomeScore}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px' }}>VS</span>
                <span style={{ color: '#ffffff' }}>{effectiveAwayScore}</span>
              </span>
              <span style={{ color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {awayCode}
                {match?.away_flag && <img src={match.away_flag} alt="" style={{ width: 24, height: 16, borderRadius: 2, objectFit: 'cover' }} />}
              </span>
            </div>

            {/* Match Summary Stats */}
            {(() => {
              const totalGoals = goalsByHalf.homeFirst + goalsByHalf.homeSecond + goalsByHalf.awayFirst + goalsByHalf.awaySecond;
              const firstHalfGoals = goalsByHalf.homeFirst + goalsByHalf.awayFirst;
              const secondHalfGoals = goalsByHalf.homeSecond + goalsByHalf.awaySecond;
              const shotsOnTargetStat = stats.find(st => st.name === 'shotsOnTarget');
              const totalSOT = shotsOnTargetStat ? (parseFloat(shotsOnTargetStat.homeVal) || 0) + (parseFloat(shotsOnTargetStat.awayVal) || 0) : 0;
              const firstScorerCode = liveStats.firstScorer === 'home' ? homeCode : liveStats.firstScorer === 'away' ? awayCode : '-';
              const ouLine = match?.over_under_line ?? 2.5;
              const ouArrow = totalGoals > ouLine ? '↑' : totalGoals < ouLine ? '↓' : '=';
              const ouColor = totalGoals > ouLine ? '#22c55e' : totalGoals < ouLine ? '#ef4444' : '#ffffff';
              const boxStyle = {
                background: 'rgba(168, 85, 247, 0.15)',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                borderRadius: '4px',
                padding: '2px 4px',
                fontSize: '11px',
                fontWeight: '600',
                color: '#ffffff',
                display: 'inline-flex',
                alignItems: 'center',
              };
              return (
                <div style={{ marginBottom: '16px', display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                  <span style={boxStyle}>O/U: <span style={{ color: ouColor, fontSize: '15px', lineHeight: 1, marginTop: '-2px' }}>{ouArrow}</span></span>
                  <span style={boxStyle}>H1 Goals: {firstHalfGoals}</span>
                  <span style={boxStyle}>H2 Goals: {secondHalfGoals}</span>
                  <span style={boxStyle}>SF: {firstScorerCode}</span>
                  <span style={boxStyle}>TC: {liveStats.totalCards}</span>
                </div>
              );
            })()}
            {(() => {
              let lastSection = null;
              const totalShotsStat = stats.find(st => st.name === 'totalShots');
              return stats.map(s => {
                if (s.name === 'accuratePasses' || s.name === 'accurateCrosses' || s.name === 'accurateLongBalls' || s.name === 'effectiveTackles' || s.name === 'effectiveClearance') return null;
                const section = STAT_SECTION[s.name] || '';
                const sectionChanged = section && section !== lastSection;
                lastSection = section;
                const hVal = parseFloat(s.homeVal) || 0;
                const aVal = parseFloat(s.awayVal) || 0;
                let total = hVal + aVal;
                if (total === 0) total = 1;
                const homePct = (hVal / total) * 100;
                const awayPct = (aVal / total) * 100;
                let homeDisplay = formatStatValue(s.name, s.homeVal);
                let awayDisplay = formatStatValue(s.name, s.awayVal);
                if (s.name === 'shotsOnTarget' && totalShotsStat) {
                  const hTotal = parseFloat(totalShotsStat.homeVal) || 0;
                  const aTotal = parseFloat(totalShotsStat.awayVal) || 0;
                  if (hTotal > 0) homeDisplay += ' (' + Math.round(hVal / hTotal * 100) + '%)';
                  if (aTotal > 0) awayDisplay += ' (' + Math.round(aVal / aTotal * 100) + '%)';
                }
                const passesStat = s.name === 'totalPasses' ? stats.find(st => st.name === 'accuratePasses') : null;
                if (passesStat) {
                  const hAcc = parseFloat(passesStat.homeVal) || 0;
                  const aAcc = parseFloat(passesStat.awayVal) || 0;
                  if (hVal > 0) homeDisplay += ' (' + Math.round(hAcc / hVal * 100) + '%)';
                  if (aVal > 0) awayDisplay += ' (' + Math.round(aAcc / aVal * 100) + '%)';
                }
                const crossesStat = s.name === 'totalCrosses' ? stats.find(st => st.name === 'accurateCrosses') : null;
                if (crossesStat) {
                  const hAcc = parseFloat(crossesStat.homeVal) || 0;
                  const aAcc = parseFloat(crossesStat.awayVal) || 0;
                  if (hVal > 0) homeDisplay += ' (' + Math.round(hAcc / hVal * 100) + '%)';
                  if (aVal > 0) awayDisplay += ' (' + Math.round(aAcc / aVal * 100) + '%)';
                }
                const longBallsStat = s.name === 'totalLongBalls' ? stats.find(st => st.name === 'accurateLongBalls') : null;
                if (longBallsStat) {
                  const hAcc = parseFloat(longBallsStat.homeVal) || 0;
                  const aAcc = parseFloat(longBallsStat.awayVal) || 0;
                  if (hVal > 0) homeDisplay += ' (' + Math.round(hAcc / hVal * 100) + '%)';
                  if (aVal > 0) awayDisplay += ' (' + Math.round(aAcc / aVal * 100) + '%)';
                }
                const tacklesStat = s.name === 'totalTackles' ? stats.find(st => st.name === 'effectiveTackles') : null;
                if (tacklesStat) {
                  const hEff = parseFloat(tacklesStat.homeVal) || 0;
                  const aEff = parseFloat(tacklesStat.awayVal) || 0;
                  if (hVal > 0) homeDisplay += ' (' + Math.round(hEff / hVal * 100) + '%)';
                  if (aVal > 0) awayDisplay += ' (' + Math.round(aEff / aVal * 100) + '%)';
                }
                const clearsStat = s.name === 'totalClearance' ? stats.find(st => st.name === 'effectiveClearance') : null;
                if (clearsStat) {
                  const hEff = parseFloat(clearsStat.homeVal) || 0;
                  const aEff = parseFloat(clearsStat.awayVal) || 0;
                  if (hVal > 0) homeDisplay += ' (' + Math.round(hEff / hVal * 100) + '%)';
                  if (aVal > 0) awayDisplay += ' (' + Math.round(aEff / aVal * 100) + '%)';
                }
                return (
                  <React.Fragment key={s.name}>
                    {sectionChanged && (
                      <div style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '14px 0 6px 0', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '4px' }}>
                        {section}{section === 'Possession & Passing' ? ' (Accuracy)' : section === 'Defense' ? ' (Effective)' : ''}
                      </div>
                    )}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-primary)', fontWeight: '600', marginBottom: '5px' }}>
                        <span style={{ minWidth: '36px' }}>{homeDisplay}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center' }}>{s.label}</span>
                        <span style={{ minWidth: '36px', textAlign: 'right' }}>{awayDisplay}</span>
                      </div>
                      <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(255, 255, 255, 0.05)', display: 'flex', overflow: 'hidden' }}>
                        <div style={{ width: `${homePct}%`, background: 'var(--primary)', height: '100%' }}></div>
                        <div style={{ width: `${awayPct}%`, background: 'var(--accent)', height: '100%' }}></div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              });
            })()}
          </>
        ) : null}
      </div>

      {isLive && (
        <div className="live-feed-footer">
          <span className="live-dot" style={{ width: 6, height: 6 }} /> Auto-refreshes every 30s
        </div>
      )}
    </div>
  );
}
