import { Award } from 'lucide-react';

export default function Leaderboard({ leaderboard, activeParticipantId }) {
  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px' }}>
          <Award size={20} color="#8b5cf6" />
          Leaderboard Standings
        </h2>
      </div>

      <div className="leaderboard-container show-all-cols" style={{ overflowX: 'auto' }}>
        {/* Table Header */}
        <div className="leaderboard-row header-row">
          <div className="hide-mobile">Rank</div>
          <div></div>
          <div className="stat-cell detailed-col soccer-header" title="Correct Exact Scores" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '22px' }}>
            ⚽
          </div>
          <div className="stat-cell detailed-col" title="Correct Winners">
            <span className="hide-mobile">Winners</span>
            <span className="show-mobile-only">Win</span>
          </div>
          <div className="stat-cell detailed-col" title="Correct Over/Unders">O/U</div>
          <div className="stat-cell detailed-col" title="Correct Scored First">SF</div>
          <div className="stat-cell detailed-col" title="Correct Cards">
            <span className="hide-mobile">Cards</span>
            <span className="show-mobile-only">TC</span>
          </div>
          <div className="stat-cell detailed-col" title="Correct Highest Half">
            <span className="hide-mobile">Half</span>
            <span className="show-mobile-only">HH</span>
          </div>
          <div className="stat-cell detailed-col" title="Correct Clean Sheet">CS</div>
          <div className="stat-cell" title="Bet Accuracy % (Excludes Underdog)" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            %
          </div>
          <div className="points-cell">
            <span className="hide-mobile">Points</span>
            <span className="show-mobile-only">PTS</span>
          </div>
        </div>

        {/* Rows */}
        {leaderboard.length === 0 ? (
          <div style={{ textAlignment: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
            No participants added yet. Go to Admin to add players!
          </div>
        ) : (
          leaderboard.map((p, index) => {
            const rank = index + 1;
            const isActive = p.id === activeParticipantId;
            const accuracy = p.total_bets_count > 0 
              ? Math.round((p.correct_bets_count / p.total_bets_count) * 100) 
              : 0;

            return (
              <div 
                key={p.id} 
                className="leaderboard-row"
                style={isActive ? { borderColor: 'var(--primary)', background: 'rgba(139, 92, 246, 0.04)' } : {}}
              >
                <div className="hide-mobile">
                  <div className={`rank-badge rank-${rank <= 3 ? rank : 'other'}`}>
                    {rank}
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span className="participant-name">{p.name}</span>
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_scores > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {p.correct_scores}
                  <span style={{ fontSize: '9px', opacity: 0.8, marginLeft: '2px' }}>({p.correct_scores * 4})</span>
                </div>
                
                <div className="stat-cell detailed-col" style={{ color: p.correct_winners > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {p.correct_winners}
                  <span style={{ fontSize: '9px', opacity: 0.8, marginLeft: '2px' }}>({p.correct_winners * 3})</span>
                </div>
                
                <div className="stat-cell detailed-col" style={{ color: p.correct_ou > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                  {p.correct_ou}
                  <span style={{ fontSize: '9px', opacity: 0.8, marginLeft: '2px' }}>({p.correct_ou * 1})</span>
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_first_scorer > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                  {p.correct_first_scorer}
                  <span style={{ fontSize: '9px', opacity: 0.8, marginLeft: '2px' }}>({p.correct_first_scorer * 2})</span>
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_total_cards > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {p.correct_total_cards}
                  <span style={{ fontSize: '9px', opacity: 0.8, marginLeft: '2px' }}>({p.correct_total_cards * 3})</span>
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_highest_scoring_half > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {p.correct_highest_scoring_half}
                  <span style={{ fontSize: '9px', opacity: 0.8, marginLeft: '2px' }}>({p.correct_highest_scoring_half * 2})</span>
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_clean_sheet > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                  {p.correct_clean_sheet}
                  <span style={{ fontSize: '9px', opacity: 0.8, marginLeft: '2px' }}>({p.correct_clean_sheet * 1})</span>
                </div>
                
                <div className="stat-cell" style={{ color: accuracy > 0 ? '#a855f7' : 'var(--text-muted)', fontWeight: '700' }}>
                  {accuracy}%
                </div>

                <div className="points-cell">
                  {p.total_points}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
