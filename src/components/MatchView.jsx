import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Users, CheckCircle, XCircle, Clock } from 'lucide-react';
import { shortenTeamName } from '../utils/teamNames';
import PlayerPicksList from './PlayerPicksList';

export default function MatchView({ matches, allPredictions = [], leaderboard = [], activeParticipantId, selectedMatchId, onClearSelectedMatch }) {
  const [filterStage, setFilterStage] = useState('all'); // 'all', 'group', 'knockouts', 'live'

  const handleScroll = (e, matchId) => {
    const scrollLeft = e.target.scrollLeft;
    const elements = document.querySelectorAll(`.bets-scroll-${matchId}`);
    elements.forEach(el => {
      if (el !== e.target && el.scrollLeft !== scrollLeft) {
        el.scrollLeft = scrollLeft;
      }
    });
  };

  // Pre-calculate running points totals for each participant chronologically up to and including each match
  const runningPointsMap = useMemo(() => {
    const map = {}; // key: `${participantId}_${matchId}` -> runningTotal
    
    // Sort all matches chronologically (by date, then id)
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
  }, [matches, allPredictions, leaderboard]);

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

  // Helper to categorize rounds
  const getMatchCategory = (match) => {
    const type = match.type || 'group';
    if (['r32', 'r16', 'qf', 'sf', 'third', 'final'].includes(type.toLowerCase())) {
      return 'knockouts';
    }
    return 'group';
  };

  // Filter matches
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
      {/* Tabs */}
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

      {/* Matches comparison list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {filteredMatches.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            No matches found for this stage.
          </div>
        ) : (
          filteredMatches.map(m => {
            const homeName = shortenTeamName(m.home_team_name || m.home_team_label || 'TBD');
            const awayName = shortenTeamName(m.away_team_name || m.away_team_label || 'TBD');
            const homeCode = m.home_code || 'H';
            const awayCode = m.away_code || 'A';
            
            // Determine match results if finished
            let actualWinner = null;
            let actualOU = null;
            let actualHighestHalf = null;
            let actualCleanSheet = null;
            if (m.finished === 1) {
              if (m.home_score > m.away_score) actualWinner = 'home';
              else if (m.away_score > m.home_score) actualWinner = 'away';
              else actualWinner = 'draw';

              const totalGoals = m.home_score + m.away_score;
              actualOU = totalGoals > m.over_under_line ? 'over' : 'under';

              if (m.home_ht_score !== null && m.home_ht_score !== undefined && m.away_ht_score !== null && m.away_ht_score !== undefined) {
                const firstHalfGoals = m.home_ht_score + m.away_ht_score;
                const secondHalfGoals = totalGoals - firstHalfGoals;
                if (firstHalfGoals > secondHalfGoals) actualHighestHalf = 'first';
                else if (secondHalfGoals > firstHalfGoals) actualHighestHalf = 'second';
                else actualHighestHalf = 'equal';
              }

              actualCleanSheet = (m.home_score === 0 || m.away_score === 0) ? 'yes' : 'no';
            }

            return (
              <div key={m.id} id={`match-view-card-${m.id}`} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
                
                {/* Match Header */}
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
                        <span style={{ fontSize: '16px', fontWeight: '800', fontFamily: 'var(--font-heading)', color: '#ffffff' }}>
                          {m.home_score}-{m.away_score} {m.status === 'live' ? 'LIVE' : 'FT'}
                        </span>
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

                {/* Shared Players' Picks component */}
                <PlayerPicksList
                  m={m}
                  allPredictions={allPredictions}
                  leaderboard={leaderboard}
                  activeParticipantId={activeParticipantId}
                  runningPointsMap={runningPointsMap}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
