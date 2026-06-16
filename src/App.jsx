import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Header from './components/Header';
import Leaderboard from './components/Leaderboard';
import MatchesList, { MatchCard } from './components/MatchesList';
import AdminPanel from './components/AdminPanel';
import MatchView from './components/MatchView';
import StatsView from './components/StatsView';
import LogsView from './components/LogsView';
import InfoView from './components/InfoView';
import NavCustomizerModal from './components/NavCustomizerModal';
import { Calendar, Award, ChevronLeft, ChevronRight, CheckCircle, XCircle, ArrowUp, Menu, X, Info, BarChart2, List, RefreshCw, Clock } from 'lucide-react';
import { shortenTeamName } from './utils/teamNames';

// ─── Nav Layout Helpers ───────────────────────────────────────────────────────
const DEFAULT_NAV_LAYOUT = [
  { id: 'dashboard',  label: 'Dashboard', inHeader: true  },
  { id: 'matches',    label: 'Bets',       inHeader: true  },
  { id: 'live',       label: 'Live',        inHeader: true  },
  { id: 'match-view', label: 'Results',    inHeader: false },
  { id: 'stats',      label: 'Stats',       inHeader: false },
  { id: 'logs',       label: 'Logs',        inHeader: false },
  { id: 'info',       label: 'Info',        inHeader: false },
];

function getNavLayoutKey(playerName) {
  return `nav_layout_${playerName || 'default'}`;
}

function loadNavLayout(playerName) {
  try {
    const saved = localStorage.getItem(getNavLayoutKey(playerName));
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge: add any new tabs not in saved layout (future-proofing)
      const existingIds = new Set(parsed.map(i => i.id));
      const merged = [
        ...parsed,
        ...DEFAULT_NAV_LAYOUT.filter(d => !existingIds.has(d.id)),
      ];
      return merged;
    }
  } catch (_) { /* ignore */ }
  return [...DEFAULT_NAV_LAYOUT];
}

function saveNavLayout(playerName, layout) {
  try {
    localStorage.setItem(getNavLayoutKey(playerName), JSON.stringify(layout));
  } catch (_) { /* ignore */ }
}

export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.slice(1).split(':')[0];
    return hash || 'dashboard';
  });
  const [matches, setMatches] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [activeParticipantId, setActiveParticipantId] = useState(() => {
    const saved = localStorage.getItem('active_participant_id');
    return saved ? parseInt(saved) : null;
  });
  const [lastSync, setLastSync] = useState(null);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(() => {
    const startDate = new Date('2026-06-11T00:00:00Z');
    const today = new Date();
    const diffTime = today - startDate;
    if (diffTime < 0) return 1;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const week = Math.floor(diffDays / 7) + 1;
    return Math.min(6, Math.max(1, week));
  });
  const [allPredictions, setAllPredictions] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const hashRestoredRef = useRef(false);

  // ── Nav Customizer ────────────────────────────────────────────────────────
  const [navCustomizerOpen, setNavCustomizerOpen] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0–100
  const holdTimerRef = useRef(null);
  const holdAnimRef = useRef(null);
  const holdStartRef = useRef(null);
  const HOLD_DURATION = 3000; // ms

  // Load navLayout keyed by active player name
  const activePlayerName = useMemo(() => {
    if (!activeParticipantId) return null;
    const p = leaderboard.find(p => p.id === activeParticipantId);
    return p ? p.name : null;
  }, [activeParticipantId, leaderboard]);

  const [navLayout, setNavLayout] = useState(() => loadNavLayout(null));
  const [navLayoutSyncing, setNavLayoutSyncing] = useState(false);

  // Load layout from server when player changes; fall back to localStorage instantly
  useEffect(() => {
    // Instant load from localStorage (feels snappy)
    setNavLayout(loadNavLayout(activePlayerName));

    if (!activeParticipantId) return;

    // Then fetch from server and override if available
    (async () => {
      try {
        const res = await fetch(`/api/preferences?participantId=${activeParticipantId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.nav_layout) {
          const parsed = JSON.parse(data.nav_layout);
          // Merge with defaults to cover any new tabs added since they last saved
          const existingIds = new Set(parsed.map(i => i.id));
          const merged = [
            ...parsed,
            ...DEFAULT_NAV_LAYOUT.filter(d => !existingIds.has(d.id)),
          ];
          setNavLayout(merged);
          // Also update localStorage cache
          saveNavLayout(activePlayerName, merged);
        }
      } catch (_) { /* server unreachable — localStorage fallback stays */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeParticipantId, activePlayerName]);

  const handleSaveNavLayout = useCallback(async (newLayout) => {
    // Optimistic UI update + localStorage cache
    setNavLayout(newLayout);
    saveNavLayout(activePlayerName, newLayout);

    // Persist to server if a player is selected
    if (activeParticipantId) {
      setNavLayoutSyncing(true);
      try {
        await fetch('/api/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantId: activeParticipantId, navLayout: newLayout }),
        });
      } catch (_) { /* server unreachable — localStorage fallback is enough */ }
      setNavLayoutSyncing(false);
    }
  }, [activeParticipantId, activePlayerName]);

  // Long-press handlers for the hamburger button
  const startHold = useCallback((e) => {
    e.preventDefault();
    holdStartRef.current = Date.now();
    setHoldProgress(0);

    const animate = () => {
      const elapsed = Date.now() - holdStartRef.current;
      const progress = Math.min(100, (elapsed / HOLD_DURATION) * 100);
      setHoldProgress(progress);
      if (progress < 100) {
        holdAnimRef.current = requestAnimationFrame(animate);
      } else {
        // Trigger customizer
        setNavCustomizerOpen(true);
        setHoldProgress(0);
      }
    };
    holdAnimRef.current = requestAnimationFrame(animate);
  }, []);

  const cancelHold = useCallback(() => {
    if (holdAnimRef.current) cancelAnimationFrame(holdAnimRef.current);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    setHoldProgress(0);
  }, []);

  const hasLiveMatches = matches.some(m => {
    if (m.finished === 1 || m.status === 'finished') return false;
    const kickOffMs = new Date((m.local_date || '').replace(' ', 'T')).getTime();
    // eslint-disable-next-line react-hooks/purity
    return kickOffMs + 60000 <= Date.now();
  });

  const runningPointsMap = useMemo(() => {
    const map = {};
    const sorted = [...matches].sort((a, b) => {
      const dateA = new Date((a.local_date || '').replace(' ', 'T'));
      const dateB = new Date((b.local_date || '').replace(' ', 'T'));
      if (dateA - dateB !== 0) return dateA - dateB;
      return a.id - b.id;
    });

    leaderboard.forEach(p => {
      let runningSum = 0;
      sorted.forEach(m => {
        if (m.finished === 1) {
          const pred = allPredictions.find(ap => ap.match_id === m.id && ap.participant_id === p.id);
          if (pred) {
            runningSum += pred.total_points || 0;
          }
        }
        map[`${p.id}_${m.id}`] = runningSum;
      });
    });
    return map;
  }, [matches, leaderboard, allPredictions]);

  const liveTabMatches = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
      const thirtyMinsMs = 30 * 60 * 1000;

    const isMatchLive = (m) => {
      if (m.status === 'live') return true;
      if (m.finished === 1 || m.status === 'finished') return false;
      const kickOffMs = new Date((m.local_date || '').replace(' ', 'T')).getTime();
      return kickOffMs <= nowMs;
    };

    const isMatchStartingSoon = (m) => {
      if (m.finished === 1 || m.status === 'finished' || m.status === 'live') return false;
      const kickOffMs = new Date((m.local_date || '').replace(' ', 'T')).getTime();
      const diff = kickOffMs - nowMs;
      return diff > 0 && diff <= thirtyMinsMs;
    };

    // 1. Swap to next live match 30 min before it starts
    const upcomingClose = matches.filter(isMatchStartingSoon);
    if (upcomingClose.length > 0) {
      return upcomingClose.sort((a, b) => new Date((a.local_date || '').replace(' ', 'T')) - new Date((b.local_date || '').replace(' ', 'T')));
    }

    // 2. Otherwise show currently live matches (including started but not finished)
    const currentLive = matches.filter(isMatchLive);
    if (currentLive.length > 0) {
      return currentLive;
    }

    // 3. Otherwise leave the previous live/finished game showing
    const finishedMatches = matches.filter(m => m.finished === 1 || m.status === 'finished');
    if (finishedMatches.length > 0) {
      const sortedFinished = [...finishedMatches].sort((a, b) => {
        return new Date((b.local_date || '').replace(' ', 'T')) - new Date((a.local_date || '').replace(' ', 'T'));
      });
      return [sortedFinished[0]];
    }

    return [];
  }, [matches]);

  const liveTabCode = useMemo(() => {
    if (liveTabMatches.length === 0) return 'Live';
    const m = liveTabMatches[0];
    const home = m.home_code || (m.home_team_name || '').substring(0, 3).toUpperCase();
    const away = m.away_code || (m.away_team_name || '').substring(0, 3).toUpperCase();
    return `${home}|${away}`;
  }, [liveTabMatches]);

  const fetchPredictions = async (pId) => {
    try {
      const res = await fetch(`/api/predictions?participantId=${pId}`);
      const data = await res.json();
      setPredictions(data);
    } catch (err) {
      console.error('Failed to load predictions:', err);
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

      const allPredsRes = await fetch('/api/predictions');
      const allPredsData = await allPredsRes.json();
      setAllPredictions(allPredsData);

      // If active participant is set, reload predictions
      if (activeParticipantId) {
        await fetchPredictions(activeParticipantId);
      }
    } catch (err) {
      console.error('Failed to reload data:', err);
    }
  };

  const triggerBackgroundSync = async () => {
    try {
      // Calls sync without force. The server checks if 6 hours have passed.
      const res = await fetch('/api/sync?checkOnly=true');
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

  // Scroll to top listener
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) {
        setShowScrollTop(true);
      } else {
        setShowScrollTop(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  const handleWatchStream = async (matchId) => {
    try {
      const res = await fetch(`/api/stream?matchId=${matchId}`);
      const data = await res.json();
      if (data.streamUrl) {
        window.open(data.streamUrl, '_blank', 'noopener,noreferrer');
      } else {
        window.open('https://istreameast.app/v52', '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('Failed to resolve stream link:', err);
      window.open('https://istreameast.app/v52', '_blank', 'noopener,noreferrer');
    }
  };

  // Load active player on change
  useEffect(() => {
    if (activeParticipantId) {
      localStorage.setItem('active_participant_id', activeParticipantId.toString());
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // Fetch last sync timestamp
      await triggerBackgroundSync();
      // Fetch data
      await refreshAllData();
      setLoading(false);
    };
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore scroll/match state from URL hash after data loads
  useEffect(() => {
    if (loading || hashRestoredRef.current) return;
    hashRestoredRef.current = true;

    const hash = window.location.hash.slice(1).split(':')[0];
    if (!hash || hash === 'dashboard') return;

    // Run match-selection logic for tabs that need it
    if (hash === 'matches' && activeParticipantId) {
      const unpredictedMatches = matches.filter(m =>
        m.status === 'scheduled' && m.finished === 0 && !predictions.some(p => p.match_id === m.id)
      );
      if (unpredictedMatches.length > 0) {
        unpredictedMatches.sort((a, b) => new Date(a.local_date) - new Date(b.local_date));
        setSelectedMatchId(unpredictedMatches[0].id);
      } else {
        const userPredictedMatches = matches.filter(m => predictions.some(p => p.match_id === m.id));
        if (userPredictedMatches.length > 0) {
          userPredictedMatches.sort((a, b) => new Date(b.local_date) - new Date(a.local_date));
          setSelectedMatchId(userPredictedMatches[0].id);
        }
      }
    } else if (hash === 'match-view') {
      const completedMatches = matches.filter(m => m.finished === 1);
      if (completedMatches.length > 0) {
        completedMatches.sort((a, b) => new Date(b.local_date) - new Date(a.local_date));
        setSelectedMatchId(completedMatches[0].id);
      }
    }
  }, [loading, matches, predictions, activeParticipantId]);

  // Listen for browser back/forward hash changes
  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.slice(1).split(':')[0];
      if (hash) setActiveTab(hash);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Ref to always have the latest refreshAllData for use in effects
  const refreshAllDataRef = useRef(refreshAllData);
  refreshAllDataRef.current = refreshAllData;

  // Live sync: pull scores from ESPN every 60 seconds if there are live matches
  useEffect(() => {
    if (!hasLiveMatches) return;

    const performSync = async () => {
      try {
        const syncRes = await fetch('/api/sync?skipOdds=true');
        const syncData = await syncRes.json();
        if (syncRes.ok && syncData.success && syncData.sync_time) {
          setLastSync(syncData.sync_time);
        }
      } catch (err) {
        console.error('Interval sync failed:', err);
      }
      refreshAllDataRef.current();
    };

    performSync();
    const intervalId = setInterval(performSync, 30000);
    return () => clearInterval(intervalId);
  }, [hasLiveMatches]);

  // SSE: real-time update events from server
  useEffect(() => {
    const evtSource = new EventSource('/api/events');

    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type !== 'done' && data.type !== 'heartbeat') {
          refreshAllDataRef.current();
        }
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    evtSource.onerror = () => {};

    return () => {
      evtSource.close();
    };
  }, []);

  const forceSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync?force=true');
      const data = await res.json();
      if (res.ok && data.success) {
        setLastSync(data.sync_time);
        await refreshAllData();
        if (data.results && data.results.oddsError) {
          alert(`Score sync succeeded, but Odds API failed: ${data.results.oddsError}`);
        }
      } else {
        alert(`Sync failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Manual sync failed:', err);
      alert('Failed to sync. Check server logs.');
    } finally {
      setSyncing(false);
    }
  };

  // Helper stats for dashboard
  const getLiveAndFinishedMatches = () => {
    return matches.filter(m => m.status === 'live' || m.finished === 1);
  };

  const formatMatchDate = (isoString) => {
    if (!isoString) return '';
    let normalized = isoString.replace(' ', 'T');
    const hasTimezone = normalized.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(normalized);
    
    let date;
    if (hasTimezone) {
      date = new Date(normalized);
    } else {
      date = new Date(normalized + '-04:00');
    }
    
    const dateStr = date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${dateStr} ET`;
  };

  const getWeekNumber = (dateString) => {
    if (!dateString) return 1;
    const startDate = new Date('2026-06-11T00:00:00Z');
    const d = new Date(dateString);
    const diffTime = d - startDate;
    if (diffTime < 0) return 1;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
  };

  const formatLastSync = (isoString) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    // eslint-disable-next-line react-hooks/purity
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleDateString();
  };

  const getMatchesForWeek = (weekNum) => {
    return matches.filter(m => getWeekNumber(m.local_date) === weekNum && m.finished !== 1);
  };

  const handleTabChange = (tab) => {
    if (tab === 'matches') {
      if (activeParticipantId) {
        // Find upcoming matches that have no predictions by the user yet
        const unpredictedMatches = matches.filter(m => 
          m.status === 'scheduled' && 
          m.finished === 0 && 
          !predictions.some(p => p.match_id === m.id)
        );

        if (unpredictedMatches.length > 0) {
          // Sort by local_date ascending (earliest first)
          unpredictedMatches.sort((a, b) => new Date(a.local_date) - new Date(b.local_date));
          setSelectedMatchId(unpredictedMatches[0].id);
        } else {
          // Fallback: latest predicted match
          const userPredictedMatches = matches.filter(m => predictions.some(p => p.match_id === m.id));
          if (userPredictedMatches.length > 0) {
            userPredictedMatches.sort((a, b) => new Date(b.local_date) - new Date(a.local_date));
            setSelectedMatchId(userPredictedMatches[0].id);
          }
        }
      }
    } else if (tab === 'match-view') {
      const completedMatches = matches.filter(m => m.finished === 1);
      if (completedMatches.length > 0) {
        completedMatches.sort((a, b) => new Date(b.local_date) - new Date(a.local_date));
        setSelectedMatchId(completedMatches[0].id);
      }
    }
    setActiveTab(tab);
    window.location.hash = tab;
  };

  return (
    <>
      <Header 
        activeTab={activeTab} 
        setActiveTab={handleTabChange} 
        hasLiveMatches={hasLiveMatches}
        navLayout={navLayout}
        liveTabCode={liveTabCode}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '10px' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                      <Calendar size={18} className="text-secondary" />
                      Week {selectedWeek} Fixtures
                    </h3>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <button 
                        onClick={() => setSelectedWeek(prev => Math.max(1, prev - 1))}
                        disabled={selectedWeek === 1}
                        className="choice-btn"
                        style={{ padding: '4px 8px', width: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <ChevronLeft size={16} strokeWidth={3} />
                      </button>
                      <button 
                        onClick={() => setSelectedWeek(prev => Math.min(6, prev + 1))}
                        disabled={selectedWeek === 6}
                        className="choice-btn"
                        style={{ padding: '4px 8px', width: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <ChevronRight size={16} strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
                    {getMatchesForWeek(selectedWeek).length === 0 ? (
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No matches this week.</span>
                    ) : (
                      getMatchesForWeek(selectedWeek).map(m => {
                        const home = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
                        const away = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');
                        return (
                          <div key={m.id} className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span style={{ fontWeight: '700', fontSize: '14px' }}>{home} vs {away}</span>
                              <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '600' }}>
                                {formatMatchDate(m.local_date)}
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              {activeParticipantId && (
                                predictions.some(p => p.match_id === m.id) ? (
                                  <CheckCircle size={16} color="#10b981" style={{ filter: 'drop-shadow(0 0 4px rgba(16, 185, 129, 0.2))' }} title="Prediction saved" />
                                ) : (
                                  <XCircle size={16} color="#ef4444" style={{ filter: 'drop-shadow(0 0 4px rgba(239, 68, 68, 0.2))' }} title="No prediction placed" />
                                )
                              )}
                              <button 
                                className="btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '12px' }}
                                onClick={() => {
                                  setSelectedMatchId(m.id);
                                  setActiveTab('matches');
                                }}
                              >
                                View
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}

          {activeTab === 'live' && (
            <div className="matches-list" style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px', marginBottom: '0px' }}>
                {hasLiveMatches && <span className="live-dot" />}
                <h2 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>Live Matches</h2>
              </div>
              {liveTabMatches.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No live or recent matches.
                </div>
              ) : (
                liveTabMatches.map(m => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {m.finished !== 1 && (
                      <button
                        onClick={() => handleWatchStream(m.id)}
                        className="btn-secondary"
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: '8px', 
                          padding: '10px', 
                          borderRadius: '8px', 
                          fontSize: '16px', 
                          fontWeight: '700', 
                          background: 'rgba(255,255,255,0.03)', 
                          border: '1px solid var(--glass-border)',
                          color: 'var(--text-primary)',
                          marginBottom: '4px',
                          width: '100%',
                          cursor: 'pointer'
                        }}
                      >
                        📺 Watch Live Stream
                      </button>
                    )}
                    <MatchCard
                      m={m}
                      pred={predictions.find(p => p.match_id === m.id)}
                      activeParticipantId={activeParticipantId}
                      onSave={refreshAllData}
                      allPredictions={allPredictions}
                      leaderboard={leaderboard}
                      runningPointsMap={runningPointsMap}
                      selectedMatchId={null}
                      showLiveResults={m.status === 'live'}
                      onRefresh={refreshAllData}
                    />
                  </div>
                ))
              )}
            </div>
          )}

           {activeTab === 'matches' && (
             <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                <MatchesList 
                  matches={matches} 
                  predictions={predictions}
                  activeParticipantId={activeParticipantId}
                  onSave={refreshAllData}
                  selectedMatchId={selectedMatchId}
                  onSelectMatch={setSelectedMatchId}
                  allPredictions={allPredictions}
                  leaderboard={leaderboard}
                  onRefresh={refreshAllData}
                />
             </div>
           )}

           {activeTab === 'match-view' && (
             <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
                <MatchView 
                  matches={matches}
                  allPredictions={allPredictions}
                  leaderboard={leaderboard}
                  activeParticipantId={activeParticipantId}
                  selectedMatchId={selectedMatchId}
                  onClearSelectedMatch={() => setSelectedMatchId(null)}
                  onRefresh={refreshAllData}
                />
             </div>
           )}

           {activeTab === 'stats' && (
             <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
               <StatsView 
                 matches={matches}
                 allPredictions={allPredictions}
                 leaderboard={leaderboard}
               />
             </div>
           )}

           {activeTab === 'logs' && (
             <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
               <LogsView />
             </div>
           )}

           {activeTab === 'admin' && (
             <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
               <AdminPanel 
                 matches={matches} 
                 leaderboard={leaderboard}
                 onRefreshData={refreshAllData}
               />
             </div>
           )}

           {activeTab === 'info' && (
             <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
               <InfoView />
             </div>
           )}
        </main>
      )}

      {/* Floating Hamburger Menu Button — click = sidebar, hold 3s = customizer */}
      <button
        className="hamburger-btn"
        title="Open Sidebar (hold 3s to customize nav)"
        onClick={() => {
          if (holdProgress < 5) setSidebarOpen(true);
        }}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 999 }}
      >
        {/* SVG progress ring — only visible while holding */}
        {holdProgress > 0 && (
          <svg
            width="52" height="52"
            style={{ position: 'absolute', top: '-4px', left: '-4px', pointerEvents: 'none' }}
          >
            <circle
              cx="26" cy="26" r="23"
              fill="none"
              stroke="rgba(139,92,246,0.2)"
              strokeWidth="3"
            />
            <circle
              cx="26" cy="26" r="23"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 23}`}
              strokeDashoffset={`${2 * Math.PI * 23 * (1 - holdProgress / 100)}`}
              transform="rotate(-90 26 26)"
              style={{ transition: 'stroke-dashoffset 0.05s linear', filter: 'drop-shadow(0 0 4px rgba(139,92,246,0.8))' }}
            />
          </svg>
        )}
        <Menu size={20} />
      </button>

      {/* Sidebar Navigation & Control Panel */}
      <div 
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />
      <div className={`sidebar-container ${sidebarOpen ? 'open' : ''}`}>
        <button 
          className="sidebar-close-btn" 
          onClick={() => setSidebarOpen(false)}
          title="Close Sidebar"
        >
          <X size={24} />
        </button>

        {/* Player Name Selector */}
        {leaderboard.length > 0 && (
          <div className="sidebar-section">
            <label htmlFor="sidebar-player-select" className="sidebar-label">Name</label>
            <select
              id="sidebar-player-select"
              className="admin-select"
              style={{ width: '100%', padding: '10px 14px', fontSize: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', textAlignLast: 'right', textAlign: 'right' }}
              value={activeParticipantId || ''}
              onChange={(e) => {
                setActiveParticipantId(parseInt(e.target.value) || null);
                setSidebarOpen(false);
              }}
            >
              <option value="" style={{ background: '#120b2e', color: 'var(--text-muted)' }}>-- Choose Name --</option>
              {leaderboard.map((p) => (
                <option key={p.id} value={p.id} style={{ background: '#120b2e', color: 'var(--text-primary)' }}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Sidebar Nav Links — driven by navLayout (sidebar items only) */}
        <div className="sidebar-section">
          <label className="sidebar-label">Navigation</label>
          {navLayout
            .filter(item => !item.inHeader)
            .map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  className={`sidebar-nav-btn ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    handleTabChange(item.id);
                    setSidebarOpen(false);
                  }}
                  style={item.id === 'live' ? { color: '#ffffff' } : undefined}
                >
                  {item.id === 'live' && hasLiveMatches && (
                    <span className="live-dot" style={{ width: '8px', height: '8px', margin: 0 }} />
                  )}
                  {item.id === 'match-view' && <Award size={18} />}
                  {item.id === 'stats'      && <BarChart2 size={18} />}
                  {item.id === 'logs'       && <List size={18} />}
                  {item.id === 'info'       && <Info size={18} />}
                  {item.label}
                </button>
              );
            })
          }
          {/* Hint to open customizer */}
          <button
            onClick={() => { setSidebarOpen(false); setNavCustomizerOpen(true); }}
            style={{
              marginTop: '4px',
              background: 'transparent',
              border: '1px dashed rgba(139,92,246,0.25)',
              borderRadius: '8px',
              color: 'rgba(139,92,246,0.6)',
              fontSize: '11px',
              fontWeight: '700',
              padding: '7px 14px',
              cursor: 'pointer',
              textAlign: 'right',
              letterSpacing: '0.03em',
              transition: 'all 0.2s',
            }}
          >
            ✦ Customize Nav
          </button>
        </div>

        {/* Sync Controls */}
        <div className="sidebar-section" style={{ marginTop: 'auto' }}>
          <label className="sidebar-label">Data Sync</label>
          <button 
            id="sidebar-sync-btn"
            className="sidebar-nav-btn" 
            disabled={syncing}
            onClick={forceSync}
            style={{ justifyContent: 'center' }}
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', marginTop: '4px', opacity: 0.8 }}>
            <Clock size={12} className="text-muted" />
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Last synced: <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{formatLastSync(lastSync)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Nav Customizer Modal */}
      {navCustomizerOpen && (
        <NavCustomizerModal
          navLayout={navLayout}
          playerName={activePlayerName}
          isSyncing={navLayoutSyncing}
          onSave={handleSaveNavLayout}
          onClose={() => setNavCustomizerOpen(false)}
        />
      )}

      {showScrollTop && (
        <button
          onClick={scrollToTop}
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 1000,
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(139, 92, 246, 0.4), var(--shadow-glow)',
            transition: 'all 0.25s ease',
          }}
          className="scroll-to-top-btn"
          title="Scroll to top"
        >
          <ArrowUp size={20} strokeWidth={2.5} />
        </button>
      )}
    </>
  );
}
