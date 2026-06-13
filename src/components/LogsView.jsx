import React, { useState, useEffect } from 'react';
import { RefreshCw, Search, Database, Clock, ChevronRight } from 'lucide-react';

export default function LogsView() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (Array.isArray(data)) {
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatLogDate = (isoString) => {
    if (!isoString) return '';
    let normalized = isoString.replace(' ', 'T');
    const hasTimezone = normalized.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(normalized);
    
    let date;
    if (hasTimezone) {
      date = new Date(normalized);
    } else {
      date = new Date(normalized + '-04:00');
    }
    
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) + ' ET';
  };

  const getCategoryBadgeColor = (category) => {
    switch (category) {
      case 'odds':
        return { bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc', border: 'rgba(168, 85, 247, 0.3)' };
      case 'match_time':
        return { bg: 'rgba(249, 115, 22, 0.15)', text: '#fb923c', border: 'rgba(249, 115, 22, 0.3)' };
      case 'prediction':
        return { bg: 'rgba(34, 197, 94, 0.15)', text: '#4ade80', border: 'rgba(34, 197, 94, 0.3)' };
      case 'score':
        return { bg: 'rgba(14, 165, 233, 0.15)', text: '#38bdf8', border: 'rgba(14, 165, 233, 0.3)' };
      case 'cards':
        return { bg: 'rgba(244, 63, 94, 0.15)', text: '#fb7185', border: 'rgba(244, 63, 94, 0.3)' };
      default:
        return { bg: 'rgba(156, 163, 175, 0.15)', text: '#9ca3af', border: 'rgba(156, 163, 175, 0.3)' };
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesCategory = filterCategory === 'all' || log.category === filterCategory;
    const matchesSearch = 
      searchTerm === '' ||
      (log.description && log.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (log.old_value && String(log.old_value).toLowerCase().includes(searchTerm.toLowerCase())) ||
      (log.new_value && String(log.new_value).toLowerCase().includes(searchTerm.toLowerCase())) ||
      (log.category && log.category.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px 0' }}>
      
      {/* Search & Filters Panel */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <Database size={20} className="text-secondary" />
            Activity & Update Logs
          </h2>
          <button 
            onClick={fetchLogs} 
            disabled={loading}
            className="choice-btn"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: 'auto', padding: '8px 16px' }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh Logs
          </button>
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search Input */}
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search logs (description, value)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="admin-select"
              style={{ paddingLeft: '38px', width: '100%' }}
            />
          </div>

          {/* Category Filter Pills */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {['all', 'prediction', 'odds', 'match_time', 'score', 'cards'].map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`choice-btn ${filterCategory === cat ? 'active' : ''}`}
                style={{ width: 'auto', padding: '6px 12px', textTransform: 'capitalize', fontSize: '13px' }}
              >
                {cat.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && logs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: '12px' }}>
            <RefreshCw size={36} className="animate-spin text-secondary" />
            <span style={{ color: 'var(--text-secondary)' }}>Fetching activity logs...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px', gap: '8px', textAlign: 'center' }}>
            <Clock size={36} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>No logs found</span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Try adjusting your search or category filter.</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.02)' }}>
                  <th style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: '600' }}>Time</th>
                  <th style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: '600' }}>Category</th>
                  <th style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: '600' }}>Description</th>
                  <th style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: '600', textAlign: 'center' }}>Change History</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const badge = getCategoryBadgeColor(log.category);
                  return (
                    <tr 
                      key={log.id} 
                      style={{ 
                        borderBottom: '1px solid var(--glass-border)',
                        transition: 'background 0.2s',
                      }}
                      className="log-row-hover"
                    >
                      <td style={{ padding: '16px 20px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {formatLogDate(log.timestamp)}
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <span style={{ 
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '700',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          backgroundColor: badge.bg,
                          color: badge.text,
                          border: `1px solid ${badge.border}`
                        }}>
                          {log.category.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '16px 20px', fontWeight: '500', color: 'var(--text-primary)' }}>
                        {log.description}
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                          <span style={{ 
                            padding: '4px 8px', 
                            background: 'rgba(255,255,255,0.04)', 
                            borderRadius: '6px', 
                            fontSize: '13px', 
                            color: log.old_value !== null ? 'var(--text-secondary)' : 'var(--text-muted)',
                            fontFamily: 'monospace'
                          }}>
                            {log.old_value !== null ? String(log.old_value) : 'None'}
                          </span>
                          <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ 
                            padding: '4px 8px', 
                            background: 'rgba(251, 191, 36, 0.1)', 
                            border: '1px solid rgba(251, 191, 36, 0.2)',
                            borderRadius: '6px', 
                            fontSize: '13px', 
                            fontWeight: '600',
                            color: '#fbbf24',
                            fontFamily: 'monospace'
                          }}>
                            {log.new_value !== null ? String(log.new_value) : 'None'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
