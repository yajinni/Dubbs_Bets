import React from 'react';
import { Users } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';

export default function PlayerPicksList({ 
  m, 
  allPredictions, 
  leaderboard, 
  activeParticipantId, 
  runningPointsMap = {}, 
  winnerLocalState = {} 
}) {
  const homeName = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
  const awayName = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');
  const homeCode = m.home_code || 'H';
  const awayCode = m.away_code || 'A';

  const handleScroll = (e, matchId) => {
    const scrollLeft = e.target.scrollLeft;
    const elements = document.querySelectorAll(`.bets-scroll-${matchId}`);
    elements.forEach(el => {
      if (el !== e.target && el.scrollLeft !== scrollLeft) {
        el.scrollLeft = scrollLeft;
      }
    });
  };

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

  const homeIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.home_win_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
  const awayIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.away_win_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
  const drawIsUnderdog = m.home_win_pct != null && m.away_win_pct != null && m.draw_pct != null && m.draw_pct < Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);

  return (
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
            const isWinnerCorrect = m.finished === 1 && hasWinnerPred && displayPred.predicted_winner === actualWinner;

            const hasOUPred = displayPred && displayPred.predicted_over_under;
            const isOUCorrect = m.finished === 1 && hasOUPred && displayPred.predicted_over_under === actualOU;

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
                      display: 'flex', 
                      gap: '3px',
                      minWidth: 'max-content',
                      padding: '2px 0'
                    }}>
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
                        background: m.finished === 1 ? (isWinnerCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)',
                        border: m.finished === 1 ? (isWinnerCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)'
                      }}>
                        {displayPred.predicted_winner === 'home' ? homeCode : displayPred.predicted_winner === 'away' ? awayCode : displayPred.predicted_winner === 'draw' ? 'Draw' : '-'}
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
                        background: displayPred.predicted_over_under ? (m.finished === 1 ? (isOUCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: displayPred.predicted_over_under ? (m.finished === 1 ? (isOUCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {displayPred.predicted_over_under === 'over' ? 'O' : displayPred.predicted_over_under === 'under' ? 'U' : '-'}
                      </span>

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
                        background: hasScorePred ? (m.finished === 1 ? (isScoreCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasScorePred ? (m.finished === 1 ? (isScoreCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {hasScorePred ? `${displayPred.predicted_home_score}-${displayPred.predicted_away_score}` : '-'}
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
                        background: displayPred.predicted_winner ? (m.finished === 1 ? (underdogBonusEarned ? 'rgba(16, 185, 129, 0.25)' : (pickedUnderdog ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.05)')) : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: displayPred.predicted_winner ? (m.finished === 1 ? (underdogBonusEarned ? '1px solid rgba(16, 185, 129, 0.4)' : (pickedUnderdog ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)')) : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
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
                        background: hasFirstScorerPred ? (m.finished === 1 ? (isFirstScorerCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasFirstScorerPred ? (m.finished === 1 ? (isFirstScorerCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {hasFirstScorerPred ? `SF:${displayPred.predicted_first_scorer === 'home' ? homeCode : displayPred.predicted_first_scorer === 'away' ? awayCode : 'None'}` : '-'}
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
                        background: hasTotalCardsPred ? (m.finished === 1 ? (isTotalCardsCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasTotalCardsPred ? (m.finished === 1 ? (isTotalCardsCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
                      }}>
                        {displayPred.predicted_total_cards !== null && displayPred.predicted_total_cards !== undefined ? `TC:${displayPred.predicted_total_cards}` : '-'}
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
                        background: hasHalfPred ? (m.finished === 1 ? (isHalfCorrect ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)') : 'rgba(255, 255, 255, 0.05)') : 'transparent',
                        border: hasHalfPred ? (m.finished === 1 ? (isHalfCorrect ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)') : '1px solid rgba(255, 255, 255, 0.1)') : '1px dashed rgba(255, 255, 255, 0.05)'
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
  );
}
