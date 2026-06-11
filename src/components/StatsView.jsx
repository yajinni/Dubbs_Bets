import React from 'react';
import { Award, Target, TrendingUp, CheckCircle, XCircle } from 'lucide-react';

export default function StatsView({ matches = [], allPredictions = [], leaderboard = [] }) {
  // 1. Identify finished matches
  const finishedMatches = matches.filter(m => m.finished === 1);
  const finishedMatchIds = new Set(finishedMatches.map(m => m.id));

  // 2. Compute stats per participant
  const stats = leaderboard.map(p => {
    // Predictions made by this participant for finished matches
    const pPreds = allPredictions.filter(pred => pred.participant_id === p.id && finishedMatchIds.has(pred.match_id));
    
    const totalFinishedPreds = pPreds.length;
    
    // Count correct answers
    const correctWinners = pPreds.filter(pred => pred.points_winner > 0).length;
    const correctOu = pPreds.filter(pred => pred.points_ou > 0).length;
    const correctCards = pPreds.filter(pred => pred.points_cards_ou > 0).length;
    const correctScores = pPreds.filter(pred => pred.points_score > 0).length;

    // Accuracy percentages
    const winnerPct = totalFinishedPreds > 0 ? Math.round((correctWinners / totalFinishedPreds) * 100) : 0;
    const ouPct = totalFinishedPreds > 0 ? Math.round((correctOu / totalFinishedPreds) * 100) : 0;
    const cardsPct = totalFinishedPreds > 0 ? Math.round((correctCards / totalFinishedPreds) * 100) : 0;
    const scorePct = totalFinishedPreds > 0 ? Math.round((correctScores / totalFinishedPreds) * 100) : 0;

    return {
      id: p.id,
      name: p.name,
      totalFinishedPreds,
      correctWinners,
      correctOu,
      correctCards,
      correctScores,
      winnerPct,
      ouPct,
      cardsPct,
      scorePct,
      totalPoints: p.total_points
    };
  });

  // 3. Find top performers in each category (only if there are finished predictions)
  const hasFinishedPreds = stats.some(s => s.totalFinishedPreds > 0);
  
  let topWinner = null;
  let topOu = null;
  let topCards = null;
  let topScore = null;

  if (hasFinishedPreds) {
    // Sort and get max
    topWinner = [...stats].sort((a, b) => b.winnerPct - a.winnerPct || b.correctWinners - a.correctWinners)[0];
    topOu = [...stats].sort((a, b) => b.ouPct - a.ouPct || b.correctOu - a.correctOu)[0];
    topCards = [...stats].sort((a, b) => b.cardsPct - a.cardsPct || b.correctCards - a.correctCards)[0];
    topScore = [...stats].sort((a, b) => b.scorePct - a.scorePct || b.correctScores - a.correctScores)[0];
  }

  return (
    <div className="stats-view-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '20px 0' }}>
      
      {/* Overview Cards / Achievements */}
      {hasFinishedPreds && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          
          <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #a855f7' }}>
            <div style={{ background: 'rgba(168, 85, 247, 0.15)', padding: '12px', borderRadius: '12px' }}>
              <Award size={24} color="#a855f7" />
            </div>
            <div>
              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Winner Predictor King 👑</h4>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topWinner?.name}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                {topWinner?.winnerPct}% Accuracy ({topWinner?.correctWinners}/{topWinner?.totalFinishedPreds})
              </p>
            </div>
          </div>

          <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #22c55e' }}>
            <div style={{ background: 'rgba(34, 197, 94, 0.15)', padding: '12px', borderRadius: '12px' }}>
              <TrendingUp size={24} color="#22c55e" />
            </div>
            <div>
              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Over/Under Wizard 🔮</h4>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topOu?.name}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                {topOu?.ouPct}% Accuracy ({topOu?.correctOu}/{topOu?.totalFinishedPreds})
              </p>
            </div>
          </div>

          <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #3b82f6' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.15)', padding: '12px', borderRadius: '12px' }}>
              <TrendingUp size={24} color="#3b82f6" />
            </div>
            <div>
              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Card Prop Wizard 🎴</h4>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topCards?.name}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                {topCards?.cardsPct}% Accuracy ({topCards?.correctCards}/{topCards?.totalFinishedPreds})
              </p>
            </div>
          </div>

          <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #eab308' }}>
            <div style={{ background: 'rgba(234, 179, 8, 0.15)', padding: '12px', borderRadius: '12px' }}>
              <Target size={24} color="#eab308" />
            </div>
            <div>
              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Exact Score Sniper 🎯</h4>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topScore?.name}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                {topScore?.scorePct}% Accuracy ({topScore?.correctScores}/{topScore?.totalFinishedPreds})
              </p>
            </div>
          </div>

        </div>
      )}

      {/* Main Stats Table */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowX: 'auto' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0, borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
          Player Accuracy Leaderboard
        </h3>
        
        <table className="match-view-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Player</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600', textAlign: 'center' }}>Completed Bets</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Winner Accuracy</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Over / Under Goals</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Cards O/U Accuracy</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Exact Score Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {row.name}
                </td>
                <td style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {row.totalFinishedPreds}
                </td>
                
                {/* Winner Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.winnerPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctWinners}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.winnerPct}%`, height: '100%', background: 'linear-gradient(90deg, #a855f7, #c084fc)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                </td>

                {/* Over Under Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.ouPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctOu}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.ouPct}%`, height: '100%', background: 'linear-gradient(90deg, #22c55e, #4ade80)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                </td>

                {/* Cards Over Under Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.cardsPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctCards}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.cardsPct}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                </td>

                {/* Exact Score Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.scorePct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctScores}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.scorePct}%`, height: '100%', background: 'linear-gradient(90deg, #eab308, #fde047)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
