import React, { useState } from 'react';
import { X, ChevronUp, ChevronDown, Check, LayoutDashboard, Ticket, Radio, Award, BarChart2, List, Info, Cloud, CloudOff } from 'lucide-react';

const ICONS = {
  dashboard: LayoutDashboard,
  matches: Ticket,
  live: Radio,
  'match-view': Award,
  stats: BarChart2,
  logs: List,
  info: Info,
};

export default function NavCustomizerModal({ navLayout, playerName, isSyncing = false, onSave, onClose }) {
  const [items, setItems] = useState([...navLayout]);
  const [savedToCloud, setSavedToCloud] = useState(false);

  const toggleHeader = (id) => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, inHeader: !item.inHeader } : item
    ));
  };

  const moveUp = (idx) => {
    if (idx === 0) return;
    setItems(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx) => {
    setItems(prev => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next;
    });
  };

  const handleSave = async () => {
    setSavedToCloud(false);
    await onSave(items);
    setSavedToCloud(true);
    setTimeout(() => setSavedToCloud(false), 3000);
    onClose();
  };

  const handleReset = () => {
    setItems([
      { id: 'dashboard',  label: 'Dashboard', inHeader: true  },
      { id: 'matches',    label: 'Bets',       inHeader: true  },
      { id: 'live',       label: 'Live',        inHeader: true  },
      { id: 'match-view', label: 'Results',    inHeader: false },
      { id: 'stats',      label: 'Stats',       inHeader: false },
      { id: 'logs',       label: 'Logs',        inHeader: false },
      { id: 'info',       label: 'Info',        inHeader: false },
    ]);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(3, 0, 10, 0.75)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 1100,
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* Modal Panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 1101,
          width: 'min(92vw, 380px)',
          background: 'rgba(12, 8, 28, 0.98)',
          border: '1px solid rgba(139, 92, 246, 0.35)',
          borderRadius: '18px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.1), 0 0 40px rgba(139,92,246,0.08)',
          padding: '0',
          overflow: 'hidden',
          animation: 'slideUpFadeIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(99,102,241,0.08) 100%)',
        }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '0.01em' }}>
              Customize Nav
            </div>
            {playerName ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                Saved for <span style={{ color: 'var(--primary)', fontWeight: '700' }}>{playerName}</span>
                {isSyncing ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#f59e0b', fontSize: '10px' }}>
                    <Cloud size={10} style={{ animation: 'spinAnim 1s linear infinite' }} /> syncing…
                  </span>
                ) : savedToCloud ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--success)', fontSize: '10px' }}>
                    <Cloud size={10} /> saved to cloud ✓
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'rgba(255,255,255,0.25)', fontSize: '10px' }}>
                    <Cloud size={10} /> syncs across devices
                  </span>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <CloudOff size={10} />
                <span>Select a player to sync across devices</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer',
              width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s'
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: '20px', padding: '10px 20px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <div style={{
              width: '16px', height: '16px', borderRadius: '4px',
              background: 'rgba(139,92,246,0.25)', border: '1px solid var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Check size={10} color="var(--primary)" strokeWidth={3} />
            </div>
            Shows in header / bottom bar
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <div style={{
              width: '16px', height: '16px', borderRadius: '4px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)',
            }} />
            Sidebar only
          </div>
        </div>

        {/* Item List */}
        <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '55vh', overflowY: 'auto' }}>
          {items.map((item, idx) => {
            const Icon = ICONS[item.id];
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: item.inHeader
                    ? 'linear-gradient(135deg, rgba(139,92,246,0.1) 0%, rgba(99,102,241,0.06) 100%)'
                    : 'rgba(255,255,255,0.02)',
                  border: item.inHeader
                    ? '1px solid rgba(139,92,246,0.25)'
                    : '1px solid rgba(255,255,255,0.05)',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleHeader(item.id)}
                  title={item.inHeader ? 'Remove from header' : 'Add to header'}
                  style={{
                    flexShrink: 0,
                    width: '22px', height: '22px', borderRadius: '5px',
                    border: item.inHeader ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.18)',
                    background: item.inHeader ? 'rgba(139,92,246,0.28)' : 'rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.18s ease',
                    padding: 0,
                  }}
                >
                  {item.inHeader && <Check size={12} color="var(--primary)" strokeWidth={3} />}
                </button>

                {/* Icon + Label */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  {Icon && <Icon size={15} color={item.inHeader ? 'var(--primary)' : 'var(--text-muted)'} />}
                  <span style={{
                    fontSize: '14px', fontWeight: '700',
                    color: item.inHeader ? 'var(--text-primary)' : 'var(--text-muted)',
                    transition: 'color 0.2s',
                  }}>
                    {item.label}
                  </span>
                  {item.inHeader && (
                    <span style={{
                      fontSize: '10px', fontWeight: '700',
                      background: 'rgba(139,92,246,0.18)', color: 'var(--primary)',
                      border: '1px solid rgba(139,92,246,0.3)',
                      borderRadius: '4px', padding: '1px 5px',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>
                      header
                    </span>
                  )}
                </div>

                {/* Up / Down arrows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                  <button
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    title="Move up"
                    style={{
                      width: '24px', height: '22px', borderRadius: '5px',
                      background: idx === 0 ? 'transparent' : 'rgba(255,255,255,0.06)',
                      border: idx === 0 ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)',
                      color: idx === 0 ? 'rgba(255,255,255,0.15)' : 'var(--text-secondary)',
                      cursor: idx === 0 ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 0, transition: 'all 0.15s',
                    }}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={idx === items.length - 1}
                    title="Move down"
                    style={{
                      width: '24px', height: '22px', borderRadius: '5px',
                      background: idx === items.length - 1 ? 'transparent' : 'rgba(255,255,255,0.06)',
                      border: idx === items.length - 1 ? '1px solid transparent' : '1px solid rgba(255,255,255,0.1)',
                      color: idx === items.length - 1 ? 'rgba(255,255,255,0.15)' : 'var(--text-secondary)',
                      cursor: idx === items.length - 1 ? 'default' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 0, transition: 'all 0.15s',
                    }}
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: '10px', padding: '14px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <button
            onClick={handleReset}
            style={{
              flex: 1, padding: '10px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-muted)', fontSize: '13px', fontWeight: '700',
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={isSyncing}
            style={{
              flex: 2, padding: '10px', borderRadius: '10px',
              background: isSyncing
                ? 'rgba(139,92,246,0.4)'
                : 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)',
              border: 'none', color: '#fff', fontSize: '13px', fontWeight: '800',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              boxShadow: isSyncing ? 'none' : '0 4px 14px rgba(139,92,246,0.4)',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
            }}
          >
            {isSyncing ? (
              <><Cloud size={13} style={{ animation: 'spinAnim 1s linear infinite' }} /> Saving…</>
            ) : (
              <><Cloud size={13} /> Save Layout</>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
