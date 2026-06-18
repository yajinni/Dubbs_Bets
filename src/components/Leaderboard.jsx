import { Award, BarChart3, Trophy } from 'lucide-react';
import { useState } from 'react';

const pointValues = {
  scores: 4,
  winner: 3,
  ou: 1,
  first_scorer: 2,
  total_cards: 3,
  highest_scoring_half: 2,
  clean_sheet: 1,
  underdog: 1,
};

export default function Leaderboard({ leaderboard, activeParticipantId }) {
  const [viewMode, setViewMode] = useState('count');

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px' }}>
          <Award size={20} color="#8b5cf6" />
          Leaderboard Standings
        </h2>
        <div className="toggle-group" style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
          <button
            className={`toggle-btn ${viewMode === 'count' ? 'active' : ''}`}
            onClick={() => setViewMode('count')}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: '700',
              border: 'none',
              cursor: 'pointer',
              background: viewMode === 'count' ? 'var(--primary)' : 'transparent',
              color: viewMode === 'count' ? '#fff' : 'var(--text-secondary)',
              fontFamily: 'var(--font-heading)',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
            }}
          >
            <BarChart3 size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
            Count
          </button>
          <button
            className={`toggle-btn ${viewMode === 'points' ? 'active' : ''}`}
            onClick={() => setViewMode('points')}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontWeight: '700',
              border: 'none',
              borderLeft: '1px solid var(--glass-border)',
              cursor: 'pointer',
              background: viewMode === 'points' ? 'var(--primary)' : 'transparent',
              color: viewMode === 'points' ? '#fff' : 'var(--text-secondary)',
              fontFamily: 'var(--font-heading)',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
            }}
          >
            <Trophy size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
            Points
          </button>
        </div>
      </div>

      <div className="leaderboard-container show-all-cols">
        {/* Table Header */}
        <div className="leaderboard-row header-row">
          <div className="hide-mobile">Rank</div>
          <div></div>
          <div className="stat-cell detailed-col" title="Correct Exact Scores">S</div>
          <div className="stat-cell detailed-col" title="Correct Winners">
            <span className="hide-mobile">Winners</span>
            <span className="show-mobile-only">Win</span>
          </div>
          <div className="stat-cell detailed-col" title="Correct Underdog Bonus">B</div>
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

            const isCount = viewMode === 'count';

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

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                  <span className="participant-name">{p.name} ({p.total_points})</span>
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_scores > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_scores : p.points_score}
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_winners > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_winners : p.points_winner}
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_underdog > 0 ? '#fbbf24' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_underdog : p.points_underdog}
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_ou > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_ou : p.points_ou}
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_first_scorer > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_first_scorer : p.points_first_scorer}
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_total_cards > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_total_cards : p.points_total_cards}
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_highest_scoring_half > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_highest_scoring_half : p.points_highest_scoring_half}
                </div>

                <div className="stat-cell detailed-col" style={{ color: p.correct_clean_sheet > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                  {isCount ? p.correct_clean_sheet : p.points_clean_sheet}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}