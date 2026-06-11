import React, { useState, useEffect } from 'react';
import { Settings, UserPlus, Trash2, Edit, Save, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';

export default function AdminPanel({ matches, leaderboard, onRefreshData }) {
  const [password, setPassword] = useState(() => localStorage.getItem('admin_pass') || '');
  const [isAuth, setIsAuth] = useState(false);
  const [authError, setAuthError] = useState('');

  // Participant management
  const [newPlayerName, setNewPlayerName] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [playerSuccess, setPlayerSuccess] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);

  // Match override management
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [matchStatus, setMatchStatus] = useState('scheduled');
  const [finished, setFinished] = useState(false);
  const [homeWinPct, setHomeWinPct] = useState(33.3);
  const [awayWinPct, setAwayWinPct] = useState(33.3);
  const [drawPct, setDrawPct] = useState(33.3);
  const [ouLine, setOuLine] = useState(2.5);
  const [overOdds, setOverOdds] = useState(1.9);
  const [underOdds, setUnderOdds] = useState(1.9);
  const [cardsLine, setCardsLine] = useState(3.5);
  const [actualCards, setActualCards] = useState('');
  const [actualFirstScorer, setActualFirstScorer] = useState('none');

  const [matchError, setMatchError] = useState('');
  const [matchSuccess, setMatchSuccess] = useState('');
  const [updatingMatch, setUpdatingMatch] = useState(false);

  // Handle local authentication check
  const handleLogin = (e) => {
    e.preventDefault();
    if (!password) {
      setAuthError('Please enter a password.');
      return;
    }
    // Set authenticated state (password is verified on server calls, so local state is just for UI routing)
    localStorage.setItem('admin_pass', password);
    setIsAuth(true);
    setAuthError('');
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_pass');
    setPassword('');
    setIsAuth(false);
  };

  // Check auth on mount
  useEffect(() => {
    if (password) {
      setIsAuth(true);
    }
  }, []);

  // Update match override form fields when a match is selected
  const handleMatchSelectChange = (e) => {
    const id = parseInt(e.target.value);
    setSelectedMatchId(id || '');

    const m = matches.find(x => x.id === id);
    if (m) {
      setHomeScore(m.home_score);
      setAwayScore(m.away_score);
      setMatchStatus(m.status);
      setFinished(m.finished === 1);
      setHomeWinPct(m.home_win_pct);
      setAwayWinPct(m.away_win_pct);
      setDrawPct(m.draw_pct);
      setOuLine(m.over_under_line);
      setOverOdds(m.over_odds);
      setUnderOdds(m.under_odds);
      setCardsLine(m.cards_line || 3.5);
      setActualCards(m.actual_cards !== null ? m.actual_cards.toString() : '');
      setActualFirstScorer(m.actual_first_scorer || 'none');
      setMatchError('');
      setMatchSuccess('');
    }
  };

  // Add a participant
  const handleAddPlayer = async (e) => {
    e.preventDefault();
    setPlayerError('');
    setPlayerSuccess('');
    if (!newPlayerName.trim()) return;

    setAddingPlayer(true);
    try {
      const response = await fetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPlayerName.trim() })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add player.');
      }

      setPlayerSuccess(`Successfully added ${newPlayerName.trim()}`);
      setNewPlayerName('');
      onRefreshData(); // refresh leaderboard
    } catch (err) {
      setPlayerError(err.message);
    } finally {
      setAddingPlayer(false);
    }
  };

  // Remove a participant
  const handleDeletePlayer = async (id, name) => {
    if (!window.confirm(`Are you sure you want to remove ${name}? This will delete all their predictions and points!`)) {
      return;
    }

    try {
      const response = await fetch(`/api/participants?id=${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove player.');
      }

      onRefreshData(); // refresh leaderboard
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  // Update a match (Manual Override)
  const handleMatchOverride = async (e) => {
    e.preventDefault();
    setMatchError('');
    setMatchSuccess('');

    if (!selectedMatchId) {
      setMatchError('Please select a match.');
      return;
    }

    setUpdatingMatch(true);
    try {
      const response = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          matchId: selectedMatchId,
          homeScore,
          awayScore,
          status: matchStatus,
          finished,
          homeWinPct,
          awayWinPct,
          drawWinPct: drawPct,
          overUnderLine: ouLine,
          overOdds,
          underOdds,
          cardsLine,
          actualCards,
          actualFirstScorer
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update match.');
      }

      setMatchSuccess('Match updated successfully!');
      onRefreshData(); // refresh parent state
    } catch (err) {
      setMatchError(err.message);
    } finally {
      setUpdatingMatch(false);
    }
  };

  // Login Form
  if (!isAuth) {
    return (
      <div className="glass-panel" style={{ maxWidth: '400px', margin: '40px auto' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px', marginBottom: '20px' }}>
          <Settings size={20} color="#8b5cf6" />
          Admin Authentication
        </h2>
        {authError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244, 63, 94, 0.1)', padding: '10px', borderRadius: '6px', color: '#fda4af', fontSize: '13px', marginBottom: '16px' }}>
            <AlertCircle size={14} />
            <span>{authError}</span>
          </div>
        )}
        <form onSubmit={handleLogin}>
          <div className="admin-input-group">
            <label>Admin Password</label>
            <input
              id="admin-password-input"
              type="password"
              className="admin-text-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password..."
            />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%' }}>
            Unlock Portal
          </button>
        </form>
      </div>
    );
  }

  // Active Admin Portal
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Admin header */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Admin Control Panel</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Configure players, edit scores, and override betting lines.</p>
        </div>
        <button className="btn-secondary" onClick={handleLogout}>Log Out</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        
        {/* Left: Player Management */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3>Manage Participants</h3>
          
          {playerError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244, 63, 94, 0.1)', padding: '10px', borderRadius: '6px', color: '#fda4af', fontSize: '13px' }}>
              <AlertCircle size={14} />
              <span>{playerError}</span>
            </div>
          )}

          {playerSuccess && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '6px', color: '#6ee7b7', fontSize: '13px' }}>
              <CheckCircle size={14} />
              <span>{playerSuccess}</span>
            </div>
          )}

          <form onSubmit={handleAddPlayer} style={{ display: 'flex', gap: '10px' }}>
            <input
              id="add-player-input"
              type="text"
              className="admin-text-input"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              placeholder="Player Name (e.g. John Doe)"
              disabled={addingPlayer}
            />
            <button type="submit" className="btn-primary" disabled={addingPlayer} style={{ whiteSpace: 'nowrap' }}>
              <UserPlus size={16} />
              Add Player
            </button>
          </form>

          <div style={{ marginTop: '10px' }}>
            <h4 style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Players</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {leaderboard.length === 0 ? (
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No players registered.</span>
              ) : (
                leaderboard.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                    <span style={{ fontWeight: '600' }}>{p.name}</span>
                    <button 
                      id={`delete-player-btn-${p.id}`}
                      className="btn-danger" 
                      style={{ padding: '4px 8px', fontSize: '12px' }}
                      onClick={() => handleDeletePlayer(p.id, p.name)}
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Match Overrides */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3>Manual Match overrides</h3>

          {matchError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244, 63, 94, 0.1)', padding: '10px', borderRadius: '6px', color: '#fda4af', fontSize: '13px' }}>
              <AlertCircle size={14} />
              <span>{matchError}</span>
            </div>
          )}

          {matchSuccess && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '6px', color: '#6ee7b7', fontSize: '13px' }}>
              <CheckCircle size={14} />
              <span>{matchSuccess}</span>
            </div>
          )}

          <form onSubmit={handleMatchOverride}>
            <div className="admin-input-group">
              <label>Select Match</label>
              <select 
                id="admin-match-select"
                className="admin-select"
                value={selectedMatchId}
                onChange={handleMatchSelectChange}
              >
                <option value="">-- Choose Match --</option>
                {matches.map(m => {
                  const home = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
                  const away = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');
                  return (
                    <option key={m.id} value={m.id}>
                      {m.id}: {home} vs {away} ({m.status.toUpperCase()})
                    </option>
                  );
                })}
              </select>
            </div>

            {selectedMatchId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                
                {/* Score & Cards inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                  <div className="admin-input-group">
                    <label>Home Score</label>
                    <input
                      type="number"
                      min="0"
                      className="admin-text-input"
                      value={homeScore}
                      onChange={(e) => setHomeScore(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="admin-input-group">
                    <label>Away Score</label>
                    <input
                      type="number"
                      min="0"
                      className="admin-text-input"
                      value={awayScore}
                      onChange={(e) => setAwayScore(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div className="admin-input-group">
                    <label>Actual Cards</label>
                    <input
                      type="number"
                      min="0"
                      className="admin-text-input"
                      placeholder="e.g. 4"
                      value={actualCards}
                      onChange={(e) => setActualCards(e.target.value)}
                    />
                  </div>
                  <div className="admin-input-group">
                    <label>First Scorer</label>
                    <select
                      className="admin-select"
                      value={actualFirstScorer}
                      onChange={(e) => setActualFirstScorer(e.target.value)}
                    >
                      <option value="none">No Goal (None)</option>
                      <option value="home">Home Team</option>
                      <option value="away">Away Team</option>
                    </select>
                  </div>
                </div>

                {/* Status & Finished */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'center' }}>
                  <div className="admin-input-group">
                    <label>Match Status</label>
                    <select
                      className="admin-select"
                      value={matchStatus}
                      onChange={(e) => {
                        setMatchStatus(e.target.value);
                        if (e.target.value === 'finished') setFinished(true);
                      }}
                    >
                      <option value="scheduled">Scheduled</option>
                      <option value="live">Live</option>
                      <option value="finished">Finished</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '20px' }}>
                    <input
                      type="checkbox"
                      id="match-finished-checkbox"
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      checked={finished}
                      onChange={(e) => {
                        setFinished(e.target.checked);
                        if (e.target.checked) setMatchStatus('finished');
                        else if (matchStatus === 'finished') setMatchStatus('live');
                      }}
                    />
                    <label htmlFor="match-finished-checkbox" style={{ fontWeight: '600', cursor: 'pointer' }}>Mark Finished (Calculates Points)</label>
                  </div>
                </div>

                {/* Win probabilities */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <div className="admin-input-group">
                    <label>Home Win %</label>
                    <input
                      type="number"
                      step="0.1"
                      className="admin-text-input"
                      value={homeWinPct}
                      onChange={(e) => setHomeWinPct(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="admin-input-group">
                    <label>Draw %</label>
                    <input
                      type="number"
                      step="0.1"
                      className="admin-text-input"
                      value={drawPct}
                      onChange={(e) => setDrawPct(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="admin-input-group">
                    <label>Away Win %</label>
                    <input
                      type="number"
                      step="0.1"
                      className="admin-text-input"
                      value={awayWinPct}
                      onChange={(e) => setAwayWinPct(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                {/* Over/Under Line */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <div className="admin-input-group">
                    <label>O/U Goals Target</label>
                    <input
                      type="number"
                      step="0.5"
                      className="admin-text-input"
                      value={ouLine}
                      onChange={(e) => setOuLine(parseFloat(e.target.value) || 2.5)}
                    />
                  </div>
                  <div className="admin-input-group">
                    <label>Goals Over Odds</label>
                    <input
                      type="number"
                      step="0.01"
                      className="admin-text-input"
                      value={overOdds}
                      onChange={(e) => setOverOdds(parseFloat(e.target.value) || 1.9)}
                    />
                  </div>
                  <div className="admin-input-group">
                    <label>Goals Under Odds</label>
                    <input
                      type="number"
                      step="0.01"
                      className="admin-text-input"
                      value={underOdds}
                      onChange={(e) => setUnderOdds(parseFloat(e.target.value) || 1.9)}
                    />
                  </div>
                </div>

                {/* Cards Over/Under Line */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  <div className="admin-input-group">
                    <label>Cards O/U Target</label>
                    <input
                      type="number"
                      step="0.5"
                      className="admin-text-input"
                      value={cardsLine}
                      onChange={(e) => setCardsLine(parseFloat(e.target.value) || 3.5)}
                    />
                  </div>
                </div>

                <button type="submit" className="btn-primary" disabled={updatingMatch} style={{ marginTop: '8px' }}>
                  <Save size={16} />
                  {updatingMatch ? 'Updating...' : 'Save Match Override'}
                </button>

              </div>
            )}

          </form>
        </div>

      </div>

    </div>
  );
}
