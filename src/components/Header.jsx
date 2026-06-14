import { useState } from 'react';
import { Trophy } from 'lucide-react';

export default function Header({ activeTab, setActiveTab, hasLiveMatches }) {
  const [trophyClicks, setTrophyClicks] = useState(0);
  const [lastTrophyClickTime, setLastTrophyClickTime] = useState(0);

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

  return (
    <header className="app-header" style={{ paddingRight: '80px' }}>
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
        {hasLiveMatches && (
          <button 
            id="nav-live"
            className={`nav-btn ${activeTab === 'live' ? 'active' : ''}`}
            onClick={() => setActiveTab('live')}
            style={{ 
              color: 'var(--success)', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              fontWeight: '700' 
            }}
          >
            <span className="live-dot" style={{ margin: 0 }} /> Live
          </button>
        )}
        <button 
          id="nav-matches"
          className={`nav-btn ${activeTab === 'matches' ? 'active' : ''}`}
          onClick={() => setActiveTab('matches')}
        >
          Bets
        </button>
      </nav>
    </header>
  );
}
