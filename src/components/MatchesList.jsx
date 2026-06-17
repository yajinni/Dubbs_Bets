import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Lock, TrendingUp, HelpCircle, Save, Users, CheckCircle, Radio, ChevronDown, ChevronUp } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';
import PlayerPicksList from './PlayerPicksList';
import LiveFeed from './LiveFeed';

export function MatchCard({ m, pred, activeParticipantId, onSave, allPredictions = [], leaderboard = [], runningPointsMap = {}, selectedMatchId, showLiveResults: propShowLiveResults = false, onRefresh }) {
  const isLocked = new Date(m.local_date).getTime() <= Date.now() || m.status !== 'scheduled' || m.finished === 1;
  const homeName = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
  const awayName = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');
  const otherParticipants = leaderboard.filter(p => p.id !== activeParticipantId);

  // Calculate implied Over/Under probabilities
  const overOdds = m.over_odds || 1.9;
  const underOdds = m.under_odds || 1.9;
  const pOver = overOdds > 0 ? 1.0 / overOdds : 0.5;
  const pUnder = underOdds > 0 ? 1.0 / underOdds : 0.5;
  const sumOU = pOver + pUnder;
  const overPct = sumOU > 0 ? Math.round((pOver / sumOU) * 100) : 50;
  const underPct = 100 - overPct;


  // Calculate implied First Team to Score Probability
  const homeWinPct = m.home_win_pct || 33.3;
  const awayWinPct = m.away_win_pct || 33.3;
  const drawPct = m.draw_pct || 33.3;
  const totalWinSum = homeWinPct + awayWinPct;
  const noGoalProb = Math.max(1, Math.min(99, Math.round(drawPct * 0.28)));
  const anyGoalProb = 100 - noGoalProb;
  const homeFirstProb = totalWinSum > 0 ? (homeWinPct / totalWinSum) * anyGoalProb : anyGoalProb / 2;
  const awayFirstProb = totalWinSum > 0 ? (awayWinPct / totalWinSum) * anyGoalProb : anyGoalProb / 2;
  const homeFirstPct = Math.round(homeFirstProb);
  const noGoalPct = Math.round(noGoalProb);
  const awayFirstPct = 100 - homeFirstPct - noGoalPct;

  // eslint-disable-next-line react-hooks/purity
  const isLive = m.status === 'live' || (m.finished === 0 && m.status === 'scheduled' && new Date(m.local_date).getTime() <= Date.now());
  const showLiveResults = propShowLiveResults || isLive;
  // Auto-open feed for live matches
  const [feedTab, setFeedTab] = useState(isLive ? 'stats' : null);
  const [isCollapsed, setIsCollapsed] = useState(m.finished === 1);
  const [liveScores, setLiveScores] = useState(null);
  const displayHome = liveScores ? liveScores.home : m.home_score;
  const displayAway = liveScores ? liveScores.away : m.away_score;

  // Auto-expand if this match is selected from another view (e.g. Dashboard)
  useEffect(() => {
    if (selectedMatchId === m.id) {
      setIsCollapsed(false);
    }
  }, [selectedMatchId, m.id]);

  const handleScroll = (e, matchId) => {
    const scrollLeft = e.target.scrollLeft;
    const elements = document.querySelectorAll(`.bets-scroll-${matchId}`);
    elements.forEach(el => {
      if (el !== e.target && el.scrollLeft !== scrollLeft) {
        el.scrollLeft = scrollLeft;
      }
    });
  };

  // Local state for the inline prediction inputs
  const [winner, setWinner] = useState('');
  const [overUnder, setOverUnder] = useState('');
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [totalCards, setTotalCards] = useState('');
  const [firstScorer, setFirstScorer] = useState('');
  const [highestScoringHalf, setHighestScoringHalf] = useState('');
  const [cleanSheet, setCleanSheet] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [lastSavedTime, setLastSavedTime] = useState(() => {
    return localStorage.getItem(`save_timestamp_${activeParticipantId}_${m.id}`) || '';
  });

  // Sync inputs with existing prediction or reset on participant switch
  useEffect(() => {
    if (pred) {
      setWinner(pred.predicted_winner || '');
      setOverUnder(pred.predicted_over_under || '');
      setHomeScore(pred.predicted_home_score !== null ? pred.predicted_home_score.toString() : '');
      setAwayScore(pred.predicted_away_score !== null ? pred.predicted_away_score.toString() : '');
      setTotalCards(pred.predicted_total_cards !== null ? pred.predicted_total_cards.toString() : '');
      setFirstScorer(pred.predicted_first_scorer || '');
      setHighestScoringHalf(pred.predicted_highest_scoring_half || '');
      setCleanSheet(pred.predicted_clean_sheet || '');
    } else {
      setWinner('');
      setOverUnder('');
      setHomeScore('');
      setAwayScore('');
      setTotalCards('');
      setFirstScorer('');
      setHighestScoringHalf('');
      setCleanSheet('');
    }
    setError('');
    setSuccessMsg('');
    setLastSavedTime(localStorage.getItem(`save_timestamp_${activeParticipantId}_${m.id}`) || '');
  }, [pred, activeParticipantId, m.id]);

  const hasChanges = (() => {
    const currentWinner = winner || '';
    const currentOU = overUnder || '';
    const currentHome = homeScore || '';
    const currentAway = awayScore || '';
    const currentTotalCards = totalCards || '';
    const currentFirstScorer = firstScorer || '';
    const currentHalf = highestScoringHalf || '';
    const currentClean = cleanSheet || '';

    if (!pred) {
      return currentWinner !== '' || currentOU !== '' || currentHome !== '' || currentAway !== '' || currentTotalCards !== '' || currentFirstScorer !== '' || currentHalf !== '' || currentClean !== '';
    }

    const matchWinner = currentWinner === (pred.predicted_winner || '');
    const matchOU = currentOU === (pred.predicted_over_under || '');
    const matchHome = currentHome === (pred.predicted_home_score !== null ? pred.predicted_home_score.toString() : '');
    const matchAway = currentAway === (pred.predicted_away_score !== null ? pred.predicted_away_score.toString() : '');
    const matchTotalCards = currentTotalCards === (pred.predicted_total_cards !== null ? pred.predicted_total_cards.toString() : '');
    const matchFirstScorer = currentFirstScorer === (pred.predicted_first_scorer || '');
    const matchHalf = currentHalf === (pred.predicted_highest_scoring_half || '');
    const matchClean = currentClean === (pred.predicted_clean_sheet || '');

    return !(matchWinner && matchOU && matchHome && matchAway && matchTotalCards && matchFirstScorer && matchHalf && matchClean);
  })();

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!winner) {
      setError('Select outcome.');
      return;
    }
    if (!overUnder) {
      setError('Select O/U Goals.');
      return;
    }
    if (!firstScorer) {
      setError('Select Scored First.');
      return;
    }
    if (!highestScoringHalf) {
      setError('Select Highest Scoring Half.');
      return;
    }
    if (!cleanSheet) {
      setError('Select Clean Sheet.');
      return;
    }
    if (homeScore === '' || awayScore === '') {
      setError('Enter both scores.');
      return;
    }
    if (totalCards === '') {
      setError('Enter exact cards.');
      return;
    }

    const hScore = parseInt(homeScore);
    const aScore = parseInt(awayScore);
    const tCards = parseInt(totalCards);

    if (isNaN(hScore) || isNaN(aScore) || hScore < 0 || aScore < 0) {
      setError('Positive numbers only for scores.');
      return;
    }
    if (isNaN(tCards) || tCards < 0) {
      setError('Positive numbers only for cards.');
      return;
    }



    setSaving(true);
    try {
      const response = await fetch('/api/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId: activeParticipantId,
          matchId: m.id,
          predictedWinner: winner,
          predictedOverUnder: overUnder,
          predictedHomeScore: hScore,
          predictedAwayScore: aScore,
          predictedTotalCards: tCards,
          predictedFirstScorer: firstScorer,
          predictedHighestScoringHalf: highestScoringHalf,
          predictedCleanSheet: cleanSheet
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save prediction.');
      }

      setSuccessMsg('Saved!');
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      setLastSavedTime(timeStr);
      localStorage.setItem(`save_timestamp_${activeParticipantId}_${m.id}`, timeStr);
      setTimeout(() => setSuccessMsg(''), 2500);
      onSave(); // Refresh all state
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const getRoundLabel = (m) => {
    const t = m.type || 'group';
    if (t === 'group') return `Group ${m.group_name || 'A'}`;
    if (t === 'r32') return 'Round of 32';
    if (t === 'r16') return 'Round of 16';
    if (t === 'qf') return 'Quarter-final';
    if (t === 'sf') return 'Semi-final';
    if (t === 'third') return '3rd Place Playoff';
    if (t === 'final') return 'World Cup Final';
    return t;
  };

  const formatMatchDate = (isoString) => {
    if (!isoString) return '';
    let normalized = isoString.replace(' ', 'T');
    const hasTimezone = normalized.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(normalized);
    
    let date;
    if (hasTimezone) {
      date = new Date(normalized);
    } else {
      date = new Date(normalized + '-04:00');
    }
    
    const dateStr = date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${dateStr} ET`;
  };

  return (
    <div id={`match-card-${m.id}`} className="glass-panel match-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      
      {/* Header: Stage and Date */}
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary-hover)', letterSpacing: '0.05em' }}>
          {getRoundLabel(m)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
            <Calendar size={14} />
            {formatMatchDate(m.local_date)}
          </span>
        </div>
      </div>

      {/* Match Score & Teams */}
      <div className="match-teams-grid">
        <div className="team-container home">
          <span className="team-name">{homeName}</span>
          {m.home_flag && <img src={m.home_flag} alt={`${homeName} flag`} className="flag-icon" />}
        </div>

        <div className="match-info-center">
          {m.status === 'scheduled' ? (
            <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-muted)' }}>VS</span>
          ) : (
            <div className="score-display">
              <span>{displayHome}</span>
              <span className="score-divider">-</span>
              <span>{displayAway}</span>
            </div>
          )}
          <span className={`match-badge ${m.status}`}>
            {m.status === 'scheduled' ? 'Scheduled' : m.status === 'live' ? 'Live' : 'FT'}
          </span>
        </div>

        <div className="team-container away">
          {m.away_flag && <img src={m.away_flag} alt={`${awayName} flag`} className="flag-icon" />}
          <span className="team-name">{awayName}</span>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Analytics Box */}
          <div className="match-analytics-box">
        <div className="analytics-title">
          <TrendingUp size={14} />
          3rd Party Match Analysis
        </div>
        <div className="analytics-grid">
          {/* Winner Probability */}
          <div className="analytics-item">
            <div style={{ fontSize: '13px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px', fontWeight: '700' }}>
              Match Winner (%)
            </div>
            <div className="analytics-labels">
              <span>{homeName}: {m.home_win_pct}%</span>
              <span>{awayName}: {m.away_win_pct}%</span>
            </div>
            <div className="win-pct-bar" style={{ marginBottom: '4px' }}>
              <div className="win-pct-segment home" style={{ width: `${m.home_win_pct}%` }}></div>
              <div className="win-pct-segment draw" style={{ width: `${m.draw_pct}%` }}></div>
              <div className="win-pct-segment away" style={{ width: `${m.away_win_pct}%` }}></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#ffffff' }}>
              <span>Draw: {m.draw_pct}%</span>
            </div>
          </div>

          {/* First Team to Score Probability */}
          <div className="analytics-item">
            <div style={{ fontSize: '13px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px', fontWeight: '700' }}>
              Scored First (%)
            </div>
            <div className="analytics-labels">
              <span>{homeName}: {homeFirstPct}%</span>
              <span>{awayName}: {awayFirstPct}%</span>
            </div>
            <div className="win-pct-bar" style={{ marginBottom: '4px' }}>
              <div className="win-pct-segment home" style={{ width: `${homeFirstPct}%` }}></div>
              <div className="win-pct-segment draw" style={{ width: `${noGoalPct}%` }}></div>
              <div className="win-pct-segment away" style={{ width: `${awayFirstPct}%` }}></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#ffffff' }}>
              <span>No Goal: {noGoalPct}%</span>
            </div>
          </div>

          {/* Goals Over/Under Probability */}
          <div className="analytics-item" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '12px', marginTop: '4px' }}>
            <div style={{ fontSize: '13px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontWeight: '700' }}>
              Score O/U ({m.over_under_line})
            </div>
            <div className="analytics-labels">
              <span>Under {m.over_under_line}: {underPct}%</span>
              <span>Over {m.over_under_line}: {overPct}%</span>
            </div>
            <div className="ou-pct-bar">
              <div className="ou-pct-segment under" style={{ width: `${underPct}%` }}></div>
              <div className="ou-pct-segment over" style={{ width: `${overPct}%` }}></div>
            </div>
          </div>

          {/* Underdog Indicator */}
          <div className="analytics-item" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '12px', marginTop: '4px' }}>
            <div style={{ fontSize: '13px', color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', fontWeight: '700' }}>
              🐉 Underdog Bonus (1 pt)
            </div>
            {(() => {
              const hw = m.home_win_pct;
              const aw = m.away_win_pct;
              const dp = m.draw_pct;
              if (hw == null || aw == null || dp == null) return null;
              
              const maxPct = Math.max(hw, aw, dp);
              const underdogs = [];
              if (hw < maxPct) underdogs.push({ name: homeName, pct: hw });
              if (dp < maxPct) underdogs.push({ name: 'Draw', pct: dp });
              if (aw < maxPct) underdogs.push({ name: awayName, pct: aw });
              
              if (underdogs.length === 0) {
                return (
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Even match — no underdog</div>
                );
              }
              
              // Sort lowest percentage first
              underdogs.sort((a, b) => a.pct - b.pct);
              const underdogText = underdogs.map(u => `${u.name} (${u.pct}%)`).join(' or ');
              
              return (
                <div style={{ fontSize: '13px', color: '#fbbf24', fontWeight: '700' }}>
                  ⭐ {underdogText} — Pick to win for +1 bonus point!
                </div>
              );
            })()
            }
          </div>

          {/* Synced/Locked Timestamp Status */}
          {m.odds_updated_at && (
            <div style={{ 
              fontSize: '13px', 
              color: '#10b981', 
              marginTop: '12px',
              paddingTop: '8px',
              borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              justifyContent: 'center',
              fontWeight: '500'
            }}>
              {m.odds_locked === 1 ? (
                <span>Odds Locked: {new Date(m.odds_updated_at).toLocaleString()}</span>
              ) : (
                <span>Odds Synced: {new Date(m.odds_updated_at).toLocaleString()}</span>
              )}
            </div>
          )}
        </div>

        {/* Actual Match Results Box (Only when match is finished) */}
        {m.finished === 1 && (
          <div className="match-analytics-box" style={{ marginTop: '12px', borderLeft: '3px solid var(--success)' }}>
            <div className="analytics-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success)' }}>
              <CheckCircle size={14} />
              Confirmed Match Results
            </div>
            <div className="results-analytics-grid">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Winner</span>
                <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {displayHome > displayAway ? homeName : displayAway > displayHome ? awayName : 'Draw'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Scored First</span>
                <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {m.actual_first_scorer === 'home' ? homeName : m.actual_first_scorer === 'away' ? awayName : 'No Goal'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Goals O/U</span>
                <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {(displayHome + displayAway) > m.over_under_line ? 'Over' : 'Under'} {m.over_under_line}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Highest Half</span>
                <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {(() => {
                    if (m.home_ht_score === null || m.home_ht_score === undefined || m.away_ht_score === null || m.away_ht_score === undefined) {
                      return 'TBD';
                    }
                    const firstHalfGoals = m.home_ht_score + m.away_ht_score;
                    const secondHalfGoals = (displayHome + displayAway) - firstHalfGoals;
                    return firstHalfGoals > secondHalfGoals ? '1st Half' : secondHalfGoals > firstHalfGoals ? '2nd Half' : 'Equal';
                  })()}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Clean Sheet</span>
                <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)', textTransform: 'uppercase' }}>
                  {displayHome === 0 || displayAway === 0 ? 'Yes' : 'No'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Total Cards</span>
                <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)' }}>
                  {m.actual_cards !== null ? `${m.actual_cards} cards` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Predictions Section */}
      <div className="match-stats-drawer" style={{ gridTemplateColumns: '1fr', borderTop: '1px solid var(--glass-border)', paddingTop: '16px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', alignSelf: 'stretch' }}>
        {activeParticipantId ? (
          isLocked ? (
            /* Locked Prediction View */
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '12px', flexWrap: 'wrap' }}>
              {!pred && (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No prediction placed
                </span>
              )}
            </div>
          ) : (
            /* Inline Prediction Form */
            <div className="inline-prediction-box">
              <div className="prediction-title">
                <span>Your Prediction</span>
                {successMsg && <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '12px' }}>{successMsg}</span>}
              </div>
              <div className="inline-prediction-grid">
                {/* Score inputs */}
                <div className="prediction-col">
                  <label>Exact Score (4 pts)</label>
                  <div className="inline-score-inputs">
                    {m.home_flag && <img src={m.home_flag} alt={homeName} style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />}
                    <input
                      type="number"
                      min="0"
                      max="15"
                      value={homeScore}
                      onChange={(e) => setHomeScore(e.target.value)}
                      placeholder="H"
                      aria-label="Home score prediction"
                      disabled={saving}
                    />
                    <span>-</span>
                    <input
                      type="number"
                      min="0"
                      max="15"
                      value={awayScore}
                      onChange={(e) => setAwayScore(e.target.value)}
                      placeholder="A"
                      aria-label="Away score prediction"
                      disabled={saving}
                    />
                    {m.away_flag && <img src={m.away_flag} alt={awayName} style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />}
                  </div>
                </div>

                {/* Total Cards exact input */}
                <div className="prediction-col">
                  <label>Total Cards (3 pts)</label>
                  <div className="inline-score-inputs" style={{ justifyContent: 'center' }}>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={totalCards}
                      onChange={(e) => setTotalCards(e.target.value)}
                      placeholder="Cards"
                      aria-label="Exact cards prediction"
                      disabled={saving}
                      style={{ width: '70px', textAlign: 'center' }}
                    />
                  </div>
                </div>

                {/* Winner Select */}
                <div className="prediction-col">
                  <label>Winner (3 pts)</label>
                  <div className="inline-choice-group">
                    <button
                      type="button"
                      className={`choice-btn ${winner === 'home' ? 'active' : ''}`}
                      onClick={() => setWinner('home')}
                      disabled={saving}
                    >
                      {m.home_code || homeName}
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${winner === 'draw' ? 'active' : ''}`}
                      onClick={() => setWinner('draw')}
                      disabled={saving}
                    >
                      Draw
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${winner === 'away' ? 'active' : ''}`}
                      onClick={() => setWinner('away')}
                      disabled={saving}
                    >
                      {m.away_code || awayName}
                    </button>
                  </div>
                </div>

                {/* First Team to Score Select */}
                <div className="prediction-col">
                  <label>Scored First (2 pts)</label>
                  <div className="inline-choice-group">
                    <button
                      type="button"
                      className={`choice-btn ${firstScorer === 'home' ? 'active' : ''}`}
                      onClick={() => setFirstScorer('home')}
                      disabled={saving}
                    >
                      {m.home_code || homeName}
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${firstScorer === 'none' ? 'active' : ''}`}
                      onClick={() => setFirstScorer('none')}
                      disabled={saving}
                    >
                      No Goal
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${firstScorer === 'away' ? 'active' : ''}`}
                      onClick={() => setFirstScorer('away')}
                      disabled={saving}
                    >
                      {m.away_code || awayName}
                    </button>
                  </div>
                </div>

                {/* Highest Scoring Half Select */}
                <div className="prediction-col">
                  <label>Highest scoring Half (2 pts)</label>
                  <div className="inline-choice-group">
                    <button
                      type="button"
                      className={`choice-btn ${highestScoringHalf === 'first' ? 'active' : ''}`}
                      onClick={() => setHighestScoringHalf('first')}
                      disabled={saving}
                    >
                      1st Half
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${highestScoringHalf === 'equal' ? 'active' : ''}`}
                      onClick={() => setHighestScoringHalf('equal')}
                      disabled={saving}
                    >
                      Equal
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${highestScoringHalf === 'second' ? 'active' : ''}`}
                      onClick={() => setHighestScoringHalf('second')}
                      disabled={saving}
                    >
                      2nd Half
                    </button>
                  </div>
                </div>

                {/* Over/Under Select */}
                <div className="prediction-col">
                  <label>Score O/U (1 pt)</label>
                  <div className="inline-choice-group">
                    <button
                      type="button"
                      className={`choice-btn ${overUnder === 'over' ? 'active' : ''}`}
                      onClick={() => setOverUnder('over')}
                      disabled={saving}
                    >
                      Over {m.over_under_line}
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${overUnder === 'under' ? 'active' : ''}`}
                      onClick={() => setOverUnder('under')}
                      disabled={saving}
                    >
                      Under {m.over_under_line}
                    </button>
                  </div>
                </div>

                {/* Clean Sheet Select */}
                <div className="prediction-col">
                  <label>Clean Sheet (1 pt)</label>
                  <div className="inline-choice-group">
                    <button
                      type="button"
                      className={`choice-btn ${cleanSheet === 'yes' ? 'active' : ''}`}
                      onClick={() => setCleanSheet('yes')}
                      disabled={saving}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className={`choice-btn ${cleanSheet === 'no' ? 'active' : ''}`}
                      onClick={() => setCleanSheet('no')}
                      disabled={saving}
                    >
                      No
                    </button>
                  </div>
                </div>

                {/* Save button */}
                <div className="prediction-col action" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', width: '100%' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: '13px', width: '90px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexShrink: 0 }}
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                  >
                    <Save size={13} />
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  {lastSavedTime && (
                    <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: '600', whiteSpace: 'nowrap' }}>
                      Saved at {lastSavedTime}
                    </span>
                  )}
                </div>
              </div>
              {error && <div className="inline-error-text">{error}</div>}
            </div>
          )
        ) : (
          <div className="locked-icon-container" style={{ justifyContent: 'center', width: '100%', padding: '10px 0', border: '1px dashed var(--glass-border)', borderRadius: '8px', background: 'rgba(255,255,255,0.01)', fontSize: '13px' }}>
            <HelpCircle size={14} />
            Please select your name from the leaderboard dropdown to place predictions.
          </div>
        )}

        {/* Shared Players' Picks component */}
        <PlayerPicksList
          m={m}
          allPredictions={allPredictions}
          leaderboard={leaderboard}
          activeParticipantId={activeParticipantId}
          runningPointsMap={runningPointsMap}
          winnerLocalState={{
            winner,
            overUnder,
            homeScore,
            awayScore,
            totalCards,
            firstScorer,
            highestScoringHalf,
            cleanSheet
          }}
          showLiveResults={showLiveResults}
          onRefresh={onRefresh}
        />

      </div>
      </>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '10px' }}>
        {/* Feed Tab Buttons (above the feed panel) */}
        {!isCollapsed && (m.status !== 'scheduled' || m.espn_event_id) && (
          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <button 
              type="button"
              onClick={() => setFeedTab(feedTab === 'stats' ? null : 'stats')}
              className={feedTab === 'stats' ? '' : 'btn-secondary'}
              style={{ 
                flex: 1,
                fontSize: '12px', 
                padding: '6px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                justifyContent: 'center',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                fontWeight: feedTab === 'stats' ? '700' : '500',
                color: feedTab === 'stats' ? 'var(--primary)' : undefined,
              }}
            >
              {feedTab === 'stats' ? 'Click To Close' : 'Match Stats'}
            </button>
            <button 
              type="button"
              onClick={() => setFeedTab(feedTab === 'commentary' ? null : 'commentary')}
              className={feedTab === 'commentary' ? '' : 'btn-secondary'}
              style={{ 
                flex: 1,
                fontSize: '12px', 
                padding: '6px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                justifyContent: 'center',
                border: '1px solid var(--glass-border)',
                borderRadius: '8px',
                fontWeight: feedTab === 'commentary' ? '700' : '500',
                color: feedTab === 'commentary' ? 'var(--primary)' : undefined,
              }}
            >
              <Radio size={12} className={m.status === 'live' ? 'pulse-icon' : ''} />
              {feedTab === 'commentary' ? 'Click To Close' : 'Live Commentary'}
            </button>
          </div>
        )}
      </div>

      {/* Live Feed Panel (below the buttons) */}
      {!isCollapsed && feedTab && (
        <LiveFeed
          espnEventId={m.espn_event_id}
          matchStatus={isLive ? 'live' : m.status}
          homeCode={m.home_code || (m.home_team_name || '').substring(0, 3).toUpperCase()}
          awayCode={m.away_code || (m.away_team_name || '').substring(0, 3).toUpperCase()}
          match={m}
          allPredictions={allPredictions}
          leaderboard={leaderboard}
          tab={feedTab}
          onScoreUpdate={(h, a) => setLiveScores({ home: h, away: a })}
        />
      )}

      {/* Show/Hide Details Button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '10px' }}>
        {m.finished === 1 && (
          <button 
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="btn-secondary"
            style={{ 
              alignSelf: 'center', 
              fontSize: '12px', 
              padding: '6px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              width: '100%',
              justifyContent: 'center',
              border: '1px solid var(--glass-border)',
              borderRadius: '8px'
            }}
          >
            {isCollapsed ? (
              <>
                Show Details & Picks <ChevronDown size={14} />
              </>
            ) : (
              <>
                Hide Details & Picks <ChevronUp size={14} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default function MatchesList({ matches, predictions, activeParticipantId, onSave, selectedMatchId, onSelectMatch, allPredictions = [], leaderboard = [], onRefresh }) {
  const [filterStage, setFilterStage] = useState('all'); // 'all', 'group', 'knockouts', 'live'

  const runningPointsMap = useMemo(() => {
    const map = {};
    const sorted = [...matches].sort((a, b) => {
      const dateA = new Date((a.local_date || '').replace(' ', 'T'));
      const dateB = new Date((b.local_date || '').replace(' ', 'T'));
      if (dateA - dateB !== 0) return dateA - dateB;
      return a.id - b.id;
    });

    leaderboard.forEach(p => {
      let runningSum = 0;
      sorted.forEach(m => {
        if (m.finished === 1) {
          const pred = allPredictions.find(ap => ap.match_id === m.id && ap.participant_id === p.id);
          if (pred) {
            runningSum += pred.total_points || 0;
          }
        }
        map[`${p.id}_${m.id}`] = runningSum;
      });
    });

    return map;
  }, [matches, allPredictions, leaderboard]);

  useEffect(() => {
    if (selectedMatchId) {
      const match = matches.find(m => m.id === selectedMatchId);
      if (match) {
        setFilterStage('all');
        setTimeout(() => {
          const element = document.getElementById(`match-card-${selectedMatchId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('match-card-highlight');
            setTimeout(() => {
              element.classList.remove('match-card-highlight');
            }, 3000);
          }
          if (onSelectMatch) {
            onSelectMatch(null);
          }
        }, 150);
      }
    }
  }, [selectedMatchId, matches, onSelectMatch]);

  const stages = [
    { id: 'all', label: 'All Matches' },
    { id: 'group', label: 'Group Stage' },
    { id: 'knockouts', label: 'Knockout Stage' },
    { id: 'live', label: 'Live & Finished' }
  ];

  // Helper to categorize rounds
  const getMatchCategory = (match) => {
    const type = match.type || 'group';
    if (['r32', 'r16', 'qf', 'sf', 'third', 'final'].includes(type.toLowerCase())) {
      return 'knockouts';
    }
    return 'group';
  };

  // Filter logic
  const filteredMatches = matches.filter(m => {
    if (filterStage === 'all') return true;
    if (filterStage === 'group') return getMatchCategory(m) === 'group';
    if (filterStage === 'knockouts') return getMatchCategory(m) === 'knockouts';
    if (filterStage === 'live') return m.status === 'live' || m.finished === 1;
    return true;
  });

  // Helper to find prediction for a match
  const getPredictionForMatch = (matchId) => {
    return predictions.find(p => p.match_id === matchId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Tabs */}
      <div className="stage-tabs">
        {stages.map(s => (
          <button
            key={s.id}
            className={`stage-tab ${filterStage === s.id ? 'active' : ''}`}
            onClick={() => setFilterStage(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Match List */}
      <div className="matches-list">
        {filteredMatches.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No matches found for this stage.
          </div>
        ) : (
          filteredMatches.map(m => (
            <MatchCard
              key={m.id}
              m={m}
              pred={getPredictionForMatch(m.id)}
              activeParticipantId={activeParticipantId}
              onSave={onSave}
              allPredictions={allPredictions}
              leaderboard={leaderboard}
              runningPointsMap={runningPointsMap}
              selectedMatchId={selectedMatchId}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
    </div>
  );
}
