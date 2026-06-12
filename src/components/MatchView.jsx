import React, { useState, useEffect } from 'react';
import { Calendar, Users, CheckCircle, XCircle, Clock } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';

export default function MatchView({ matches, allPredictions = [], leaderboard = [], activeParticipantId, selectedMatchId, onClearSelectedMatch }) {
  const [filterStage, setFilterStage] = useState('all'); // 'all', 'group', 'knockouts', 'live'

  // Stage tab definitions
  const stages = [
    { id: 'all', label: 'All Matches' },
    { id: 'group', label: 'Group Stage' },
    { id: 'knockouts', label: 'Knockout Stage' },
    { id: 'live', label: 'Live & Finished' }
  ];

  useEffect(() => {
    if (selectedMatchId) {
      setFilterStage('all');
      setTimeout(() => {
        const element = document.getElementById(`match-view-card-${selectedMatchId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('match-card-highlight');
          setTimeout(() => {
            element.classList.remove('match-card-highlight');
          }, 3000);
        }
        if (onClearSelectedMatch) {
          onClearSelectedMatch();
        }
      }, 150);
    }
  }, [selectedMatchId, matches, onClearSelectedMatch]);

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

            return (
              <div key={m.id} id={`match-view-card-${m.id}`} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
                
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

                {/* Players' Picks Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {leaderboard.length === 0 ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No players yet.</span>
                  ) : (
                    leaderboard.map(p => {
                      const pred = allPredictions.find(ap => ap.match_id === m.id && ap.participant_id === p.id);
                      const isSelf = p.id === activeParticipantId;
                      
                      // Evaluate predictions correctness
                      const hasWinnerPred = pred && pred.predicted_winner;
                      const isWinnerCorrect = m.finished === 1 && hasWinnerPred && pred.predicted_winner === actualWinner;

                      const hasOUPred = pred && pred.predicted_over_under;
                      const isOUCorrect = m.finished === 1 && hasOUPred && pred.predicted_over_under === actualOU;

                      // Underdog bonus evaluation
                      const homeIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.home_win_pct < m.away_win_pct;
                      const awayIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.away_win_pct < m.home_win_pct;
                      const pickedUnderdog = pred && (
                        (pred.predicted_winner === 'home' && homeIsUnderdog) ||
                        (pred.predicted_winner === 'away' && awayIsUnderdog)
                      );
                      const underdogBonusEarned = pred && pred.points_cards_ou > 0;

                      const hasFirstScorerPred = pred && pred.predicted_first_scorer;
                      const isFirstScorerCorrect = m.finished === 1 && hasFirstScorerPred && pred.predicted_first_scorer === m.actual_first_scorer;

                      const hasHalfPred = pred && pred.predicted_highest_scoring_half;
                      const isHalfCorrect = m.finished === 1 && hasHalfPred && pred.predicted_highest_scoring_half === actualHighestHalf;

                      const hasCleanPred = pred && pred.predicted_clean_sheet;
                      const isCleanCorrect = m.finished === 1 && hasCleanPred && pred.predicted_clean_sheet === actualCleanSheet;

                      const hasScorePred = pred && pred.predicted_home_score !== null && pred.predicted_away_score !== null;
                      const isScoreCorrect = m.finished === 1 && hasScorePred && pred.predicted_home_score === m.home_score && pred.predicted_away_score === m.away_score;

                      const hasTotalCardsPred = pred && pred.predicted_total_cards !== null;
                      const isTotalCardsCorrect = m.finished === 1 && hasTotalCardsPred && pred.predicted_total_cards === m.actual_cards;

                      return (
                        <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: isSelf ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255, 255, 255, 0.01)', padding: '8px 10px', borderRadius: '6px', border: isSelf ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid var(--glass-border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ color: 'var(--primary-hover)', fontWeight: '700' }}>[{p.total_points} pts]</span>
                              {p.name}
                              {isSelf && <span style={{ fontSize: '9px', background: 'var(--primary)', color: '#fff', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase' }}>You</span>}
                            </span>
                            {m.finished === 1 && pred && (
                              <span style={{ fontSize: '11px', color: pred.total_points > 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: '700' }}>
                                +{pred.total_points} pts
                              </span>
                            )}
                          </div>
                          <div style={{ width: '100%' }}>
                            {pred ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                                {/* Winner */}
                                <span style={{ 
                                  padding: '4px 8px', 
                                  borderRadius: '6px', 
                                  fontSize: '12px',
                                  fontWeight: '600',
                                  color: '#ffffff',
                                  background: m.finished === 1 ? (isWinnerCorrect ? '#10b981' : '#ef4444') : 'rgba(255, 255, 255, 0.05)',
                                  border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                }}>
                                  {pred.predicted_winner === 'home' ? homeName : pred.predicted_winner === 'away' ? awayName : 'Draw'}
                                </span>

                                {/* O/U */}
                                <span style={{ 
                                  padding: '4px 8px', 
                                  borderRadius: '6px', 
                                  fontSize: '12px',
                                  fontWeight: '600',
                                  color: '#ffffff',
                                  background: m.finished === 1 ? (isOUCorrect ? '#10b981' : '#ef4444') : 'rgba(255, 255, 255, 0.05)',
                                  border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                }}>
                                  {pred.predicted_over_under === 'over' ? 'O' : 'U'}
                                </span>

                                {/* Score */}
                                <span style={{ 
                                  padding: '4px 8px', 
                                  borderRadius: '6px', 
                                  fontSize: '12px',
                                  fontWeight: '600',
                                  color: '#ffffff',
                                  background: m.finished === 1 ? (isScoreCorrect ? '#10b981' : '#ef4444') : 'rgba(255, 255, 255, 0.05)',
                                  border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                }}>
                                  {pred.predicted_home_score}-{pred.predicted_away_score}
                                </span>

                                {/* Underdog Pick */}
                                {pred.predicted_winner && pred.predicted_winner !== 'draw' && (
                                  <span style={{ 
                                    padding: '4px 8px', 
                                    borderRadius: '6px', 
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    color: '#ffffff',
                                    background: m.finished === 1 ? (underdogBonusEarned ? '#10b981' : (pickedUnderdog ? '#ef4444' : 'rgba(255, 255, 255, 0.05)')) : 'rgba(255, 255, 255, 0.05)',
                                    border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                  }}>
                                    {pickedUnderdog ? 'Bonus' : 'fav'}
                                  </span>
                                )}

                                {/* Scored First */}
                                {pred.predicted_first_scorer && (
                                  <span style={{ 
                                    padding: '4px 8px', 
                                    borderRadius: '6px', 
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    color: '#ffffff',
                                    background: m.finished === 1 ? (isFirstScorerCorrect ? '#10b981' : '#ef4444') : 'rgba(255, 255, 255, 0.05)',
                                    border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                  }}>
                                    SF:{pred.predicted_first_scorer === 'home' ? homeName : pred.predicted_first_scorer === 'away' ? awayName : 'None'}
                                  </span>
                                )}

                                {/* Total Cards */}
                                {pred.predicted_total_cards !== null && pred.predicted_total_cards !== undefined && (
                                  <span style={{ 
                                    padding: '4px 8px', 
                                    borderRadius: '6px', 
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    color: '#ffffff',
                                    background: m.finished === 1 ? (isTotalCardsCorrect ? '#10b981' : '#ef4444') : 'rgba(255, 255, 255, 0.05)',
                                    border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                  }}>
                                    TC:{pred.predicted_total_cards}
                                  </span>
                                )}

                                {/* Highest scoring half */}
                                {pred.predicted_highest_scoring_half && (
                                  <span style={{ 
                                    padding: '4px 8px', 
                                    borderRadius: '6px', 
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    color: '#ffffff',
                                    background: m.finished === 1 ? (isHalfCorrect ? '#10b981' : '#ef4444') : 'rgba(255, 255, 255, 0.05)',
                                    border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                  }}>
                                    H:{pred.predicted_highest_scoring_half === 'first' ? '1st' : pred.predicted_highest_scoring_half === 'second' ? '2nd' : 'Equal'}
                                  </span>
                                )}

                                {/* Clean sheet */}
                                {pred.predicted_clean_sheet && (
                                  <span style={{ 
                                    padding: '4px 8px', 
                                    borderRadius: '6px', 
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    color: '#ffffff',
                                    background: m.finished === 1 ? (isCleanCorrect ? '#10b981' : '#ef4444') : 'rgba(255, 255, 255, 0.05)',
                                    border: m.finished === 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                                  }}>
                                    CS:{pred.predicted_clean_sheet === 'yes' ? 'Y' : 'N'}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', display: 'block' }}>
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
            );
          })
        )}
      </div>
    </div>
  );
}
