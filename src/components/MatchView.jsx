import React, { useState } from 'react';
import { Calendar, Users, CheckCircle, XCircle, Clock } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';

export default function MatchView({ matches, allPredictions = [], leaderboard = [], activeParticipantId }) {
  const [filterStage, setFilterStage] = useState('all'); // 'all', 'group', 'knockouts', 'live'

  // Stage tab definitions
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

  // Filter matches
  const filteredMatches = matches.filter(m => {
    if (filterStage === 'all') return true;
    if (filterStage === 'group') return getMatchCategory(m) === 'group';
    if (filterStage === 'knockouts') return getMatchCategory(m) === 'knockouts';
    if (filterStage === 'live') return m.status === 'live' || m.finished === 1;
    return true;
  });

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

      {/* Matches comparison list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {filteredMatches.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No matches found for this stage.
          </div>
        ) : (
          filteredMatches.map(m => {
            const homeName = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
            const awayName = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');
            const homeCode = m.home_code || 'H';
            const awayCode = m.away_code || 'A';
            
            // Determine match results if finished
            let actualWinner = null;
            let actualOU = null;
            if (m.finished === 1) {
              if (m.home_score > m.away_score) actualWinner = 'home';
              else if (m.away_score > m.home_score) actualWinner = 'away';
              else actualWinner = 'draw';

              const totalGoals = m.home_score + m.away_score;
              actualOU = totalGoals > m.over_under_line ? 'over' : 'under';
            }

            return (
              <div key={m.id} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
                
                {/* Match Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary-hover)', letterSpacing: '0.05em' }}>
                      {getRoundLabel(m)}
                    </span>
                    <span style={{ fontSize: '16px', fontWeight: '800', fontFamily: 'var(--font-heading)' }}>
                      {homeName} vs {awayName}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
                      <Calendar size={14} />
                      {formatMatchDate(m.local_date)}
                    </span>
                    {m.status !== 'scheduled' ? (
                      <div className="score-display" style={{ fontSize: '16px', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '6px', fontWeight: '800', display: 'flex', gap: '6px' }}>
                        <span>{m.home_score}</span>
                        <span>-</span>
                        <span>{m.away_score}</span>
                        <span className={`match-badge ${m.status}`} style={{ fontSize: '9px', padding: '2px 6px', marginLeft: '6px' }}>
                          {m.status === 'live' ? 'Live' : 'FT'}
                        </span>
                      </div>
                    ) : (
                      <span className="match-badge scheduled" style={{ fontSize: '10px', padding: '4px 8px' }}>Scheduled</span>
                    )}
                  </div>
                </div>

                {/* Table of predictions */}
                <div style={{ overflowX: 'auto' }}>
                  <table className="leaderboard-table" style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Player</th>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Winner Pick</th>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Over / Under ({m.over_under_line})</th>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Cards O/U ({m.cards_line || 3.5})</th>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>First Scorer</th>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Exact Score</th>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Total Cards</th>
                        <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textAlign: 'right' }}>Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map(p => {
                        const pred = allPredictions.find(ap => ap.match_id === m.id && ap.participant_id === p.id);
                        const isSelf = p.id === activeParticipantId;
                        
                        // Evaluate predictions correctness
                        const hasWinnerPred = pred && pred.predicted_winner;
                        const isWinnerCorrect = m.finished === 1 && hasWinnerPred && pred.predicted_winner === actualWinner;

                        const hasOUPred = pred && pred.predicted_over_under;
                        const isOUCorrect = m.finished === 1 && hasOUPred && pred.predicted_over_under === actualOU;

                        let actualCardsOU = null;
                        if (m.finished === 1 && m.actual_cards !== null) {
                          actualCardsOU = m.actual_cards > (m.cards_line || 3.5) ? 'over' : 'under';
                        }
                        const hasCardsPred = pred && pred.predicted_cards_over_under;
                        const isCardsCorrect = m.finished === 1 && hasCardsPred && pred.predicted_cards_over_under === actualCardsOU;

                        const hasFirstScorerPred = pred && pred.predicted_first_scorer;
                        const isFirstScorerCorrect = m.finished === 1 && hasFirstScorerPred && pred.predicted_first_scorer === m.actual_first_scorer;

                        const hasScorePred = pred && pred.predicted_home_score !== null && pred.predicted_away_score !== null;
                        const isScoreCorrect = m.finished === 1 && hasScorePred && pred.predicted_home_score === m.home_score && pred.predicted_away_score === m.away_score;

                        const hasTotalCardsPred = pred && pred.predicted_total_cards !== null;
                        const isTotalCardsCorrect = m.finished === 1 && hasTotalCardsPred && pred.predicted_total_cards === m.actual_cards;

                        return (
                          <tr 
                            key={p.id} 
                            style={{ 
                              borderBottom: '1px solid rgba(255,255,255,0.02)',
                              background: isSelf ? 'rgba(139, 92, 246, 0.05)' : 'transparent'
                            }}
                          >
                            {/* Player Name */}
                            <td style={{ padding: '12px', fontSize: '13px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{p.name}</span>
                              {isSelf && <span style={{ fontSize: '9px', background: 'var(--primary)', color: '#fff', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase' }}>You</span>}
                            </td>

                            {/* Winner Prediction */}
                            <td style={{ padding: '12px', fontSize: '13px' }}>
                              {hasWinnerPred ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: '600' }}>
                                    {pred.predicted_winner === 'home' ? homeName : pred.predicted_winner === 'away' ? awayName : 'Draw'}
                                  </span>
                                  {m.finished === 1 && (
                                    isWinnerCorrect ? (
                                      <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0 }} />
                                    ) : (
                                      <XCircle size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                                    )
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>None ⏳</span>
                              )}
                            </td>

                            {/* O/U Prediction */}
                            <td style={{ padding: '12px', fontSize: '13px' }}>
                              {hasOUPred ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: '600', textTransform: 'uppercase', color: 'var(--warning)' }}>
                                    {pred.predicted_over_under}
                                  </span>
                                  {m.finished === 1 && (
                                    isOUCorrect ? (
                                      <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0 }} />
                                    ) : (
                                      <XCircle size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                                    )
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>None ⏳</span>
                              )}
                            </td>

                            {/* Cards O/U Prediction */}
                            <td style={{ padding: '12px', fontSize: '13px' }}>
                              {hasCardsPred ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: '600', textTransform: 'uppercase', color: 'var(--success)' }}>
                                    {pred.predicted_cards_over_under}
                                  </span>
                                  {m.finished === 1 && (
                                    isCardsCorrect ? (
                                      <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0 }} />
                                    ) : (
                                      <XCircle size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                                    )
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>None ⏳</span>
                              )}
                            </td>

                            {/* First Scorer Prediction */}
                            <td style={{ padding: '12px', fontSize: '13px' }}>
                              {hasFirstScorerPred ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: '600', color: 'var(--primary-hover)' }}>
                                    {pred.predicted_first_scorer === 'home' ? homeName : pred.predicted_first_scorer === 'away' ? awayName : 'No Goal'}
                                  </span>
                                  {m.finished === 1 && (
                                    isFirstScorerCorrect ? (
                                      <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0 }} />
                                    ) : (
                                      <XCircle size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                                    )
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>None ⏳</span>
                              )}
                            </td>

                            {/* Score Prediction */}
                            <td style={{ padding: '12px', fontSize: '13px' }}>
                              {hasScorePred ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: '600', fontFamily: 'monospace' }}>
                                    {pred.predicted_home_score} - {pred.predicted_away_score}
                                  </span>
                                  {m.finished === 1 && (
                                    isScoreCorrect ? (
                                      <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0 }} />
                                    ) : (
                                      <XCircle size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                                    )
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>None ⏳</span>
                              )}
                            </td>

                            {/* Exact Cards Prediction */}
                            <td style={{ padding: '12px', fontSize: '13px' }}>
                              {hasTotalCardsPred ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontWeight: '600', color: 'var(--secondary-hover)' }}>
                                    {pred.predicted_total_cards} cards
                                  </span>
                                  {m.finished === 1 && (
                                    isTotalCardsCorrect ? (
                                      <CheckCircle size={14} color="var(--success)" style={{ flexShrink: 0 }} />
                                    ) : (
                                      <XCircle size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                                    )
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>None ⏳</span>
                              )}
                            </td>

                            {/* Points Display */}
                            <td style={{ padding: '12px', fontSize: '13px', fontWeight: '700', textAlign: 'right' }}>
                              {pred && m.finished === 1 ? (
                                <span style={{ color: pred.total_points > 0 ? 'var(--primary-hover)' : 'var(--text-muted)' }}>
                                  +{pred.total_points} pts
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
