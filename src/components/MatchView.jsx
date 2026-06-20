import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';
import PlayerPicksList from './PlayerPicksList';

export default function MatchView({ matches, statsData, fetchStats, leaderboard = [], activeParticipantId, selectedMatchId, onClearSelectedMatch, onRefresh, matchPredictionsCache = {}, getMatchPredictions }) {
  const [filterStage, setFilterStage] = useState('all');

  // Lazy-load stats on mount
  useEffect(() => {
    if (fetchStats) fetchStats();
  }, []);

  // Stage tab definitions
  const stages = [
    { id: 'all', label: 'All Matches' },
    { id: 'group', label: 'Group Stage' },
    { id: 'knockouts', label: 'Knockout Stage' },
    { id: 'live', label: 'Live & Finished' }
  ];

  useEffect(() => {
    if (selectedMatchId) {
      setFilterStage('all');
      setTimeout(() => {
        const element = document.getElementById(`match-view-card-${selectedMatchId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('match-card-highlight');
          setTimeout(() => {
            element.classList.remove('match-card-highlight');
          }, 3000);
        }
        if (onClearSelectedMatch) {
          onClearSelectedMatch();
        }
      }, 150);
    }
  }, [selectedMatchId, matches, onClearSelectedMatch]);

  const getMatchCategory = (match) => {
    const type = match.type || 'group';
    if (['r32', 'r16', 'qf', 'sf', 'third', 'final'].includes(type.toLowerCase())) {
      return 'knockouts';
    }
    return 'group';
  };

  const filteredMatches = matches.filter(m => {
    if (filterStage === 'all') return true;
    if (filterStage === 'group') return getMatchCategory(m) === 'group';
    if (filterStage === 'knockouts') return getMatchCategory(m) === 'knockouts';
    if (filterStage === 'live') return m.status === 'live' || m.finished === 1;
    return true;
  });

  const getRoundLabel = (m) => {
    const t = m.type || 'group';
    if (t === 'group') return `Group ${m.group_name || 'A'}`;
    if (t === 'r32') return 'Round of 32';
    if (t === 'r16') return 'Round of 16';
    if (t === 'qf') return 'Quarter-final';
    if (t === 'sf') return 'Semi-final';
    if (t === 'third') return '3rd Place Playoff';
    if (t === 'final') return 'World Cup Final';
    return t;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="stage-tabs">
        {stages.map(s => (
          <button
            key={s.id}
            className={`stage-tab ${filterStage === s.id ? 'active' : ''}`}
            onClick={() => setFilterStage(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {filteredMatches.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No matches found for this stage.
          </div>
        ) : (
          filteredMatches.map(m => {
            const matchPreds = matchPredictionsCache[m.id];
            if (!matchPreds && (m.finished === 1 || m.status === 'live')) {
              getMatchPredictions(m.id);
            }

            const homeName = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
            const awayName = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');

            return (
              <div key={m.id} id={`match-view-card-${m.id}`} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary-hover)', letterSpacing: '0.05em' }}>
                      {getRoundLabel(m)}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '16px', fontWeight: '800', fontFamily: 'var(--font-heading)' }}>
                        {homeName} vs {awayName}
                      </span>
                      {m.status !== 'scheduled' && (
                        <>
                          <span style={{ fontSize: '16px', fontWeight: '800', fontFamily: 'var(--font-heading)', color: '#ffffff' }}>
                            {m.home_score}-{m.away_score}
                          </span>
                          <span className={`match-badge ${m.status === 'live' ? 'live' : 'finished'}`} style={{ marginTop: 0 }}>
                            {m.status === 'live' ? 'Live' : 'FT'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600' }}>
                      <Calendar size={14} />
                      {formatMatchDate(m.local_date)}
                    </span>
                    {m.status === 'scheduled' && (
                      <span className="match-badge scheduled" style={{ fontSize: '10px', padding: '4px 8px' }}>Scheduled</span>
                    )}
                  </div>
                </div>

                <PlayerPicksList
                  m={m}
                  matchPredictions={matchPreds}
                  leaderboard={leaderboard}
                  activeParticipantId={activeParticipantId}
                  showLiveResults={m.status === 'live'}
                  onRefresh={onRefresh}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}