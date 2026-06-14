import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Wifi, WifiOff, Clock, Radio } from 'lucide-react';

// Map ESPN event type IDs / text to a category
function classifyEvent(type) {
  if (!type) return 'default';
  const text = (type.text || '').toLowerCase();
  const id = String(type.id || '');
  if (text.includes('goal') || id === '59' || id === '70') return 'goal';
  if (id === '63') return 'red';
  if (id === '60' || id === '62') return 'yellow';
  if (text.includes('substitut') || text.includes('sub') || id === '61') return 'sub';
  if (text.includes('half') || text.includes('kick off') || text.includes('full time') || text.includes('end') || text.includes('start') || id === '65' || id === '68' || id === '69') return 'milestone';
  if (text.includes('penalty') || id === '71') return 'penalty';
  if (text.includes('var') || text.includes('review')) return 'var';
  return 'default';
}

function eventIcon(category) {
  switch (category) {
    case 'goal':    return '⚽';
    case 'red':     return '🟥';
    case 'yellow':  return '🟨';
    case 'sub':     return '🔄';
    case 'penalty': return '🎯';
    case 'milestone': return '🕐';
    case 'var':     return '📺';
    default:        return '•';
  }
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds when live

export default function LiveFeed({ espnEventId, matchStatus, homeName, awayName }) {
  const [commentary, setCommentary] = useState([]);
  const [stats, setStats] = useState([]);
  const [subTab, setSubTab] = useState('commentary'); // 'commentary' | 'stats'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef(null);
  const isLive = matchStatus === 'live';
  const isScheduled = matchStatus === 'scheduled';

  const fetchFeed = useCallback(async (showRefreshing = false) => {
    if (!espnEventId) {
      setError('No ESPN event ID linked to this match.');
      setLoading(false);
      return;
    }

    if (showRefreshing) setRefreshing(true);

    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${espnEventId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
      const data = await res.json();

      // Pull commentary array — most detailed text play-by-play
      const rawCommentary = data.commentary || [];

      // Also pull key plays (goals, cards, subs) for enrichment
      const plays = (data.plays || []).filter(p => p.scoringPlay || p.type?.id === '60' || p.type?.id === '63' || p.type?.id === '61');

      let items = [];

      if (rawCommentary.length > 0) {
        items = rawCommentary.map((c, i) => ({
          id: `c-${i}`,
          minute: c.time?.displayValue || '',
          text: c.text || '',
          category: classifyEvent(c.type),
          period: c.period?.displayValue || '',
        }));
      } else if (plays.length > 0) {
        // Fallback to structured plays if no commentary text
        items = plays.map((p, i) => ({
          id: `p-${i}`,
          minute: p.clock?.displayValue || '',
          text: p.text || p.type?.text || '',
          category: classifyEvent(p.type),
          period: p.period?.displayValue || '',
        }));
      }

      // Reverse so latest commentary is at the top (newest first)
      items.reverse();

      // Pull stats if available
      if (data.boxscore && data.boxscore.teams) {
        const homeTeam = data.boxscore.teams.find(t => t.homeAway === 'home');
        const awayTeam = data.boxscore.teams.find(t => t.homeAway === 'away');
        if (homeTeam && awayTeam && homeTeam.statistics && awayTeam.statistics) {
           const desiredOrder = ['totalShots', 'shotsOnTarget', 'saves', 'wonCorners', 'possessionPct', 'foulsCommitted', 'yellowCards', 'redCards'];
          const combinedStats = desiredOrder.map(statName => {
            const s = homeTeam.statistics.find(st => st.name === statName);
            if (!s) return null;
            const opposingStat = awayTeam.statistics.find(os => os.name === statName) || {};
            return {
              name: s.name,
              label: s.label,
              homeVal: s.displayValue || '0',
              awayVal: opposingStat.displayValue || '0',
            };
          }).filter(Boolean);
          setStats(combinedStats);
        }
      }

      setCommentary(items);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [espnEventId]);

  // Initial fetch
  useEffect(() => {
    if (isScheduled) {
      setLoading(false);
      return;
    }
    fetchFeed(false);
  }, [fetchFeed, isScheduled]);

  // Poll every 30s when live
  useEffect(() => {
    if (!isLive) return;
    intervalRef.current = setInterval(() => {
      fetchFeed(false);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [isLive, fetchFeed]);

  // ---- Scheduled match ----
  if (isScheduled) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <Radio size={18} style={{ opacity: 0.4 }} />
        <span>Feed goes live when the match kicks off</span>
      </div>
    );
  }

  // ---- Loading ----
  if (loading) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <RefreshCw size={16} className="spin-icon" />
        <span>Loading feed…</span>
      </div>
    );
  }

  // ---- Error ----
  if (error) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <WifiOff size={16} style={{ color: 'var(--accent)', opacity: 0.7 }} />
        <span style={{ color: 'var(--accent)', opacity: 0.8 }}>{error}</span>
      </div>
    );
  }

  // ---- No events yet ----
  if (commentary.length === 0) {
    return (
      <div className="live-feed-panel live-feed-empty">
        <Clock size={16} style={{ opacity: 0.4 }} />
        <span>No commentary available yet</span>
        {isLive && <span style={{ fontSize: '11px', color: 'var(--success)', marginLeft: 4 }}>• polling…</span>}
      </div>
    );
  }

  const timeLabel = lastRefreshed
    ? lastRefreshed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
    : null;

  return (
    <div className="live-feed-panel">
      {/* Feed Header */}
      <div className="live-feed-header">
        <div className="live-feed-title">
          {isLive ? (
            <><span className="live-dot" />Live Commentary</>
          ) : (
            <><span style={{ fontSize: 14 }}>📋</span> Match Commentary</>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {timeLabel && (
            <span className="live-feed-timestamp">
              <Wifi size={11} /> {timeLabel}
            </span>
          )}
          <button
            className="live-feed-refresh-btn"
            onClick={() => fetchFeed(true)}
            disabled={refreshing}
            aria-label="Refresh feed"
            title="Refresh"
          >
            <RefreshCw size={12} className={refreshing ? 'spin-icon' : ''} />
          </button>
        </div>
      </div>

      {/* Sub-tabs if stats are available */}
      {stats.length > 0 && (
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', background: 'rgba(0,0,0,0.1)' }}>
          <button 
            type="button" 
            onClick={() => setSubTab('commentary')}
            style={{ 
              flex: 1, 
              padding: '10px', 
              fontSize: '12px', 
              fontWeight: '700', 
              color: subTab === 'commentary' ? 'var(--primary)' : 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              borderBottom: subTab === 'commentary' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Commentary
          </button>
          <button 
            type="button" 
            onClick={() => setSubTab('stats')}
            style={{ 
              flex: 1, 
              padding: '10px', 
              fontSize: '12px', 
              fontWeight: '700', 
              color: subTab === 'stats' ? 'var(--primary)' : 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              borderBottom: subTab === 'stats' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            Match Stats
          </button>
        </div>
      )}

      {/* Feed List */}
      <div className="live-feed-list" style={{ padding: subTab === 'stats' ? '16px' : '0' }}>
        {subTab === 'commentary' ? (
          commentary.map(item => {
            const cat = item.category;
            return (
              <div key={item.id} className={`feed-event feed-event-${cat}`}>
                <div className="feed-event-left">
                  <span className="feed-event-icon">{eventIcon(cat)}</span>
                  {item.minute && (
                    <span className="feed-event-time">{item.minute}</span>
                  )}
                </div>
                <span className="feed-event-text">{item.text}</span>
              </div>
            );
          })
        ) : (
          <>
            {/* Team Names Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '10px', marginBottom: '16px', fontWeight: '800', fontSize: '14px', letterSpacing: '0.03em' }}>
              <span style={{ color: 'var(--primary)' }}>{homeName}</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: '600', fontSize: '11px', alignSelf: 'center' }}>VS</span>
              <span style={{ color: 'var(--accent)', textAlign: 'right' }}>{awayName}</span>
            </div>
            {stats.map(s => {
              const hVal = parseFloat(s.homeVal) || 0;
              const aVal = parseFloat(s.awayVal) || 0;
              let total = hVal + aVal;
              if (total === 0) total = 1;
              const homePct = (hVal / total) * 100;
              const awayPct = (aVal / total) * 100;
              return (
                <div key={s.name} style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-primary)', fontWeight: '600', marginBottom: '6px' }}>
                    <span style={{ minWidth: '40px' }}>{s.homeVal}{s.name === 'possessionPct' ? '%' : ''}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>{s.label}</span>
                    <span style={{ minWidth: '40px', textAlign: 'right' }}>{s.awayVal}{s.name === 'possessionPct' ? '%' : ''}</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: 'rgba(255, 255, 255, 0.05)', display: 'flex', overflow: 'hidden' }}>
                    <div style={{ width: `${homePct}%`, background: 'var(--primary)', height: '100%' }}></div>
                    <div style={{ width: `${awayPct}%`, background: 'var(--accent)', height: '100%' }}></div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {isLive && (
        <div className="live-feed-footer">
          <span className="live-dot" style={{ width: 6, height: 6 }} /> Auto-refreshes every 30s
        </div>
      )}
    </div>
  );
}
