import React, { useState } from 'react';
import { Trophy, RefreshCw, CheckCircle, Clock } from 'lucide-react';

export default function Header({ activeTab, setActiveTab, lastSync, onSyncTrigger, leaderboard = [], activeParticipantId, setActiveParticipantId }) {
  const [syncing, setSyncing] = useState(false);
  const [trophyClicks, setTrophyClicks] = useState(0);
  const [lastTrophyClickTime, setLastTrophyClickTime] = useState(0);

  const handleSync = async () => {
    setSyncing(true);
    await onSyncTrigger();
    setSyncing(false);
  };

  const handleTrophyClick = () => {
    const now = Date.now();
    if (now - lastTrophyClickTime < 1000) {
      const nextCount = trophyClicks + 1;
      if (nextCount >= 3) {
        setActiveTab('admin');
        setTrophyClicks(0);
      } else {
        setTrophyClicks(nextCount);
      }
    } else {
      setTrophyClicks(1);
    }
    setLastTrophyClickTime(now);
  };

  const formatLastSync = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString();
  };

  return (
    <header className="app-header">
      <div className="logo-container" style={{ userSelect: 'none' }}>
        <Trophy 
          className="logo-icon" 
          size={32} 
          color="#fbbf24" 
          style={{ filter: 'drop-shadow(0 0 8px rgba(251, 191, 36, 0.4))', cursor: 'pointer' }}
          onClick={handleTrophyClick}
        />
        <h1 className="logo-text">Dubbs Bets</h1>
      </div>

      <nav className="nav-links">
        <button 
          id="nav-dashboard"
          className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </button>
        <button 
          id="nav-matches"
          className={`nav-btn ${activeTab === 'matches' ? 'active' : ''}`}
          onClick={() => setActiveTab('matches')}
        >
          Bets
        </button>
        <button 
          id="nav-match-view"
          className={`nav-btn ${activeTab === 'match-view' ? 'active' : ''}`}
          onClick={() => setActiveTab('match-view')}
        >
          Results
        </button>
        <button 
          id="nav-stats"
          className={`nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          Stats
        </button>
      </nav>

      <div className="header-actions">
        {leaderboard.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#ff4a4a', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pick Your Name:</span>
            <select
              id="active-player-select"
              className="admin-select"
              style={{ width: 'auto', padding: '6px 12px', fontSize: '13px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }}
              value={activeParticipantId || ''}
              onChange={(e) => setActiveParticipantId(parseInt(e.target.value) || null)}
            >
              <option value="" style={{ background: '#120b2e', color: 'var(--text-muted)' }}>-- Choose Name --</option>
              {leaderboard.map((p) => (
                <option key={p.id} value={p.id} style={{ background: '#120b2e', color: 'var(--text-primary)' }}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
            id="header-sync-btn"
            className="btn-secondary" 
            style={{ padding: '8px 12px', fontSize: '13px' }} 
            disabled={syncing}
            onClick={handleSync}
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>

          <div className="locked-icon-container" style={{ background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <Clock size={14} className="text-muted" />
            <span style={{ fontSize: '12px' }}>
              Sync: <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{formatLastSync(lastSync)}</span>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
