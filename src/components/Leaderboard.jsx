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

      <div className="leaderboard-container">
        {/* Table Header */}
        <div className="leaderboard-row header-row">
          <div>Rank</div>
          <div>Participant</div>
          <div className="stat-cell" title="Correct Exact Scores">Scores</div>
          <div className="stat-cell" title="Correct Winners">Winners</div>
          <div className="stat-cell" title="Correct Over/Unders">O/U</div>
          <div className="points-cell">Points</div>
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

            return (
              <div 
                key={p.id} 
                className="leaderboard-row"
                style={isActive ? { borderColor: 'var(--primary)', background: 'rgba(139, 92, 246, 0.04)' } : {}}
              >
                <div>
                  <div className={`rank-badge rank-${rank <= 3 ? rank : 'other'}`}>
                    {rank}
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span className="participant-name">{p.name}</span>
                  {isActive && (
                    <span 
                      style={{ 
                        fontSize: '10px', 
                        background: 'var(--primary)', 
                        color: 'white', 
                        padding: '1px 6px', 
                        borderRadius: '10px', 
                        fontWeight: '700',
                        textTransform: 'uppercase',
                        flexShrink: 0
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>

                <div className="stat-cell" style={{ color: p.correct_scores > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {p.correct_scores}
                </div>
                
                <div className="stat-cell" style={{ color: p.correct_winners > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {p.correct_winners}
                </div>
                
                <div className="stat-cell" style={{ color: p.correct_ou > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                  {p.correct_ou}
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
