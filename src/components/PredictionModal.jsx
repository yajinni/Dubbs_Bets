import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';

export default function PredictionModal({ isOpen, onClose, match, participant, existingPrediction, onSave }) {
  const [winner, setWinner] = useState(''); // 'home', 'away', or 'draw'
  const [overUnder, setOverUnder] = useState(''); // 'over', 'under'
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existingPrediction) {
      setWinner(existingPrediction.predicted_winner || '');
      setOverUnder(existingPrediction.predicted_over_under || '');
      setHomeScore(existingPrediction.predicted_home_score !== null ? existingPrediction.predicted_home_score.toString() : '');
      setAwayScore(existingPrediction.predicted_away_score !== null ? existingPrediction.predicted_away_score.toString() : '');
    } else {
      setWinner('');
      setOverUnder('');
      setHomeScore('');
      setAwayScore('');
    }
    setError('');
  }, [existingPrediction, match]);

  if (!isOpen || !match || !participant) return null;

  const homeName = match.home_team_name || match.home_team_label || 'TBD';
  const awayName = match.away_team_name || match.away_team_label || 'TBD';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Validations
    if (!winner) {
      setError('Please select an expected winner or draw.');
      return;
    }
    if (!overUnder) {
      setError('Please select Over or Under expected goals.');
      return;
    }
    if (homeScore === '' || awayScore === '') {
      setError('Please enter expected scores for both teams.');
      return;
    }

    const hScore = parseInt(homeScore);
    const aScore = parseInt(awayScore);

    if (isNaN(hScore) || isNaN(aScore) || hScore < 0 || aScore < 0) {
      setError('Scores must be positive numbers.');
      return;
    }

    // Logical checks
    if (winner === 'home' && hScore <= aScore) {
      setError(`You predicted ${homeName} to win, but score is set as a draw/loss.`);
      return;
    }
    if (winner === 'away' && aScore <= hScore) {
      setError(`You predicted ${awayName} to win, but score is set as a draw/loss.`);
      return;
    }
    if (winner === 'draw' && hScore !== aScore) {
      setError(`You predicted a Draw, but the scores are unequal.`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/predictions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          participantId: participant.id,
          matchId: match.id,
          predictedWinner: winner,
          predictedOverUnder: overUnder,
          predictedHomeScore: hScore,
          predictedAwayScore: aScore,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save prediction.');
      }

      onSave();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title">Place Prediction</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Predicting for:</span>
              <h4 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--primary-hover)', marginTop: '2px' }}>
                {participant.name}
              </h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {homeName} vs {awayName}
              </p>
            </div>

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.2)', padding: '12px', borderRadius: '8px', color: '#fda4af', fontSize: '14px' }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* 1. Winner Selection */}
            <div className="prediction-form-section">
              <span className="prediction-section-title">Expected Outcome</span>
              <div className="choice-grid">
                <button
                  type="button"
                  className={`choice-card ${winner === 'home' ? 'selected' : ''}`}
                  onClick={() => setWinner('home')}
                >
                  <div className="choice-card-title">{homeName}</div>
                  <div className="choice-card-subtitle">Home Win</div>
                </button>
                <button
                  type="button"
                  className={`choice-card ${winner === 'draw' ? 'selected' : ''}`}
                  onClick={() => setWinner('draw')}
                >
                  <div className="choice-card-title">Draw</div>
                  <div className="choice-card-subtitle">90 Min Draw</div>
                </button>
                <button
                  type="button"
                  className={`choice-card ${winner === 'away' ? 'selected' : ''}`}
                  onClick={() => setWinner('away')}
                >
                  <div className="choice-card-title">{awayName}</div>
                  <div className="choice-card-subtitle">Away Win</div>
                </button>
              </div>
            </div>

            {/* 2. Over/Under Selection */}
            <div className="prediction-form-section">
              <span className="prediction-section-title">Total Match Goals (O/U {match.over_under_line})</span>
              <div className="choice-grid two-cols">
                <button
                  type="button"
                  className={`choice-card ${overUnder === 'over' ? 'selected' : ''}`}
                  onClick={() => setOverUnder('over')}
                >
                  <div className="choice-card-title">Over</div>
                  <div className="choice-card-subtitle">{`> ${match.over_under_line} goals`}</div>
                </button>
                <button
                  type="button"
                  className={`choice-card ${overUnder === 'under' ? 'selected' : ''}`}
                  onClick={() => setOverUnder('under')}
                >
                  <div className="choice-card-title">Under</div>
                  <div className="choice-card-subtitle">{`< ${match.over_under_line} goals`}</div>
                </button>
              </div>
            </div>

            {/* 3. Score Selection */}
            <div className="prediction-form-section">
              <span className="prediction-section-title">Exact Score Prediction</span>
              <div className="score-inputs-container">
                <div className="score-input-wrapper">
                  <span>{homeName}</span>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    className="score-number-input"
                    value={homeScore}
                    onChange={(e) => setHomeScore(e.target.value)}
                    placeholder="0"
                  />
                </div>
                
                <span style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-muted)', marginTop: '20px' }}>-</span>

                <div className="score-input-wrapper">
                  <span>{awayName}</span>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    className="score-number-input"
                    value={awayScore}
                    onChange={(e) => setAwayScore(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Prediction'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
