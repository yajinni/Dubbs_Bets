import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Lock, TrendingUp, HelpCircle, Save, Users, CheckCircle } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';

function MatchCard({ m, pred, activeParticipantId, onSave, allPredictions = [], leaderboard = [], runningPointsMap = {} }) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary-hover)', letterSpacing: '0.05em' }}>
          {getRoundLabel(m)}
        </span>
        <span style={{ fontSize: '14px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
          <Calendar size={14} />
          {formatMatchDate(m.local_date)}
        </span>
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
              <span>{m.home_score}</span>
              <span className="score-divider">-</span>
              <span>{m.away_score}</span>
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
              if (!hw || !aw || hw === aw) return (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Even match — no underdog</div>
              );
              const underdogName = hw < aw ? homeName : awayName;
              const underdogPct = hw < aw ? hw : aw;
              return (
                <div style={{ fontSize: '13px', color: '#fbbf24', fontWeight: '700' }}>
                  ⭐ {underdogName} ({underdogPct}%) — Pick them to win for +1 bonus point!
                </div>
              );
            })()
            }
          </div>
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
                  {m.home_score > m.away_score ? homeName : m.away_score > m.home_score ? awayName : 'Draw'}
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
                  {(m.home_score + m.away_score) > m.over_under_line ? 'Over' : 'Under'} {m.over_under_line}
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
                    const secondHalfGoals = (m.home_score + m.away_score) - firstHalfGoals;
                    return firstHalfGoals > secondHalfGoals ? '1st Half' : secondHalfGoals > firstHalfGoals ? '2nd Half' : 'Equal';
                  })()}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '700' }}>Clean Sheet</span>
                <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)', textTransform: 'uppercase' }}>
                  {m.home_score === 0 || m.away_score === 0 ? 'Yes' : 'No'}
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
              <div className="locked-icon-container">
                <Lock size={12} />
                Locked (Started/Finished)
              </div>
              {pred ? (
                <div style={{ textAlign: 'right' }}>


                </div>
              ) : (
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

                {/* Score inputs */}
                <div className="prediction-col">
                  <label>Exact Score (4 pts)</label>
                  <div className="inline-score-inputs">
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

        {/* Players' Picks */}
        {activeParticipantId && (
          <div style={{ marginTop: '16px', borderTop: '1px dashed var(--glass-border)', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Users size={12} strokeWidth={2.5} />
              Players' Picks
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {leaderboard.length === 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '10px' }}>No players yet.</span>
              ) : (
                leaderboard.map(op => {
                  const opPred = allPredictions.find(ap => ap.match_id === m.id && ap.participant_id === op.id);
                  const isSelf = op.id === activeParticipantId;
                  
                  // Construct displaying predictions: if it is self, read from current local state in real-time
                  let displayPred = opPred;
                  if (isSelf) {
                    displayPred = {
                      predicted_winner: winner || null,
                      predicted_over_under: overUnder || null,
                      predicted_home_score: homeScore !== '' ? parseInt(homeScore) : null,
                      predicted_away_score: awayScore !== '' ? parseInt(awayScore) : null,
                      predicted_total_cards: totalCards !== '' ? parseInt(totalCards) : null,
                      predicted_first_scorer: firstScorer || null,
                      predicted_highest_scoring_half: highestScoringHalf || null,
                      predicted_clean_sheet: cleanSheet || null,
                      total_points: opPred ? opPred.total_points : 0
                    };
                  }

                  // Determine actual match results if finished
                  let actualWinner = null;
                  let actualOU = null;
                  let actualHighestHalf = null;
                  let actualCleanSheet = null;
                  if (m.finished === 1) {
                    if (m.home_score > m.away_score) actualWinner = 'home';
                    else if (m.away_score > m.home_score) actualWinner = 'away';
                    else actualWinner = 'draw';

                    const totalGoals = m.home_score + m.away_score;
                    actualOU = totalGoals > m.over_under_line ? 'over' : 'under';

                    if (m.home_ht_score !== null && m.home_ht_score !== undefined && m.away_ht_score !== null && m.away_ht_score !== undefined) {
                      const firstHalfGoals = m.home_ht_score + m.away_ht_score;
                      const secondHalfGoals = totalGoals - firstHalfGoals;
                      if (firstHalfGoals > secondHalfGoals) actualHighestHalf = 'first';
                      else if (secondHalfGoals > firstHalfGoals) actualHighestHalf = 'second';
                      else actualHighestHalf = 'equal';
                    }

                    actualCleanSheet = (m.home_score === 0 || m.away_score === 0) ? 'yes' : 'no';
                  }

                  // Evaluate predictions correctness
                  const hasWinnerPred = displayPred && displayPred.predicted_winner;
                  const isWinnerCorrect = m.finished === 1 && hasWinnerPred && displayPred.predicted_winner === actualWinner;

                  const hasOUPred = displayPred && displayPred.predicted_over_under;
                  const isOUCorrect = m.finished === 1 && hasOUPred && displayPred.predicted_over_under === actualOU;

                  const homeIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.home_win_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
                  const awayIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.away_win_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
                  const drawIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.draw_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
                  const pickedUnderdog = displayPred && (
                    (displayPred.predicted_winner === 'home' && homeIsUnderdog) ||
                    (displayPred.predicted_winner === 'away' && awayIsUnderdog) ||
                    (displayPred.predicted_winner === 'draw' && drawIsUnderdog)
                  );
                  const underdogBonusEarned = displayPred && displayPred.points_cards_ou > 0;

                  const hasFirstScorerPred = displayPred && displayPred.predicted_first_scorer;
                  const isFirstScorerCorrect = m.finished === 1 && hasFirstScorerPred && displayPred.predicted_first_scorer === m.actual_first_scorer;

                  const hasHalfPred = displayPred && displayPred.predicted_highest_scoring_half;
                  const isHalfCorrect = m.finished === 1 && hasHalfPred && displayPred.predicted_highest_scoring_half === actualHighestHalf;

                  const hasCleanPred = displayPred && displayPred.predicted_clean_sheet;
                  const isCleanCorrect = m.finished === 1 && hasCleanPred && displayPred.predicted_clean_sheet === actualCleanSheet;

                  const hasScorePred = displayPred && displayPred.predicted_home_score !== null && displayPred.predicted_away_score !== null;
                  const isScoreCorrect = m.finished === 1 && hasScorePred && displayPred.predicted_home_score === m.home_score && displayPred.predicted_away_score === m.away_score;

                  const hasTotalCardsPred = displayPred && displayPred.predicted_total_cards !== null;
                  const isTotalCardsCorrect = m.finished === 1 && hasTotalCardsPred && displayPred.predicted_total_cards === m.actual_cards;

                  const homeCode = m.home_code || 'H';
                  const awayCode = m.away_code || 'A';

                  return (
                    <div key={op.id} className="player-result-row" style={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: '6px', 
                      background: isSelf ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255, 255, 255, 0.01)', 
                      borderRadius: '6px', 
                      border: '1px solid var(--glass-border)',
                      padding: '8px 12px'
                    }}>
                      {/* Name & Points (inline) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#ffffff' }}>
                          {op.name}
                        </span>
                        <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '11px' }}>
                          [Match: {displayPred && m.finished === 1 ? displayPred.total_points : 0} pts]
                        </span>
                        <span style={{ color: 'var(--info)', fontWeight: '700', fontSize: '11px' }}>
                          [Current: {runningPointsMap[`${op.id}_${m.id}`] || 0} pts]
                        </span>
                        <span style={{ color: 'var(--primary-hover)', fontWeight: '700', fontSize: '11px' }}>
                          [Total: {op.total_points} pts]
                        </span>
                      </div>

                      {/* Prediction Badges Horizontal Scroll (Synced) */}
                      <div 
                        className={`bets-scroll-${m.id}`}
                        onScroll={(e) => handleScroll(e, m.id)}
                        style={{ width: '100%', overflowX: 'auto', paddingBottom: '4px' }}
                      >
                        {displayPred ? (
                          <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: '45px 22px 46px 52px 62px 48px 48px 42px', 
                            gap: '4px',
                            minWidth: '370px'
                          }}>
                            {/* Winner */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              background: m.finished === 1 ? (isWinnerCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)',
                              border: m.finished === 1 ? (isWinnerCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)'
                            }}>
                              {displayPred.predicted_winner === 'home' ? homeCode : displayPred.predicted_winner === 'away' ? awayCode : displayPred.predicted_winner === 'draw' ? 'Draw' : '-'}
                            </span>

                            {/* O/U */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              background: displayPred.predicted_over_under ? (m.finished === 1 ? (isOUCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                              border: displayPred.predicted_over_under ? (m.finished === 1 ? (isOUCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                            }}>
                              {displayPred.predicted_over_under === 'over' ? 'O' : displayPred.predicted_over_under === 'under' ? 'U' : '-'}
                            </span>

                            {/* Score */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              whiteSpace: 'nowrap',
                              background: hasScorePred ? (m.finished === 1 ? (isScoreCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                              border: hasScorePred ? (m.finished === 1 ? (isScoreCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                            }}>
                              {hasScorePred ? `${displayPred.predicted_home_score}-${displayPred.predicted_away_score}` : '-'}
                            </span>

                            {/* Underdog Pick */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              background: (displayPred.predicted_winner && displayPred.predicted_winner !== 'draw') ? (m.finished === 1 ? (underdogBonusEarned ? 'rgba(16, 185, 129, 0.25)' : (pickedUnderdog ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.05)')) : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                              border: (displayPred.predicted_winner && displayPred.predicted_winner !== 'draw') ? (m.finished === 1 ? (underdogBonusEarned ? '1px solid rgba(16, 185, 129, 0.4)' : (pickedUnderdog ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)')) : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                            }}>
                              {(displayPred.predicted_winner && displayPred.predicted_winner !== 'draw') ? (pickedUnderdog ? 'Bonus' : 'fav') : '-'}
                            </span>

                            {/* Scored First */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              background: hasFirstScorerPred ? (m.finished === 1 ? (isFirstScorerCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                              border: hasFirstScorerPred ? (m.finished === 1 ? (isFirstScorerCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                            }}>
                              {hasFirstScorerPred ? `SF:${displayPred.predicted_first_scorer === 'home' ? homeCode : displayPred.predicted_first_scorer === 'away' ? awayCode : 'None'}` : '-'}
                            </span>

                            {/* Total Cards */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              background: hasTotalCardsPred ? (m.finished === 1 ? (isTotalCardsCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                              border: hasTotalCardsPred ? (m.finished === 1 ? (isTotalCardsCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                            }}>
                              {displayPred.predicted_total_cards !== null && displayPred.predicted_total_cards !== undefined ? `TC:${displayPred.predicted_total_cards}` : '-'}
                            </span>

                            {/* Highest scoring half */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              background: hasHalfPred ? (m.finished === 1 ? (isHalfCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                              border: hasHalfPred ? (m.finished === 1 ? (isHalfCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                            }}>
                              {hasHalfPred ? `H:${displayPred.predicted_highest_scoring_half === 'first' ? '1st' : displayPred.predicted_highest_scoring_half === 'second' ? '2nd' : 'Eq'}` : '-'}
                            </span>

                            {/* Clean sheet */}
                            <span style={{ 
                              padding: '4px 6px', 
                              borderRadius: '6px', 
                              fontSize: '12px',
                              fontWeight: '600',
                              color: '#ffffff',
                              textAlign: 'center',
                              background: hasCleanPred ? (m.finished === 1 ? (isCleanCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                              border: hasCleanPred ? (m.finished === 1 ? (isCleanCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
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
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MatchesList({ matches, predictions, activeParticipantId, onSave, selectedMatchId, onSelectMatch, allPredictions = [], leaderboard = [] }) {
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

  // Filter stage tabs definitions
  const stages = [
    { id: 'info', label: 'ℹ️ Info' },
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

      {/* Info Panel */}
      {filterStage === 'info' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Header */}
          <div className="glass-panel" style={{ borderLeft: '4px solid var(--primary)' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 6px 0' }}>How Betting Works</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Before each match kicks off, place your predictions below. Once the match starts, your picks are locked in.
              Points are awarded automatically when results are confirmed.
            </p>
          </div>

          {/* Bet types grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>

            {/* Winner */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #a855f7', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>🏆 Match Winner</span>
                <span style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>3 pts</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Pick who wins — <strong style={{ color: 'var(--text-primary)' }}>Home</strong>, <strong style={{ color: 'var(--text-primary)' }}>Away</strong>, or <strong style={{ color: 'var(--text-primary)' }}>Draw</strong>.
                3 points awarded if your pick matches the final result.
              </p>
            </div>

            {/* Goals O/U */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #22c55e', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>⚽ Goals Over / Under</span>
                <span style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>1 pt</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Will the total goals be <strong style={{ color: 'var(--text-primary)' }}>Over</strong> or <strong style={{ color: 'var(--text-primary)' }}>Under</strong> the line shown on each match (e.g. 2.5)?
                1 point if correct.
              </p>
            </div>

            {/* Underdog Bonus */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #fbbf24', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>🐉 Underdog Bonus</span>
                <span style={{ background: 'rgba(251,191,36,0.2)', color: '#fbbf24', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>+1 pt</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                If you pick the team with the <strong style={{ color: '#fbbf24' }}>lower win probability</strong> and they actually win, you earn a bonus point automatically — no extra pick needed!
              </p>
            </div>

            {/* First Scorer */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #ec4899', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>🎯 Scored First</span>
                <span style={{ background: 'rgba(236,72,153,0.2)', color: '#f472b6', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>2 pts</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Pick which team scores first — <strong style={{ color: 'var(--text-primary)' }}>Home</strong>, <strong style={{ color: 'var(--text-primary)' }}>Away</strong>, or <strong style={{ color: 'var(--text-primary)' }}>No Goal</strong> (0-0).
                2 points if correct.
              </p>
            </div>

            {/* Exact Score */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #eab308', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>📊 Exact Scoreline</span>
                <span style={{ background: 'rgba(234,179,8,0.2)', color: '#fde047', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>4 pts</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Predict the exact final score (e.g. <strong style={{ color: 'var(--text-primary)' }}>2 – 1</strong>).
                Worth <strong style={{ color: '#fde047' }}>4 points</strong> — the biggest single reward!
              </p>
            </div>

            {/* Exact Total Cards */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #06b6d4', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>🟨 Exact Total Cards</span>
                <span style={{ background: 'rgba(6,182,212,0.2)', color: '#67e8f9', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>3 pts</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Guess the <strong style={{ color: 'var(--text-primary)' }}>exact number of yellow + red cards</strong> shown in the match.
                3 points if you nail it exactly.
              </p>
            </div>

            {/* Highest Scoring Half */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #c084fc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>⏰ Highest Scoring Half</span>
                <span style={{ background: 'rgba(192,132,252,0.2)', color: '#c084fc', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>2 pts</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Predict which half will have more total goals scored — <strong style={{ color: 'var(--text-primary)' }}>1st Half</strong>, <strong style={{ color: 'var(--text-primary)' }}>2nd Half</strong>, or <strong style={{ color: 'var(--text-primary)' }}>Equal</strong>.
                2 points if correct.
              </p>
            </div>

            {/* Clean Sheet */}
            <div className="glass-panel" style={{ borderLeft: '4px solid #38bdf8', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '15px', fontWeight: '800' }}>🧤 Clean Sheet</span>
                <span style={{ background: 'rgba(56,189,248,0.2)', color: '#38bdf8', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>1 pt</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
                Will at least one team keep a clean sheet (i.e. score 0 goals)?
                Choose <strong style={{ color: 'var(--text-primary)' }}>Yes</strong> or <strong style={{ color: 'var(--text-primary)' }}>No</strong>.
                1 point if correct.
              </p>
            </div>

          </div>

          {/* Max points summary */}
          <div className="glass-panel" style={{ background: 'rgba(139,92,246,0.07)', borderLeft: '4px solid var(--primary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '800', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔢 Maximum Points Per Match</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {[
                { label: 'Winner', pts: 3, color: '#a855f7' },
                { label: 'Goals O/U', pts: 1, color: '#22c55e' },
                { label: 'Underdog Bonus', pts: 1, color: '#fbbf24' },
                { label: 'Scored First', pts: 2, color: '#ec4899' },
                { label: 'Exact Score', pts: 4, color: '#eab308' },
                { label: 'Exact Cards', pts: 3, color: '#06b6d4' },
                { label: 'Highest scoring Half', pts: 2, color: '#c084fc' },
                { label: 'Clean Sheet', pts: 1, color: '#38bdf8' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{item.label}</span>
                  <span style={{ fontSize: '14px', fontWeight: '800', color: item.color }}>+{item.pts}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139,92,246,0.15)', padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(139,92,246,0.3)' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Total Max</span>
                <span style={{ fontSize: '16px', fontWeight: '900', color: '#c084fc' }}>18 pts</span>
              </div>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              Picks are locked the moment a match kicks off. Make sure you submit before then!
            </p>
          </div>
        </div>
      )}

      {/* Match List */}
      {filterStage !== 'info' && (
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
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
