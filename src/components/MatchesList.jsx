import React, { useState } from 'react';
import { Calendar, Play, CheckCircle2, Lock, Edit2, TrendingUp, HelpCircle } from 'lucide-react';

export default function MatchesList({ matches, predictions, activeParticipantId, onPredictClick }) {
  const [filterStage, setFilterStage] = useState('all'); // 'all', 'group', 'knockouts', 'live'

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

  const formatMatchDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
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
          filteredMatches.map(m => {
            const pred = getPredictionForMatch(m.id);
            const isLocked = new Date(m.local_date).getTime() <= Date.now() || m.status !== 'scheduled' || m.finished === 1;
            
            // Format labels for knockout matches where teams are not yet determined
            const homeName = m.home_team_name || m.home_team_label || 'TBD';
            const awayName = m.away_team_name || m.away_team_label || 'TBD';

            // Calculate implied Over/Under probabilities
            const overOdds = m.over_odds || 1.9;
            const underOdds = m.under_odds || 1.9;
            const pOver = overOdds > 0 ? 1.0 / overOdds : 0.5;
            const pUnder = underOdds > 0 ? 1.0 / underOdds : 0.5;
            const sumOU = pOver + pUnder;
            const overPct = sumOU > 0 ? Math.round((pOver / sumOU) * 100) : 50;
            const underPct = 100 - overPct;

            return (
              <div key={m.id} className="glass-panel match-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {/* Header: Stage, Round, and Date */}
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary-hover)', trackingLetter: '0.05em' }}>
                    {getRoundLabel(m)}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={12} />
                    {formatMatchDate(m.local_date)}
                  </span>
                </div>

                {/* Match Score & Teams */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', width: '100%', gap: '16px' }}>
                  
                  {/* Home Team */}
                  <div className="team-container home">
                    <span className="team-name">{homeName}</span>
                    {m.home_flag && <img src={m.home_flag} alt={`${homeName} flag`} className="flag-icon" />}
                  </div>

                  {/* Score / Time Area */}
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

                  {/* Away Team */}
                  <div className="team-container away">
                    {m.away_flag && <img src={m.away_flag} alt={`${awayName} flag`} className="flag-icon" />}
                    <span className="team-name">{awayName}</span>
                  </div>

                </div>

                {/* Odds & Predictions Section */}
                <div className="match-stats-drawer">
                  
                  {/* Unified Match Analytics Box */}
                  <div className="match-analytics-box">
                    <div className="analytics-title">
                      <TrendingUp size={14} className="text-secondary" />
                      Implied Match Analytics
                    </div>
                    
                    <div className="analytics-grid">
                      {/* Win Probability Bar */}
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

                      {/* Goals Expectation Over/Under Bar */}
                      <div className="analytics-item">
                        <div className="analytics-labels">
                          <span>Under {m.over_under_line}: {underPct}% (odds: {underOdds})</span>
                          <span>Over {m.over_under_line}: {overPct}% (odds: {overOdds})</span>
                        </div>
                        <div className="ou-pct-bar">
                          <div className="ou-pct-segment under" style={{ width: `${underPct}%` }}></div>
                          <div className="ou-pct-segment over" style={{ width: `${overPct}%` }}></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* User Prediction */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                    {activeParticipantId ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        {pred ? (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                              Pick: <span style={{ color: 'var(--text-primary)', fontWeight: '700' }}>
                                {pred.predicted_winner === 'home' ? homeName : pred.predicted_winner === 'away' ? awayName : 'Draw'}
                              </span>
                              {` | `}
                              <span style={{ color: 'var(--warning)', fontWeight: '700' }}>
                                {pred.predicted_over_under.toUpperCase()} {m.over_under_line}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              Score: <span style={{ color: 'var(--text-primary)', fontWeight: '700' }}>{pred.predicted_home_score}-{pred.predicted_away_score}</span>
                            </div>

                            {/* Show points earned if match is finished */}
                            {m.finished === 1 && (
                              <div className="prediction-badge-display">
                                <span className={`p-point-dot ${pred.points_winner ? 'earned' : ''}`} title="Winner (1pt)"></span>
                                <span style={{ color: pred.points_winner ? 'var(--success)' : 'var(--text-muted)' }}>W</span>
                                <span className={`p-point-dot ${pred.points_ou ? 'earned' : ''}`} title="O/U (1pt)"></span>
                                <span style={{ color: pred.points_ou ? 'var(--success)' : 'var(--text-muted)' }}>O/U</span>
                                <span className={`p-point-dot ${pred.points_score ? 'earned' : ''}`} title="Exact Score (1pt)"></span>
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
                        
                        {/* Prediction buttons */}
                        <div style={{ marginTop: '4px' }}>
                          {isLocked ? (
                            <div className="locked-icon-container">
                              <Lock size={12} />
                              Locked
                            </div>
                          ) : (
                            <button
                              id={`predict-btn-${m.id}`}
                              className="prediction-summary-btn"
                              onClick={() => onPredictClick(m)}
                            >
                              <Edit2 size={12} style={{ marginRight: '4px' }} />
                              {pred ? 'Change Pick' : 'Predict'}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="locked-icon-container">
                        <HelpCircle size={12} />
                        Select player to predict
                      </div>
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
