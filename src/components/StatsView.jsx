import React from 'react';
import { Award, Target, TrendingUp, Shield, Zap, Trophy, CheckCircle, XCircle } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';

export default function StatsView({ statsData, fetchStats }) {
  // Lazy-load stats on mount if not already loaded
  React.useEffect(() => {
    if (!statsData && fetchStats) {
      fetchStats();
    }
  }, [statsData, fetchStats]);

  const stats = statsData?.stats || [];
  const allRow = statsData?.allRow || null;
  const chartDataRaw = statsData?.chartData || null;
  const topSingleGame = statsData?.topSingleGame || null;
  const topSingleDay = statsData?.topSingleDay || null;
  const superStats = statsData?.superStats || null;

  // State for Chart Options
  const [chartType, setChartType] = React.useState('cumulative');
  const [timeRange, setTimeRange] = React.useState('week');
  const [hiddenPlayers, setHiddenPlayers] = React.useState(new Set());
  const [hoveredIndex, setHoveredIndex] = React.useState(null);
  const [mobileStatTab, setMobileStatTab] = React.useState('score');
  const [statsPageTab, setStatsPageTab] = React.useState('stats');
  const [metricModal, setMetricModal] = React.useState(null);
  const [superStatsTab, setSuperStatsTab] = React.useState('match');

  const playerColors = [
    '#a855f7', '#3b82f6', '#22c55e', '#fbbf24',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6',
  ];
  const getPlayerColor = (index) => playerColors[index % playerColors.length];

  // Build chart data from pre-computed API response
  const chartData = React.useMemo(() => {
    if (!chartDataRaw || !chartDataRaw.dates || chartDataRaw.dates.length === 0) return null;
    const dates = chartDataRaw.dates;
    const daily = chartDataRaw.daily || {};
    const pIds = Object.keys(daily);
    const playerProgress = pIds.map((pid, idx) => {
      const stat = stats.find(s => s.participant_id === parseInt(pid));
      const cumulative = {};
      let runningSum = 0;
      dates.forEach(date => {
        runningSum += daily[pid]?.[date] || 0;
        cumulative[date] = runningSum;
      });
      return { id: parseInt(pid), name: stat?.name || `Player ${pid}`, color: getPlayerColor(idx), daily: daily[pid] || {}, cumulative };
    });
    return { dates, playerProgress };
  }, [chartDataRaw, stats]);

  // Top performers from pre-computed stats
  const hasFinishedPreds = stats.some(s => s.totalFinishedPreds > 0);
  let topWinner = null, topCards = null, topScore = null, topExactCards = null;
  if (hasFinishedPreds) {
    topWinner = [...stats].sort((a, b) => b.winnerPct - a.winnerPct || b.correctWinners - a.correctWinners)[0];
    topCards = [...stats].sort((a, b) => b.underdogPct - a.underdogPct || b.underdogCorrect - a.underdogCorrect)[0];
    topScore = [...stats].sort((a, b) => b.scorePct - a.scorePct || b.correctScores - a.correctScores)[0];
    topExactCards = [...stats].sort((a, b) => b.exactCardsPct - a.exactCardsPct || b.correctExactCards - a.correctExactCards)[0];
  }

  // Stats rows already have median/max from cache
  const statsWithMedians = stats;

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
  const chartHeight = 260;
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
      
      // Scale screen mouse coordinates to SVG viewBox coordinates
      const scaleX = svgWidth / svgRect.width;
      const logicalMouseX = mouseX * scaleX;
      
      const chartMouseX = logicalMouseX - paddingLeft;
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
            onClick={(e) => {
              const svgRect = e.currentTarget.getBoundingClientRect();
              const mouseX = e.clientX - svgRect.left;
              const scaleX = svgWidth / svgRect.width;
              const logicalMouseX = mouseX * scaleX;
              const chartMouseX = logicalMouseX - paddingLeft;
              const pct = chartMouseX / chartWidth;
              const index = Math.max(0, Math.min(dates.length - 1, Math.round(pct * (dates.length - 1))));
              setHoveredIndex(index);
            }}
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
                {Math.round(tick) !== 0 && (
                  <text
                    x={paddingLeft - 8}
                    y={getY(tick) + 4}
                    className="chart-axis-label"
                    textAnchor="end"
                    fill="var(--text-muted)"
                    fontWeight="500"
                  >
                    {Math.round(tick)}
                  </text>
                )}
              </g>
            ))}

            {/* Selected Date Box Highlight (only in week mode) */}
            {hoveredIndex !== null && timeRange === 'week' && (
              <rect
                x={getX(hoveredIndex) - 27}
                y={paddingTop + chartHeight + 4}
                width={54}
                height={24}
                rx={6}
                fill="rgba(34, 197, 94, 0.15)"
                stroke="#22c55e"
                strokeWidth="1.5"
                pointerEvents="none"
                className="selected-date-box"
              />
            )}

            {/* X Labels (week mode only) */}
            {timeRange === 'week' && dates.map((date, i) => (
              <text
                key={i}
                x={getX(i)}
                y={paddingTop + chartHeight + 20}
                className="chart-axis-label"
                textAnchor="middle"
                fill="var(--text-muted)"
                fontWeight="500"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setHoveredIndex(i);
                }}
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
              className="chart-tooltip-mobile"
              style={{
                position: 'absolute',
                top: `${paddingTop - 5}px`,
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
                      <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>
                        {item.val} {chartType === 'cumulative' ? 'total' : ''} pts
                      </span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>

        {/* Clickable Date Grid (All mode) */}
        {timeRange === 'all' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {dates.map((date, i) => {
                const isHovered = hoveredIndex === i;
                return (
                  <button
                    key={i}
                    onClick={() => setHoveredIndex(isHovered ? null : i)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '11px',
                      fontWeight: isHovered ? '700' : '500',
                      border: '1px solid',
                      borderColor: isHovered ? '#22c55e' : 'var(--glass-border)',
                      background: isHovered ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      color: isHovered ? '#22c55e' : 'var(--text-muted)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      minWidth: '60px',
                      textAlign: 'center'
                    }}
                  >
                    {formatLabelDate(date)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', opacity: 0.8, marginTop: '8px' }}>
          {timeRange === 'all' ? 'Click a date to see the points for that day' : 'Click on the dates to see values for that day'}
        </div>
      </div>
    );
  }

  return (
    <div className="stats-view-container" style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '20px 0' }}>
      
      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: '8px', padding: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid var(--glass-border)', width: 'fit-content', margin: '0 auto' }}>
        <button
          onClick={() => setStatsPageTab('stats')}
          style={{
            padding: '8px 20px', fontSize: '14px', fontWeight: '600',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            background: statsPageTab === 'stats' ? 'var(--primary-color, #a855f7)' : 'transparent',
            color: statsPageTab === 'stats' ? '#fff' : 'var(--text-secondary)',
            transition: 'all 0.2s'
          }}
        >Stats</button>
        <button
          onClick={() => setStatsPageTab('awards')}
          style={{
            padding: '8px 20px', fontSize: '14px', fontWeight: '600',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            background: statsPageTab === 'awards' ? 'var(--primary-color, #a855f7)' : 'transparent',
            color: statsPageTab === 'awards' ? '#fff' : 'var(--text-secondary)',
            transition: 'all 0.2s'
          }}
        >Awards</button>
      </div>

      {/* Stats Tab */}
      {statsPageTab === 'stats' && (<>

      {/* Median Points Table */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0, borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
          Median Points | Most Points
        </h3>
        <table className="match-view-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Player</th>
              <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Per Match</th>
              <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Per Day</th>
            </tr>
          </thead>
          <tbody>
            {[...statsWithMedians, allRow].filter(Boolean).map((row) => {
              const isAll = row.name === 'ALL';
              return (
              <tr key={isAll ? 'all' : row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: isAll ? 'rgba(168,85,247,0.08)' : 'transparent' }}>
                <td style={{ padding: '8px', fontWeight: '700', color: isAll ? '#a855f7' : 'var(--text-primary)' }}>{isAll ? '👥 ALL' : row.name}</td>
                <td style={{ padding: '8px', fontSize: '14px', color: 'var(--text-primary)', fontWeight: '600' }}>{row.medianPerMatch} | {row.maxPerMatch}</td>
                <td style={{ padding: '8px', fontSize: '14px', color: 'var(--text-primary)', fontWeight: '600' }}>{row.medianPerDay} | {row.maxPerDay}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {/* Super Stats Table */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>
            Super Stats
          </h3>
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', padding: '4px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <button onClick={() => setSuperStatsTab('match')} style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '600', border: 'none', background: superStatsTab === 'match' ? 'var(--primary-color, #a855f7)' : 'transparent', color: superStatsTab === 'match' ? '#fff' : 'var(--text-secondary)', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}>Per Match</button>
            <button onClick={() => setSuperStatsTab('day')} style={{ padding: '6px 12px', fontSize: '12px', fontWeight: '600', border: 'none', background: superStatsTab === 'day' ? 'var(--primary-color, #a855f7)' : 'transparent', color: superStatsTab === 'day' ? '#fff' : 'var(--text-secondary)', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}>Per Day</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
        {(() => {
          const rows = superStats?.rows || [];
          const dataKey = superStatsTab === 'match' ? 'perGame' : 'perDay';
          const maxFloor = Math.max(...rows.map(r => r[dataKey].floor), 0);
          const maxSharpe = Math.max(...rows.map(r => r[dataKey].sharpe), 0);
          const skewColor = (v) => v > 1 ? '#ef4444' : v < 0.2 ? '#22c55e' : 'var(--text-primary)';
          const cmpColor = (v, max) => max > 0 && v === max ? '#22c55e' : 'var(--text-primary)';
          return (<>
          <style>{`
            .super-stats-header th { cursor: pointer; border-bottom: 1px dashed var(--text-muted); transition: background 0.15s; }
            .super-stats-header th:hover { background: rgba(168,85,247,0.12); }
          `}</style>
          <table className="match-view-table super-stats-header" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
                <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600', borderBottom: 'none', cursor: 'default' }}>Player</th>
                <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }} onClick={() => setMetricModal({ metric: 'CV', player: null })}>CV ⓘ</th>
                <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }} onClick={() => setMetricModal({ metric: 'Skew', player: null })}>Skew ⓘ</th>
                <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }} onClick={() => setMetricModal({ metric: 'Floor', player: null })}>Floor ⓘ</th>
                <th style={{ padding: '6px 5px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }} onClick={() => setMetricModal({ metric: 'SR', player: null })}>SR ⓘ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ss) => {
                const row = stats.find(s => s.participant_id === ss.participant_id);
                const name = row?.name || `Player ${ss.participant_id}`;
                const d = ss[dataKey];
                return (
                <tr key={ss.participant_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '8px', fontWeight: '700', color: 'var(--text-primary)' }}>{name}</td>
                  <td style={{ padding: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: d.cv === 0 ? 'var(--text-muted)' : d.cv > 1 ? '#ef4444' : d.cv < 0.5 ? '#22c55e' : 'var(--text-primary)' }} onClick={() => setMetricModal({ metric: 'CV', player: name })}>{d.cv}</td>
                  <td style={{ padding: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: d.skew === 0 ? 'var(--text-muted)' : skewColor(d.skew) }} onClick={() => setMetricModal({ metric: 'Skew', player: name })}>{d.skew}</td>
                  <td style={{ padding: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: d.floor === 0 ? 'var(--text-muted)' : cmpColor(d.floor, maxFloor) }} onClick={() => setMetricModal({ metric: 'Floor', player: name })}>{d.floor}</td>
                  <td style={{ padding: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', color: d.sharpe === 0 ? 'var(--text-muted)' : cmpColor(d.sharpe, maxSharpe) }} onClick={() => setMetricModal({ metric: 'SR', player: name })}>{d.sharpe}</td>
                </tr>
              );})}
            </tbody>
          </table></>
          );
        })()}
        </div>
      </div>

      {/* Metric Explanation Modal */}
      {metricModal && (() => {
        const title = {
          CV: 'Coefficient of Variation (CV)',
          Skew: 'Skew',
          Floor: 'Floor (25th Percentile)',
          SR: 'Sharpe Ratio (SR)',
        }[metricModal.metric];

        const explanation = {
          CV: <>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>What It Stands For:</strong><br />
              Coefficient of Variation
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>How It's Calculated:</strong><br />
              CV = Standard Deviation ÷ Mean
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>What It Tells You:</strong><br />
              A low CV (under 0.5) means they are a rock-solid, predictable picker. A high CV (over 1.0) means they are an absolute loose cannon—completely unpredictable from game to game.
            </div>
          </>,
          Skew: <>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>What It Proves:</strong><br />
              It mathematically proves if someone is relying on "lottery ticket" wins.
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>High Positive Skew (&gt; 1.0):</strong><br />
              Their graph has a long tail to the right. This is your friend who gets a bunch of 0s and 1s, but nailed one exact score line that gave them 40 points.
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Near 0 Skew:</strong><br />
              Their performance is perfectly balanced around their average. No flukes.
            </div>
          </>,
          Floor: <>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>What It Tells You:</strong><br />
              This tells you the minimum point threshold a player reaches in 75% of their games.
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>High Floor:</strong><br />
              If Player A has a 25th percentile of 3 points, it means that even when they are wrong, they are smart enough to hedge their bets and salvage points. They have a "high floor."
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Low Floor:</strong><br />
              If Player B's 25th percentile is 0, they completely strike out a quarter of the time.
            </div>
          </>,
          SR: <>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>What It Is:</strong><br />
              This is the ultimate "pound-for-pound" ranking. It rewards players who score high points and keep their volatility low.
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>How It's Calculated:</strong><br />
              Sharpe Ratio = Mean ÷ Standard Deviation
            </div>
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>What It Tells You:</strong><br />
              The player with the highest Sharpe Ratio is the undisputed king of the league. They get the maximum amount of points with the minimum amount of variance.
            </div>
          </>,
        }[metricModal.metric];

        return (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '20px'
        }} onClick={() => setMetricModal(null)}>
          <div className="glass-panel" style={{
            maxWidth: '500px', width: '100%', padding: '24px',
            border: '1px solid var(--glass-border)',
            background: '#1a1a2e',
            backdropFilter: 'none',
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 12px 0' }}>
              {title}
            </h3>
            <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {explanation}
              {metricModal.player && (
                <div style={{ padding: '8px 12px', background: 'rgba(168,85,247,0.1)', borderRadius: '8px', fontSize: '13px', color: '#c084fc' }}>
                  {metricModal.player}'s {metricModal.metric} shown above
                </div>
              )}
            </div>
            <button
              onClick={() => setMetricModal(null)}
              style={{
                marginTop: '16px', padding: '8px 20px', background: 'var(--primary-color, #a855f7)',
                color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontWeight: '600', fontSize: '14px', width: '100%'
              }}
            >Close</button>
          </div>
        </div>
        );
      })()}

      {/* Main Stats Table */}
      <div className="glass-panel desktop-only" style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowX: 'auto' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '700', margin: 0, borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px' }}>
          Player Accuracy Leaderboard
        </h3>
        
        <table className="match-view-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Player</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>⚽</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>O/U</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>TC</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Win</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>Dog</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>SF</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>HH</th>
              <th style={{ padding: '12px 10px', fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600' }}>CS</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => (
              <tr key={row.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {row.name}
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

                {/* Underdog Bonus Stat */}
                <td style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: '#fbbf24', fontWeight: '700' }}>{row.underdogPct}%</span>
                      <span style={{ color: 'var(--text-muted)' }}>{row.underdogCorrect}/{row.underdogAttempts}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${row.underdogPct}%`, height: '100%', background: 'linear-gradient(90deg, #fbbf24, #f59e0b)', borderRadius: '3px' }}></div>
                    </div>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Stats Tabs */}
      <div className="mobile-stats-tabs">
        <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 10px 0' }}>
          Player Accuracy Leaderboard
        </h3>
        <div className="mobile-tab-bar">
          {[
            { key: 'score', label: '⚽' },
            { key: 'ou', label: 'O/U' },
            { key: 'cards', label: 'TC' },
            { key: 'win', label: 'Win' },
            { key: 'dog', label: 'Dog' },
            { key: 'sf', label: 'SF' },
            { key: 'half', label: 'HH' },
            { key: 'cs', label: 'CS' },
          ].map(tab => (
            <button
              key={tab.key}
              className={`mobile-tab ${mobileStatTab === tab.key ? 'active' : ''}`}
              onClick={() => setMobileStatTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mobile-tab-content">
          {(() => {
            const tabConfig = {
              win:   { pct: r => r.winnerPct, val: r => `${r.winnerPct}%`, num: r => r.correctWinners, denom: r => r.totalFinishedPreds, label: 'Win', color: 'linear-gradient(90deg, #a855f7, #c084fc)' },
              ou:    { pct: r => r.ouPct, val: r => `${r.ouPct}%`, num: r => r.correctOu, denom: r => r.totalFinishedPreds, label: 'O/U', color: 'linear-gradient(90deg, #22c55e, #4ade80)' },
              dog:   { pct: r => r.underdogPct, val: r => `${r.underdogPct}%`, num: r => r.underdogCorrect, denom: r => r.underdogAttempts, label: 'Dog', color: 'linear-gradient(90deg, #fbbf24, #f59e0b)' },
              sf:    { pct: r => r.firstScorerPct, val: r => `${r.firstScorerPct}%`, num: r => r.correctFirstScorers, denom: r => r.totalFinishedPreds, label: 'SF', color: 'linear-gradient(90deg, #ec4899, #f472b6)' },
              half:  { pct: r => r.halfPct, val: r => `${r.halfPct}%`, num: r => r.correctHalf, denom: r => r.totalFinishedPreds, label: 'HH', color: 'linear-gradient(90deg, #c084fc, #e879f9)' },
              cs:    { pct: r => r.cleanPct, val: r => `${r.cleanPct}%`, num: r => r.correctClean, denom: r => r.totalFinishedPreds, label: 'CS', color: 'linear-gradient(90deg, #38bdf8, #7dd3fc)' },
              score: { pct: r => r.scorePct, val: r => `${r.scorePct}%`, num: r => r.correctScores, denom: r => r.totalFinishedPreds, label: '⚽', color: 'linear-gradient(90deg, #eab308, #fde047)' },
              cards: { pct: r => r.exactCardsPct, val: r => `${r.exactCardsPct}%`, num: r => r.correctExactCards, denom: r => r.totalFinishedPreds, label: 'TC', color: 'linear-gradient(90deg, #06b6d4, #67e8f9)' },
            };
            const cfg = tabConfig[mobileStatTab];
            if (!cfg) return null;
            const sorted = [...stats].sort((a, b) => cfg.pct(b) - cfg.pct(a));
            return sorted.map((row, i) => (
              <div key={row.id} className="mobile-stat-row">
                <span className="mobile-stat-rank">{i + 1}</span>
                <span className="mobile-stat-name">{row.name}</span>
                <span className="mobile-stat-val">{cfg.val(row)}</span>
                <span className="mobile-stat-frac">{cfg.num(row)}/{cfg.denom(row)}</span>
                <div className="mobile-stat-bar-wrap">
                  <div className="mobile-stat-bar-fill" style={{ width: `${cfg.pct(row)}%`, background: cfg.color }}></div>
                </div>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Interactive Performance Timeline */}
      {chartContent}

      </>)}

      {/* Awards Tab */}
      {statsPageTab === 'awards' && (<>

      {hasFinishedPreds && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
          
            <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #a855f7' }}>
              <div style={{ background: 'rgba(168, 85, 247, 0.15)', padding: '12px', borderRadius: '12px' }}>
                <Award size={24} color="#a855f7" />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Winner Predictor King 👑</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topWinner?.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {topWinner?.winnerPct}% Accuracy ({topWinner?.correctWinners}/{topWinner?.totalFinishedPreds})
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #22c55e' }}>
              <div style={{ background: 'rgba(34, 197, 94, 0.15)', padding: '12px', borderRadius: '12px' }}>
                <Shield size={24} color="#22c55e" />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>CARD SHARK 🦈</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topExactCards?.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {topExactCards?.exactCardsPct}% Accuracy ({topExactCards?.correctExactCards}/{topExactCards?.totalFinishedPreds})
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #3b82f6' }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.15)', padding: '12px', borderRadius: '12px' }}>
                <TrendingUp size={24} color="#3b82f6" />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Underdog Whisperer 🐉</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topCards?.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {topCards?.underdogPct}% Accuracy ({topCards?.underdogCorrect}/{topCards?.underdogAttempts})
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #eab308' }}>
              <div style={{ background: 'rgba(234, 179, 8, 0.15)', padding: '12px', borderRadius: '12px' }}>
                <Target size={24} color="#eab308" />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Exact Score Sniper 🎯</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topScore?.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {topScore?.scorePct}% Accuracy ({topScore?.correctScores}/{topScore?.totalFinishedPreds})
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #f97316' }}>
              <div style={{ background: 'rgba(249, 115, 22, 0.15)', padding: '12px', borderRadius: '12px' }}>
                <Zap size={24} color="#f97316" />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Cheat Code 🎮</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topSingleGame?.participant_name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {topSingleGame?.total_points} pts {topSingleGame ? `(${shortenTeamName(topSingleGame.home_team_name)} ${topSingleGame.home_score}-${topSingleGame.away_score} ${shortenTeamName(topSingleGame.away_team_name)})` : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '4px solid #fbbf24' }}>
              <div style={{ background: 'rgba(251, 191, 36, 0.15)', padding: '12px', borderRadius: '12px' }}>
                <Trophy size={24} color="#fbbf24" />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>Lotto Winner 🍀</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)' }}>{topSingleDay?.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {topSingleDay?.points} pts {topSingleDay?.date ? `(${new Date(topSingleDay.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })})` : ''}
                  </span>
                </div>
              </div>
            </div>

        </div>
      )}

      </>)}
    </div>
  );
}
