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
    const underdogBonus = pPreds.filter(pred => pred.points_cards_ou > 0).length;
    const correctScores = pPreds.filter(pred => pred.points_score > 0).length;
    const correctFirstScorers = pPreds.filter(pred => pred.points_first_scorer > 0).length;
    const correctExactCards = pPreds.filter(pred => pred.points_total_cards > 0).length;
    const correctHalf = pPreds.filter(pred => pred.points_highest_scoring_half > 0).length;
    const correctClean = pPreds.filter(pred => pred.points_clean_sheet > 0).length;

    // Accuracy percentages
    const winnerPct = totalFinishedPreds > 0 ? Math.round((correctWinners / totalFinishedPreds) * 100) : 0;
    const ouPct = totalFinishedPreds > 0 ? Math.round((correctOu / totalFinishedPreds) * 100) : 0;
    const scorePct = totalFinishedPreds > 0 ? Math.round((correctScores / totalFinishedPreds) * 100) : 0;
    const firstScorerPct = totalFinishedPreds > 0 ? Math.round((correctFirstScorers / totalFinishedPreds) * 100) : 0;
    const exactCardsPct = totalFinishedPreds > 0 ? Math.round((correctExactCards / totalFinishedPreds) * 100) : 0;
    const halfPct = totalFinishedPreds > 0 ? Math.round((correctHalf / totalFinishedPreds) * 100) : 0;
    const cleanPct = totalFinishedPreds > 0 ? Math.round((correctClean / totalFinishedPreds) * 100) : 0;

    return {
      id: p.id,
      name: p.name,
      totalFinishedPreds,
      correctWinners,
      correctOu,
      underdogBonus,
      correctScores,
      correctFirstScorers,
      correctExactCards,
      correctHalf,
      correctClean,
      winnerPct,
      ouPct,
      scorePct,
      firstScorerPct,
      exactCardsPct,
      halfPct,
      cleanPct,
      totalPoints: p.total_points
    };
  });

  // State for Chart Options
  const [chartType, setChartType] = React.useState('cumulative'); // 'cumulative' | 'daily'
  const [timeRange, setTimeRange] = React.useState('week'); // 'week' | 'all'
  const [hiddenPlayers, setHiddenPlayers] = React.useState(new Set());
  const [hoveredIndex, setHoveredIndex] = React.useState(null);

  // Colors for players
  const playerColors = [
    '#a855f7', // Purple
    '#3b82f6', // Blue
    '#22c55e', // Green
    '#fbbf24', // Gold
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#f97316', // Orange
    '#14b8a6', // Teal
  ];

  const getPlayerColor = (index) => playerColors[index % playerColors.length];

  // 3. Compile daily points for plotting
  const chartData = React.useMemo(() => {
    if (finishedMatches.length === 0 || leaderboard.length === 0) return null;

    // Group finished matches by date
    const matchesByDate = {};
    finishedMatches.forEach(m => {
      if (!m.local_date) return;
      const dateStr = m.local_date.split('T')[0];
      if (!matchesByDate[dateStr]) {
        matchesByDate[dateStr] = [];
      }
      matchesByDate[dateStr].push(m);
    });

    const dates = Object.keys(matchesByDate).sort();
    if (dates.length === 0) return null;

    const playerProgress = leaderboard.map((p, idx) => ({
      id: p.id,
      name: p.name,
      color: getPlayerColor(idx),
      daily: {},
      cumulative: {}
    }));

    dates.forEach(date => {
      const dayMatches = matchesByDate[date];
      const matchIds = new Set(dayMatches.map(m => m.id));

      playerProgress.forEach(pp => {
        const dayPreds = allPredictions.filter(
          pred => pred.participant_id === pp.id && matchIds.has(pred.match_id)
        );
        const dayPoints = dayPreds.reduce((sum, pred) => sum + (pred.total_points || 0), 0);
        pp.daily[date] = dayPoints;
      });
    });

    playerProgress.forEach(pp => {
      let runningSum = 0;
      dates.forEach(date => {
        runningSum += pp.daily[date];
        pp.cumulative[date] = runningSum;
      });
    });

    return { dates, playerProgress };
  }, [finishedMatches, leaderboard, allPredictions]);

  // 4. Find top performers in each category
  const hasFinishedPreds = stats.some(s => s.totalFinishedPreds > 0);
  
  let topWinner = null;
  let topOu = null;
  let topCards = null;
  let topScore = null;
  let topFirstScorer = null;
  let topExactCards = null;

  if (hasFinishedPreds) {
    topWinner = [...stats].sort((a, b) => b.winnerPct - a.winnerPct || b.correctWinners - a.correctWinners)[0];
    topOu = [...stats].sort((a, b) => b.ouPct - a.ouPct || b.correctOu - a.correctOu)[0];
    topCards = [...stats].sort((a, b) => b.underdogBonus - a.underdogBonus)[0];
    topScore = [...stats].sort((a, b) => b.scorePct - a.scorePct || b.correctScores - a.correctScores)[0];
    topFirstScorer = [...stats].sort((a, b) => b.firstScorerPct - a.firstScorerPct || b.correctFirstScorers - a.correctFirstScorers)[0];
    topExactCards = [...stats].sort((a, b) => b.exactCardsPct - a.exactCardsPct || b.correctExactCards - a.correctExactCards)[0];
  }

  // Toggle player line visibility
  const togglePlayer = (playerId) => {
    setHiddenPlayers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(playerId)) {
        newSet.delete(playerId);
      } else {
        newSet.add(playerId);
      }
      return newSet;
    });
  };

  // 5. SVG Line Chart Rendering Logic
  const chartHeight = 220;
  const chartWidth = 650;
  const paddingLeft = 40;
  const paddingRight = 40;
  const paddingTop = 30;
  const paddingBottom = 40;
  const svgWidth = chartWidth + paddingLeft + paddingRight;
  const svgHeight = chartHeight + paddingTop + paddingBottom;

  let chartContent = null;

  if (!chartData || chartData.dates.length === 0) {
    chartContent = (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        No matches completed yet to plot performance history.
      </div>
    );
  } else {
    const { dates: allDates, playerProgress } = chartData;
    const dates = timeRange === 'week' ? allDates.slice(-7) : allDates;
    
    // Determine the max Y value based on active player scores
    let maxY = 10;
    playerProgress.forEach(pp => {
      if (hiddenPlayers.has(pp.id)) return;
      dates.forEach(date => {
        const val = chartType === 'cumulative' ? pp.cumulative[date] : pp.daily[date];
        if (val > maxY) maxY = val;
      });
    });
    
    // Round maxY up to a nice number
    maxY = Math.ceil(maxY / 5) * 5;
    if (maxY === 0) maxY = 5;

    // Helper to get X position for a date index
    const getX = (index) => {
      if (dates.length <= 1) return paddingLeft + chartWidth / 2;
      return paddingLeft + (index / (dates.length - 1)) * chartWidth;
    };

    // Helper to get Y position for a value
    const getY = (value) => {
      return paddingTop + chartHeight - (value / maxY) * chartHeight;
    };

    // Date formatting helper for labels
    const formatLabelDate = (dateStr) => {
      try {
        const [, m, d] = dateStr.split('-');
        return `${m}/${d}`;
      } catch (e) {
        return dateStr;
      }
    };

    // Handle mouse move to find closest point index
    const handleMouseMove = (e) => {
      const svgRect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - svgRect.left;
      const chartMouseX = mouseX - paddingLeft;
      const pct = chartMouseX / chartWidth;
      const index = Math.max(0, Math.min(dates.length - 1, Math.round(pct * (dates.length - 1))));
      setHoveredIndex(index);
    };

    const handleMouseLeave = () => {
      setHoveredIndex(null);
    };

    // Draw grid lines
    const yTicks = [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY];
    const isTooltipOnLeft = hoveredIndex !== null && getX(hoveredIndex) > (svgWidth / 2);

    chartContent = (
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>Player Performance Timeline</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              Track players' points progression over match days
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Time Range Selector */}
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', padding: '4px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <button
                onClick={() => setTimeRange('week')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '600',
                  border: 'none',
                  background: timeRange === 'week' ? 'var(--primary-color, #a855f7)' : 'transparent',
                  color: timeRange === 'week' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Past Week
              </button>
              <button
                onClick={() => setTimeRange('all')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '600',
                  border: 'none',
                  background: timeRange === 'all' ? 'var(--primary-color, #a855f7)' : 'transparent',
                  color: timeRange === 'all' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                All
              </button>
            </div>

            {/* Chart Type Toggle */}
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', padding: '4px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <button
                onClick={() => setChartType('cumulative')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '600',
                  border: 'none',
                  background: chartType === 'cumulative' ? 'var(--primary-color, #a855f7)' : 'transparent',
                  color: chartType === 'cumulative' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Cumulative
              </button>
              <button
                onClick={() => setChartType('daily')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: '600',
                  border: 'none',
                  background: chartType === 'daily' ? 'var(--primary-color, #a855f7)' : 'transparent',
                  color: chartType === 'daily' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Daily
              </button>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--glass-border)' }}>
          {playerProgress.map((pp) => {
            const isHidden = hiddenPlayers.has(pp.id);
            return (
              <button
                key={pp.id}
                onClick={() => togglePlayer(pp.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: isHidden ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid',
                  borderColor: isHidden ? 'transparent' : 'var(--glass-border)',
                  padding: '6px 12px',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: isHidden ? 'var(--text-muted)' : 'var(--text-primary)',
                  fontWeight: isHidden ? '400' : '600',
                  textDecoration: isHidden ? 'line-through' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: isHidden ? '#6b7280' : pp.color }}></span>
                {pp.name}
              </button>
            );
          })}
        </div>

        {/* SVG Chart */}
        <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            width="100%"
            height="100%"
            style={{ display: 'block', overflow: 'visible' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {/* Grid Lines & Y Labels */}
            {yTicks.map((tick, i) => (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={getY(tick)}
                  x2={paddingLeft + chartWidth}
                  y2={getY(tick)}
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeDasharray="4 4"
                />
                <text
                  x={paddingLeft - 8}
                  y={getY(tick) + 4}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="11px"
                  fontWeight="500"
                >
                  {Math.round(tick)}
                </text>
              </g>
            ))}

            {/* X Labels */}
            {dates.map((date, i) => (
              <text
                key={i}
                x={getX(i)}
                y={paddingTop + chartHeight + 20}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize="11px"
                fontWeight="500"
              >
                {formatLabelDate(date)}
              </text>
            ))}

            {/* Hover Line */}
            {hoveredIndex !== null && (
              <line
                x1={getX(hoveredIndex)}
                y1={paddingTop}
                x2={getX(hoveredIndex)}
                y2={paddingTop + chartHeight}
                stroke="rgba(255, 255, 255, 0.2)"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
            )}

            {/* Player Lines and Points */}
            {playerProgress.map((pp) => {
              if (hiddenPlayers.has(pp.id)) return null;

              // Generate path definition
              const points = dates.map((date, i) => {
                const val = chartType === 'cumulative' ? pp.cumulative[date] : pp.daily[date];
                return { x: getX(i), y: getY(val), val };
              });

              const d = points.reduce((acc, p, i) => {
                return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
              }, '');

              return (
                <g key={pp.id}>
                  {/* The line */}
                  <path
                    d={d}
                    fill="none"
                    stroke={pp.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: 'all 0.3s ease' }}
                  />
                  {/* Point circles */}
                  {points.map((p, i) => {
                    const isHovered = hoveredIndex === i;
                    return (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={isHovered ? 6 : 4}
                        fill={pp.color}
                        stroke="#111"
                        strokeWidth="1.5"
                        style={{ transition: 'all 0.15s ease' }}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {/* Interactive Tooltip Card */}
          {hoveredIndex !== null && (
            <div
              style={{
                position: 'absolute',
                top: `${paddingTop + 10}px`,
                left: isTooltipOnLeft ? 'auto' : `${getX(hoveredIndex) + 20}px`,
                right: isTooltipOnLeft ? `${svgWidth - getX(hoveredIndex) + 20}px` : 'auto',
                background: 'rgba(17, 17, 17, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(8px)',
                borderRadius: '8px',
                padding: '10px 14px',
                pointerEvents: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                zIndex: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                minWidth: '150px'
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {dates[hoveredIndex]}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {playerProgress
                  .filter(pp => !hiddenPlayers.has(pp.id))
                  .map(pp => {
                    const val = chartType === 'cumulative' ? pp.cumulative[dates[hoveredIndex]] : pp.daily[dates[hoveredIndex]];
                    return {
                      id: pp.id,
                      name: pp.name,
                      color: pp.color,
                      val
                    };
                  })
                  .sort((a, b) => b.val - a.val) // sort descending by points
                  .map(item => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: item.color }}></span>
                        <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                      </div>
                      <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{item.val} pts</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    );
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
              <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Underdog Whisperer 🐉</h4>
              <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topCards?.name}</span>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                {topCards?.underdogBonus} underdog bonus point{topCards?.underdogBonus !== 1 ? 's' : ''} earned
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
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>🐉 Underdog Bonus</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Scored First Accuracy</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Highest Half Accuracy</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Clean Sheet Accuracy</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Exact Score Accuracy</th>
              <th style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Exact Cards Accuracy</th>
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

                {/* Underdog Bonus Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: '#fbbf24', fontWeight: '700' }}>🐉 {row.underdogBonus} bonus pt{row.underdogBonus !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Picked underdog &amp; won</div>
                  </div>
                </td>

                {/* First Scorer Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.firstScorerPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctFirstScorers}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.firstScorerPct}%`, height: '100%', background: 'linear-gradient(90deg, #ec4899, #f472b6)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                </td>

                {/* Highest Half Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.halfPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctHalf}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.halfPct}%`, height: '100%', background: 'linear-gradient(90deg, #c084fc, #e879f9)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                </td>

                {/* Clean Sheet Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.cleanPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctClean}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.cleanPct}%`, height: '100%', background: 'linear-gradient(90deg, #38bdf8, #7dd3fc)', borderRadius: '3px' }}></div>
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

                {/* Exact Cards Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{row.exactCardsPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.correctExactCards}/{row.totalFinishedPreds}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.exactCardsPct}%`, height: '100%', background: 'linear-gradient(90deg, #06b6d4, #67e8f9)', borderRadius: '3px' }}></div>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Interactive Performance Timeline */}
      {chartContent}
    </div>
  );
}
