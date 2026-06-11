import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import Leaderboard from './components/Leaderboard';
import MatchesList from './components/MatchesList';
import AdminPanel from './components/AdminPanel';
import { Calendar, Users, Award, Play } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'matches', 'admin'
  const [matches, setMatches] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [activeParticipantId, setActiveParticipantId] = useState(() => {
    const saved = localStorage.getItem('active_participant_id');
    return saved ? parseInt(saved) : null;
  });
  const [lastSync, setLastSync] = useState(null);
  
  const [loading, setLoading] = useState(true);

  // Load active player on change
  useEffect(() => {
    if (activeParticipantId) {
      localStorage.setItem('active_participant_id', activeParticipantId.toString());
      fetchPredictions(activeParticipantId);
    } else {
      localStorage.removeItem('active_participant_id');
      setPredictions([]);
    }
  }, [activeParticipantId]);

  // Initial load
  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      // 1. Trigger automatic background sync check
      await triggerBackgroundSync();
      // 2. Fetch data
      await refreshAllData();
      setLoading(false);
    };
    initialize();
  }, []);

  const triggerBackgroundSync = async () => {
    try {
      // Calls sync without force. The server checks if 6 hours have passed.
      const res = await fetch('/api/sync');
      const data = await res.json();
      if (data.success && data.sync_time) {
        setLastSync(data.sync_time);
      } else if (data.last_sync) {
        setLastSync(data.last_sync);
      }
    } catch (err) {
      console.error('Auto sync check failed:', err);
    }
  };

  const forceSync = async () => {
    try {
      const res = await fetch('/api/sync?force=true');
      const data = await res.json();
      if (data.success) {
        setLastSync(data.sync_time);
        await refreshAllData();
      }
    } catch (err) {
      console.error('Manual sync failed:', err);
      alert('Failed to sync. Check server logs.');
    }
  };

  const refreshAllData = async () => {
    try {
      const matchesRes = await fetch('/api/matches');
      const matchesData = await matchesRes.json();
      setMatches(matchesData);

      const leaderboardRes = await fetch('/api/leaderboard');
      const leaderboardData = await leaderboardRes.json();
      setLeaderboard(leaderboardData);

      // If active participant is set, reload predictions
      if (activeParticipantId) {
        await fetchPredictions(activeParticipantId);
      }
    } catch (err) {
      console.error('Failed to reload data:', err);
    }
  };

  const fetchPredictions = async (pId) => {
    try {
      const res = await fetch(`/api/predictions?participantId=${pId}`);
      const data = await res.json();
      setPredictions(data);
    } catch (err) {
      console.error('Failed to load predictions:', err);
    }
  };



  const getActiveParticipantObj = () => {
    return leaderboard.find(p => p.id === activeParticipantId) || null;
  };

  // Helper stats for dashboard
  const getLiveAndFinishedMatches = () => {
    return matches.filter(m => m.status === 'live' || m.finished === 1);
  };

  const formatMatchDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const dateStr = date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    return `${dateStr} ET`;
  };

  const getUpcomingMatches = () => {
    return matches.filter(m => m.status === 'scheduled').slice(0, 4);
  };

  return (
    <>
      <Header 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        lastSync={lastSync}
        onSyncTrigger={forceSync}
      />

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '80px 0' }}>
          <div className="btn-secondary animate-spin" style={{ width: '48px', height: '48px', borderRadius: '50%', border: '4px solid var(--glass-border)', borderTopColor: 'var(--primary)', background: 'transparent' }}></div>
          <span style={{ marginTop: '20px', color: 'var(--text-secondary)', fontWeight: '500' }}>Loading World Cup Data...</span>
        </div>
      ) : (
        <main style={{ flex: 1 }}>
          {activeTab === 'dashboard' && (
            <div className="dashboard-grid">
              
              {/* Left Column: Standings & Summary */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <Leaderboard 
                  leaderboard={leaderboard} 
                  activeParticipantId={activeParticipantId}
                  setActiveParticipantId={setActiveParticipantId}
                />

                {/* Tournament Overview Stats */}
                <div className="glass-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', textAlign: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Matches</h4>
                    <span style={{ fontSize: '32px', fontWeight: '800', fontFamily: 'var(--font-heading)' }}>104</span>
                  </div>
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Played / Live</h4>
                    <span style={{ fontSize: '32px', fontWeight: '800', fontFamily: 'var(--font-heading)', color: 'var(--success)' }}>
                      {getLiveAndFinishedMatches().length}
                    </span>
                  </div>
                  <div>
                    <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Participants</h4>
                    <span style={{ fontSize: '32px', fontWeight: '800', fontFamily: 'var(--font-heading)', color: 'var(--primary-hover)' }}>
                      {leaderboard.length}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: Upcoming Matches Feed */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={18} className="text-secondary" />
                    Upcoming Fixtures
                  </h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {getUpcomingMatches().length === 0 ? (
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No upcoming matches.</span>
                    ) : (
                      getUpcomingMatches().map(m => {
                        const home = m.home_team_name || m.home_team_label || 'TBD';
                        const away = m.away_team_name || m.away_team_label || 'TBD';
                        return (
                          <div key={m.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span style={{ fontWeight: '700', fontSize: '14px' }}>{home} vs {away}</span>
                              <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '600' }}>
                                {formatMatchDate(m.local_date)}
                              </span>
                            </div>
                            <button 
                              className="btn-primary" 
                              style={{ padding: '6px 12px', fontSize: '12px' }}
                              onClick={() => {
                                setActiveTab('matches');
                              }}
                            >
                              View
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}

          {activeTab === 'matches' && (
            <MatchesList 
              matches={matches} 
              predictions={predictions}
              activeParticipantId={activeParticipantId}
              onSave={refreshAllData}
            />
          )}

          {activeTab === 'admin' && (
            <AdminPanel 
              matches={matches} 
              leaderboard={leaderboard}
              onRefreshData={refreshAllData}
            />
          )}
        </main>
      )}
    </>
  );
}
