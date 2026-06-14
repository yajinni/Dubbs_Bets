import { useState } from 'react';
import { Trophy } from 'lucide-react';

export default function Header({ activeTab, setActiveTab, hasLiveMatches, navLayout = [] }) {
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

  // Only show tabs that are marked inHeader, in their custom order
  const headerTabs = navLayout.filter(item => item.inHeader);

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
        {headerTabs.map(item => (
          <button
            key={item.id}
            id={`nav-${item.id}`}
            className={`nav-btn ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
            style={item.id === 'live' ? {
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: '700'
            } : undefined}
          >
            {item.id === 'live' && hasLiveMatches && (
              <span className="live-dot" style={{ margin: 0 }} />
            )}
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
