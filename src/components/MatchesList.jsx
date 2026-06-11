import React, { useState, useEffect } from 'react';
import { Calendar, Lock, TrendingUp, HelpCircle, Save, Users } from 'lucide-react';

function MatchCard({ m, pred, activeParticipantId, onSave, allPredictions = [], leaderboard = [] }) {
  const isLocked = new Date(m.local_date).getTime() <= Date.now() || m.status !== 'scheduled' || m.finished === 1;
  const homeName = m.home_team_name || m.home_team_label || 'TBD';
  const awayName = m.away_team_name || m.away_team_label || 'TBD';
  const otherParticipants = leaderboard.filter(p => p.id !== activeParticipantId);

  // Calculate implied Over/Under probabilities
  const overOdds = m.over_odds || 1.9;
  const underOdds = m.under_odds || 1.9;
  const pOver = overOdds > 0 ? 1.0 / overOdds : 0.5;
  const pUnder = underOdds > 0 ? 1.0 / underOdds : 0.5;
  const sumOU = pOver + pUnder;
  const overPct = sumOU > 0 ? Math.round((pOver / sumOU) * 100) : 50;
  const underPct = 100 - overPct;

  // Local state for the inline prediction inputs
  const [winner, setWinner] = useState('');
  const [overUnder, setOverUnder] = useState('');
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
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
    } else {
      setWinner('');
      setOverUnder('');
      setHomeScore('');
      setAwayScore('');
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

    if (!pred) {
      return currentWinner !== '' || currentOU !== '' || currentHome !== '' || currentAway !== '';
    }

    const matchWinner = currentWinner === (pred.predicted_winner || '');
    const matchOU = currentOU === (pred.predicted_over_under || '');
    const matchHome = currentHome === (pred.predicted_home_score !== null ? pred.predicted_home_score.toString() : '');
    const matchAway = currentAway === (pred.predicted_away_score !== null ? pred.predicted_away_score.toString() : '');

    return !(matchWinner && matchOU && matchHome && matchAway);
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
    if (homeScore === '' || awayScore === '') {
      setError('Enter both scores.');
      return;
    }

    const hScore = parseInt(homeScore);
    const aScore = parseInt(awayScore);

    if (isNaN(hScore) || isNaN(aScore) || hScore < 0 || aScore < 0) {
      setError('Positive numbers only.');
      return;
    }

    // Logical validations matching outcomes
    if (winner === 'home' && hScore <= aScore) {
      setError(`${homeName} must score more to win.`);
      return;
    }
    if (winner === 'away' && aScore <= hScore) {
      setError(`${awayName} must score more to win.`);
      return;
    }
    if (winner === 'draw' && hScore !== aScore) {
      setError('Scores must be equal for Draw.');
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
    if (!normalized.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
      normalized += 'Z';
    }
    const date = new Date(normalized);
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
          <TrendingUp size={14} className="text-secondary" />
          3rd Party Match Analysis
        </div>
        <div className="analytics-grid">
          <div className="analytics-item">
            <div className="analytics-labels">
              <span>{homeName}: {m.home_win_pct}%</span>
              <span>Draw: {m.draw_pct}%</span>
              <span>{awayName}: {m.away_win_pct}%</span>
            </div>
            <div className="win-pct-bar">
              <div className="win-pct-segment home" style={{ width: `${m.home_win_pct}%` }}></div>
              <div className="win-pct-segment draw" style={{ width: `${m.draw_pct}%` }}></div>
              <div className="win-pct-segment away" style={{ width: `${m.away_win_pct}%` }}></div>
            </div>
          </div>
          <div className="analytics-item">
            <div className="analytics-labels">
              <span>Under {m.over_under_line}: {underPct}%</span>
              <span>Over {m.over_under_line}: {overPct}%</span>
            </div>
            <div className="ou-pct-bar">
              <div className="ou-pct-segment under" style={{ width: `${underPct}%` }}></div>
              <div className="ou-pct-segment over" style={{ width: `${overPct}%` }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Predictions Section */}
      <div className="match-stats-drawer" style={{ gridTemplateColumns: '1fr', borderTop: '1px solid var(--glass-border)', paddingTop: '16px', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
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
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Pick: <span style={{ color: 'var(--text-primary)', fontWeight: '700' }}>
                      {pred.predicted_winner === 'home' ? homeName : pred.predicted_winner === 'away' ? awayName : 'Draw'}
                    </span>
                    {` | `}
                    <span style={{ color: 'var(--warning)', fontWeight: '700' }}>
                      {pred.predicted_over_under.toUpperCase()} {m.over_under_line}
                    </span>
                    {` | Score: `}
                    <span style={{ color: 'var(--text-primary)', fontWeight: '700' }}>
                      {pred.predicted_home_score}-{pred.predicted_away_score}
                    </span>
                  </span>
                  {m.finished === 1 && (
                    <div className="prediction-badge-display" style={{ justifyContent: 'flex-end', marginTop: '6px' }}>
                      <span className={`p-point-dot ${pred.points_winner ? 'earned' : ''}`}></span>
                      <span style={{ color: pred.points_winner ? 'var(--success)' : 'var(--text-muted)' }}>W</span>
                      <span className={`p-point-dot ${pred.points_ou ? 'earned' : ''}`}></span>
                      <span style={{ color: pred.points_ou ? 'var(--success)' : 'var(--text-muted)' }}>O/U</span>
                      <span className={`p-point-dot ${pred.points_score ? 'earned' : ''}`}></span>
                      <span style={{ color: pred.points_score ? 'var(--success)' : 'var(--text-muted)' }}>S</span>
                      <span style={{ marginLeft: '6px', color: 'var(--primary-hover)', fontWeight: '700' }}>
                        (+{pred.total_points} pts)
                      </span>
                    </div>
                  )}
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
                  <label>Winner (1 pt)</label>
                  <div className="inline-choice-group">
                    <button
                      type="button"
                      className={`choice-btn ${winner === 'home' ? 'active' : ''}`}
                      onClick={() => setWinner('home')}
                      disabled={saving}
                    >
                      {homeName}
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
                      {awayName}
                    </button>
                  </div>
                </div>

                {/* Over/Under Select */}
                <div className="prediction-col">
                  <label>Total Goals (1 pt)</label>
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

                {/* Score inputs */}
                <div className="prediction-col">
                  <label>Exact Score (3 pts)</label>
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

        {/* Other Players' Picks */}
        {activeParticipantId && (
          <div style={{ marginTop: '16px', borderTop: '1px dashed var(--glass-border)', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Users size={12} strokeWidth={2.5} />
              Other Players' Picks
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
              {otherParticipants.length === 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No other players yet.</span>
              ) : (
                otherParticipants.map(op => {
                  const opPred = allPredictions.find(ap => ap.match_id === m.id && ap.participant_id === op.id);
                  return (
                    <div key={op.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.01)', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--glass-border)' }}>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-secondary)' }}>{op.name}</span>
                      {opPred ? (
                        <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '600' }}>
                          {opPred.predicted_winner === 'home' ? m.home_code || 'H' : opPred.predicted_winner === 'away' ? m.away_code || 'A' : 'D'}
                          {` | `}
                          <span style={{ color: 'var(--warning)' }}>{opPred.predicted_over_under.toUpperCase()}</span>
                          {` | `}
                          {opPred.predicted_home_score}-{opPred.predicted_away_score}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          None ⏳
                        </span>
                      )}
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

      {/* List */}
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
            />
          ))
        )}
      </div>
    </div>
  );
}
