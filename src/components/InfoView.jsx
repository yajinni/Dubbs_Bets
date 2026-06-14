import React from 'react';

export default function InfoView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div className="glass-panel" style={{ borderLeft: '4px solid var(--primary)' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '800', margin: '0 0 6px 0' }}>How Betting Works</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
          Before each match kicks off, place your predictions. Once the match starts, your picks are locked in.
          Points are awarded automatically when results are confirmed.
        </p>
      </div>

      {/* Bet types grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>

        {/* Winner */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #a855f7', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>🏆 Match Winner</span>
            <span style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>3 pts</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Pick who wins — <strong style={{ color: 'var(--text-primary)' }}>Home</strong>, <strong style={{ color: 'var(--text-primary)' }}>Away</strong>, or <strong style={{ color: 'var(--text-primary)' }}>Draw</strong>.
            3 points awarded if your pick matches the final result.
          </p>
        </div>

        {/* Goals O/U */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #22c55e', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>⚽ Goals Over / Under</span>
            <span style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>1 pt</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Will the total goals be <strong style={{ color: 'var(--text-primary)' }}>Over</strong> or <strong style={{ color: 'var(--text-primary)' }}>Under</strong> the line shown on each match (e.g. 2.5)?
            1 point if correct.
          </p>
        </div>

        {/* Underdog Bonus */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #fbbf24', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>🐉 Underdog Bonus</span>
            <span style={{ background: 'rgba(251,191,36,0.2)', color: '#fbbf24', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>+1 pt</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            If you pick the team with the <strong style={{ color: '#fbbf24' }}>lower win probability</strong> and they actually win, you earn a bonus point automatically — no extra pick needed!
          </p>
        </div>

        {/* First Scorer */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #ec4899', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>🎯 Scored First</span>
            <span style={{ background: 'rgba(236,72,153,0.2)', color: '#f472b6', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>2 pts</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Pick which team scores first — <strong style={{ color: 'var(--text-primary)' }}>Home</strong>, <strong style={{ color: 'var(--text-primary)' }}>Away</strong>, or <strong style={{ color: 'var(--text-primary)' }}>No Goal</strong> (0-0).
            2 points if correct.
          </p>
        </div>

        {/* Exact Score */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #eab308', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>📊 Exact Scoreline</span>
            <span style={{ background: 'rgba(234,179,8,0.2)', color: '#fde047', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>4 pts</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Predict the exact final score (e.g. <strong style={{ color: 'var(--text-primary)' }}>2 – 1</strong>).
            Worth <strong style={{ color: '#fde047' }}>4 points</strong> — the biggest single reward!
          </p>
        </div>

        {/* Exact Total Cards */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #06b6d4', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>🟨 Exact Total Cards</span>
            <span style={{ background: 'rgba(6,182,212,0.2)', color: '#67e8f9', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>3 pts</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Guess the <strong style={{ color: 'var(--text-primary)' }}>exact number of yellow + red cards</strong> shown in the match.
            3 points if you nail it exactly.
          </p>
        </div>

        {/* Highest Scoring Half */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #c084fc', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>⏰ Highest Scoring Half</span>
            <span style={{ background: 'rgba(192,132,252,0.2)', color: '#c084fc', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>2 pts</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Predict which half will have more total goals scored — <strong style={{ color: 'var(--text-primary)' }}>1st Half</strong>, <strong style={{ color: 'var(--text-primary)' }}>2nd Half</strong>, or <strong style={{ color: 'var(--text-primary)' }}>Equal</strong>.
            2 points if correct.
          </p>
        </div>

        {/* Clean Sheet */}
        <div className="glass-panel" style={{ borderLeft: '4px solid #38bdf8', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '15px', fontWeight: '800' }}>🧤 Clean Sheet</span>
            <span style={{ background: 'rgba(56,189,248,0.2)', color: '#38bdf8', fontSize: '12px', fontWeight: '800', padding: '3px 10px', borderRadius: '99px' }}>1 pt</span>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            Will at least one team keep a clean sheet (i.e. score 0 goals)?
            Choose <strong style={{ color: 'var(--text-primary)' }}>Yes</strong> or <strong style={{ color: 'var(--text-primary)' }}>No</strong>.
            1 point if correct.
          </p>
        </div>

      </div>

      {/* Max points summary */}
      <div className="glass-panel" style={{ background: 'rgba(139,92,246,0.07)', borderLeft: '4px solid var(--primary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h4 style={{ fontSize: '14px', fontWeight: '800', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔢 Maximum Points Per Match</h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          {[
            { label: 'Winner', pts: 3, color: '#a855f7' },
            { label: 'Goals O/U', pts: 1, color: '#22c55e' },
            { label: 'Underdog Bonus', pts: 1, color: '#fbbf24' },
            { label: 'Scored First', pts: 2, color: '#ec4899' },
            { label: 'Exact Score', pts: 4, color: '#eab308' },
            { label: 'Exact Cards', pts: 3, color: '#06b6d4' },
            { label: 'Highest scoring Half', pts: 2, color: '#c084fc' },
            { label: 'Clean Sheet', pts: 1, color: '#38bdf8' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{item.label}</span>
              <span style={{ fontSize: '14px', fontWeight: '800', color: item.color }}>+{item.pts}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(139,92,246,0.15)', padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(139,92,246,0.3)' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Total Max</span>
            <span style={{ fontSize: '16px', fontWeight: '900', color: '#c084fc' }}>18 pts</span>
          </div>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
          Picks are locked the moment a match kicks off. Make sure you submit before then!
        </p>
      </div>
    </div>
  );
}
