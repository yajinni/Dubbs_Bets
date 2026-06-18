import React, { useState, useEffect } from 'react';
import { Users, RefreshCw } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';

// Helper to compute live points
function calcLivePoints(pred, match, liveHomeScore, liveAwayScore, liveTotalCards, liveFirstScorer, liveHighestHalf, liveCleanSheet) {
  if (!pred) return 0;

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

  return pWinner + pOu + pScore + pUnderdog + pCleanSheet + pTotalCards + pFirstScorer + pHalf;
}

export default function PlayerPicksList({ 
  m, 
  matchPredictions, 
  leaderboard, 
  activeParticipantId, 
  runningPointsMap = {}, 
  winnerLocalState = {},
  showLiveResults = false,
  onRefresh
}) {
  const homeName = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
  const awayName = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');
  const homeCode = m.home_code || 'H';
  const awayCode = m.away_code || 'A';

  const [liveStats, setLiveStats] = useState(null);

  // Only poll live data for actually live matches when in the Live tab
  const isLive = showLiveResults && m.espn_event_id;

  useEffect(() => {
    if (!isLive || !m.espn_event_id) return;

    const fetchLiveStats = async () => {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${m.espn_event_id}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        const competitions = data.header?.competitions || [];
        if (competitions.length > 0) {
          const comp = competitions[0];
          const homeTeam = comp.competitors?.find(c => c.homeAway === 'home');
          const awayTeam = comp.competitors?.find(c => c.homeAway === 'away');
          if (homeTeam && awayTeam) {
            const hScore = parseInt(homeTeam.score) || 0;
            const aScore = parseInt(awayTeam.score) || 0;

            const cleanSheet = (hScore === 0 || aScore === 0) ? 'yes' : 'no';

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
            let firstHalfGoals = 0;

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

                  // Halftime goals
                  const periodNum = detail.period?.number || (clockVal <= 2700 ? 1 : 2);
                  if (periodNum === 1) {
                    firstHalfGoals++;
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

                  // Halftime goals
                  const periodNum = p.period?.number || (clockVal <= 2700 ? 1 : 2);
                  if (periodNum === 1) {
                    firstHalfGoals++;
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

            // Halftime score fallback/logic
            if (currentPeriod === 1) {
              firstHalfGoals = hScore + aScore;
            }
            const secondHalfGoals = Math.max(0, (hScore + aScore) - firstHalfGoals);

            let highestScoringHalf = 'equal';
            if (firstHalfGoals > secondHalfGoals) highestScoringHalf = 'first';
            else if (secondHalfGoals > firstHalfGoals) highestScoringHalf = 'second';
            else highestScoringHalf = 'equal';

            setLiveStats({
              homeScore: hScore,
              awayScore: aScore,
              totalCards,
              firstScorer,
              highestScoringHalf,
              cleanSheet,
            });
          }
        }
      } catch (_) {}
    };

    fetchLiveStats();
    const interval = setInterval(fetchLiveStats, 30000);
    return () => clearInterval(interval);
  }, [isLive, m.espn_event_id]);

  const handleScroll = (e, matchId) => {
    const scrollLeft = e.target.scrollLeft;
    const elements = document.querySelectorAll(`.bets-scroll-${matchId}`);
    elements.forEach(el => {
      if (el !== e.target && el.scrollLeft !== scrollLeft) {
        el.scrollLeft = scrollLeft;
      }
    });
  };

  // Determine actual match results if finished (or live stats if live)
  let actualWinner = null;
  let actualOU = null;
  let actualHighestHalf = null;
  let actualCleanSheet = null;
  let actualCards = null;
  let actualFirstScorer = null;

  const activeHomeScore = liveStats ? liveStats.homeScore : m.home_score;
  const activeAwayScore = liveStats ? liveStats.awayScore : m.away_score;

  if (m.finished === 1 || liveStats || showLiveResults) {
    if (activeHomeScore > activeAwayScore) actualWinner = 'home';
    else if (activeAwayScore > activeHomeScore) actualWinner = 'away';
    else actualWinner = 'draw';

    const totalGoals = activeHomeScore + activeAwayScore;
    actualOU = totalGoals > m.over_under_line ? 'over' : 'under';

    if (liveStats) {
      actualHighestHalf = liveStats.highestScoringHalf;
      actualCleanSheet = liveStats.cleanSheet;
      actualCards = liveStats.totalCards;
      actualFirstScorer = liveStats.firstScorer;
    } else {
      if (m.home_ht_score !== null && m.home_ht_score !== undefined && m.away_ht_score !== null && m.away_ht_score !== undefined) {
        const firstHalfGoals = m.home_ht_score + m.away_ht_score;
        const secondHalfGoals = totalGoals - firstHalfGoals;
        if (firstHalfGoals > secondHalfGoals) actualHighestHalf = 'first';
        else if (secondHalfGoals > firstHalfGoals) actualHighestHalf = 'second';
        else actualHighestHalf = 'equal';
      }
      actualCleanSheet = (m.home_score === 0 || m.away_score === 0) ? 'yes' : 'no';
      actualCards = m.actual_cards;
      actualFirstScorer = m.actual_first_scorer;
    }
  }

  const homeIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.home_win_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
  const awayIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.away_win_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
  const drawIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.draw_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);

  const showsLiveTitle = showLiveResults;

  return (
    <div style={{ marginTop: '0', borderTop: '1px dashed var(--glass-border)', paddingTop: '6px' }}>
      <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Users size={12} strokeWidth={2.5} />
          {showsLiveTitle ? "Results Based on Current Time" : "Players' Picks"}
        </div>
        <button
          onClick={onRefresh}
          title="Refresh picks"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: '4px' }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {leaderboard.length === 0 ? (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px' }}>No players yet.</span>
        ) : (
          leaderboard.map(op => {
            const opPred = matchPredictions?.find(ap => ap.participant_id === op.id);
            const isSelf = op.id === activeParticipantId;

            // Construct displaying predictions: if it is self and we have local state overrides, use them
            let displayPred = opPred;
            if (isSelf && Object.keys(winnerLocalState).length > 0) {
              displayPred = {
                predicted_winner: winnerLocalState.winner || null,
                predicted_over_under: winnerLocalState.overUnder || null,
                predicted_home_score: winnerLocalState.homeScore !== '' && winnerLocalState.homeScore !== undefined ? parseInt(winnerLocalState.homeScore) : null,
                predicted_away_score: winnerLocalState.awayScore !== '' && winnerLocalState.awayScore !== undefined ? parseInt(winnerLocalState.awayScore) : null,
                predicted_total_cards: winnerLocalState.totalCards !== '' && winnerLocalState.totalCards !== undefined ? parseInt(winnerLocalState.totalCards) : null,
                predicted_first_scorer: winnerLocalState.firstScorer || null,
                predicted_highest_scoring_half: winnerLocalState.highestScoringHalf || null,
                predicted_clean_sheet: winnerLocalState.cleanSheet || null,
                total_points: opPred ? opPred.total_points : 0,
                points_cards_ou: opPred ? opPred.points_cards_ou : 0
              };
            }

            const hasWinnerPred = displayPred && displayPred.predicted_winner;
            const isWinnerCorrect = (m.finished === 1 || liveStats) && hasWinnerPred && displayPred.predicted_winner === actualWinner;

            const hasOUPred = displayPred && displayPred.predicted_over_under;
            const isOUCorrect = (m.finished === 1 || liveStats) && hasOUPred && displayPred.predicted_over_under === actualOU;

            const pickedUnderdog = displayPred && (
              (displayPred.predicted_winner === 'home' && homeIsUnderdog) ||
              (displayPred.predicted_winner === 'away' && awayIsUnderdog) ||
              (displayPred.predicted_winner === 'draw' && drawIsUnderdog)
            );

            // If liveStats exists, we evaluate underdog bonus dynamically using isWinnerCorrect and pickedUnderdog
            const underdogBonusEarned = liveStats 
              ? (isWinnerCorrect && pickedUnderdog) 
              : (displayPred && displayPred.points_cards_ou > 0);

            const hasFirstScorerPred = displayPred && displayPred.predicted_first_scorer;
            const isFirstScorerCorrect = (m.finished === 1 || liveStats) && hasFirstScorerPred && displayPred.predicted_first_scorer === actualFirstScorer;

            const hasHalfPred = displayPred && displayPred.predicted_highest_scoring_half;
            const isHalfCorrect = (m.finished === 1 || liveStats) && hasHalfPred && displayPred.predicted_highest_scoring_half === actualHighestHalf;

            const hasCleanPred = displayPred && displayPred.predicted_clean_sheet;
            const isCleanCorrect = (m.finished === 1 || liveStats) && hasCleanPred && displayPred.predicted_clean_sheet === actualCleanSheet;

            const hasScorePred = displayPred && displayPred.predicted_home_score !== null && displayPred.predicted_away_score !== null;
            const isScoreCorrect = (m.finished === 1 || liveStats) && hasScorePred && displayPred.predicted_home_score === activeHomeScore && displayPred.predicted_away_score === activeAwayScore;

            const hasTotalCardsPred = displayPred && displayPred.predicted_total_cards !== null;
            const isTotalCardsCorrect = (m.finished === 1 || liveStats) && hasTotalCardsPred && displayPred.predicted_total_cards === actualCards;

            // Compute current points if live
            let currentLivePoints = 0;
            if (liveStats && displayPred) {
              currentLivePoints = calcLivePoints(
                displayPred,
                m,
                activeHomeScore,
                activeAwayScore,
                actualCards,
                actualFirstScorer,
                actualHighestHalf,
                actualCleanSheet
              );
            }

            return (
              <div key={op.id} className="player-result-row" style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                gap: '6px', 
                background: isSelf ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255, 255, 255, 0.01)', 
                borderRadius: '6px', 
                border: '1px solid var(--glass-border)',
                padding: '8px 12px'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', maxWidth: 'max-content' }}>
                {/* Name & Points (inline) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#ffffff' }}>
                    {op.name}
                  </span>
                  {showsLiveTitle ? (
                    <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '11px' }}>
                      [Current  Points: {currentLivePoints}]
                    </span>
                  ) : (
                    <>
                      <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '11px' }}>
                        [Match: {displayPred && m.finished === 1 ? displayPred.total_points : 0} pts]
                      </span>
                      <span style={{ color: 'var(--info)', fontWeight: '700', fontSize: '11px' }}>
                        [Running: {opPred?.running_total || 0} pts]
                      </span>
                      <span style={{ color: 'var(--primary-hover)', fontWeight: '700', fontSize: '11px' }}>
                        [Total: {op.total_points} pts]
                      </span>
                    </>
                  )}
                </div>

                {/* Prediction Badges Horizontal Scroll (Synced) */}
                <div 
                  className={`bets-scroll-${m.id}`}
                  onScroll={(e) => handleScroll(e, m.id)}
                  style={{ width: '100%', overflowX: 'auto', paddingBottom: '4px' }}
                >
                  {displayPred ? (
                    <div style={{ 
                      display: 'flex', 
                      gap: '3px',
                      minWidth: 'max-content',
                      padding: '2px 0'
                    }}>
                      {/* Score */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: hasScorePred ? ((m.finished === 1 || liveStats) ? (isScoreCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasScorePred ? ((m.finished === 1 || liveStats) ? (isScoreCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {hasScorePred ? `${displayPred.predicted_home_score}-${displayPred.predicted_away_score}` : '-'}
                      </span>

                      {/* O/U */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: displayPred.predicted_over_under ? ((m.finished === 1 || liveStats) ? (isOUCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: displayPred.predicted_over_under ? ((m.finished === 1 || liveStats) ? (isOUCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {displayPred.predicted_over_under === 'over' ? 'O' : displayPred.predicted_over_under === 'under' ? 'U' : '-'}
                      </span>

                      {/* Total Cards */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: hasTotalCardsPred ? ((m.finished === 1 || liveStats) ? (isTotalCardsCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasTotalCardsPred ? ((m.finished === 1 || liveStats) ? (isTotalCardsCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {displayPred.predicted_total_cards !== null && displayPred.predicted_total_cards !== undefined ? `TC:${displayPred.predicted_total_cards}` : '-'}
                      </span>

                      {/* Winner */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: (m.finished === 1 || liveStats) ? (isWinnerCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)',
                        border: (m.finished === 1 || liveStats) ? (isWinnerCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)'
                      }}>
                        {displayPred.predicted_winner === 'home' ? `W:${homeCode}` : displayPred.predicted_winner === 'away' ? `W:${awayCode}` : displayPred.predicted_winner === 'draw' ? 'Draw' : '-'}
                      </span>

                      {/* Underdog Pick */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: displayPred.predicted_winner ? ((m.finished === 1 || liveStats) ? (underdogBonusEarned ? 'rgba(16, 185, 129, 0.25)' : (pickedUnderdog ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.05)')) : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: displayPred.predicted_winner ? ((m.finished === 1 || liveStats) ? (underdogBonusEarned ? '1px solid rgba(16, 185, 129, 0.4)' : (pickedUnderdog ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)')) : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {displayPred.predicted_winner ? (pickedUnderdog ? 'B' : 'F') : '-'}
                      </span>

                      {/* Scored First */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: hasFirstScorerPred ? ((m.finished === 1 || liveStats) ? (isFirstScorerCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasFirstScorerPred ? ((m.finished === 1 || liveStats) ? (isFirstScorerCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {hasFirstScorerPred ? `SF:${displayPred.predicted_first_scorer === 'home' ? homeCode : displayPred.predicted_first_scorer === 'away' ? awayCode : 'None'}` : '-'}
                      </span>

                      {/* Highest scoring half */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: hasHalfPred ? ((m.finished === 1 || liveStats) ? (isHalfCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasHalfPred ? ((m.finished === 1 || liveStats) ? (isHalfCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {hasHalfPred ? `HH:${displayPred.predicted_highest_scoring_half === 'first' ? '1st' : displayPred.predicted_highest_scoring_half === 'second' ? '2nd' : 'Equal'}` : '-'}
                      </span>

                      {/* Clean Sheet */}
                      <span style={{ 
                        padding: '2px 4px', 
                        borderRadius: '4px', 
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#ffffff',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: hasCleanPred ? ((m.finished === 1 || liveStats) ? (isCleanCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasCleanPred ? ((m.finished === 1 || liveStats) ? (isCleanCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {hasCleanPred ? `CS:${displayPred.predicted_clean_sheet === 'yes' ? 'Y' : 'N'}` : '-'}
                      </span>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', display: 'block', minWidth: '360px', padding: '4px 0' }}>
                      None ⏳
                    </span>
                  )}
                 </div>
               </div>
             </div>
             );
          })
        )}
      </div>
    </div>
  );
}
