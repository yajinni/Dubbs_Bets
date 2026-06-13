// Cloudflare Pages Functions: API route to retrieve and submit predictions (GET, POST)
import { checkAndInitDb, logChange } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    if (method === 'GET') {
      const url = new URL(request.url);
      const participantId = url.searchParams.get('participantId');

      if (!participantId) {
        // Return all predictions in system with participant names
        const { results } = await env.db.prepare(`
          SELECT pr.*, p.name AS participant_name
          FROM predictions pr
          INNER JOIN participants p ON pr.participant_id = p.id
        `).all();
        return new Response(JSON.stringify(results), { status: 200, headers });
      }

      // Return predictions for a specific participant
      const { results } = await env.db.prepare(`
        SELECT p.*, m.home_team_name, m.away_team_name, m.local_date, m.status, m.finished
        FROM predictions p
        INNER JOIN matches m ON p.match_id = m.id
        WHERE p.participant_id = ?
      `).bind(parseInt(participantId)).all();

      return new Response(JSON.stringify(results), { status: 200, headers });
    }

    if (method === 'POST') {
      const body = await request.json();
      const { 
        participantId, 
        matchId, 
        predictedWinner,       // 'home', 'away', or 'draw'
        predictedOverUnder,    // 'over' or 'under'
        predictedHomeScore, 
        predictedAwayScore,
        predictedTotalCards,     // integer or null
        predictedFirstScorer,     // 'home', 'away', or 'none'
        predictedHighestScoringHalf, // 'first', 'second', or 'equal'
        predictedCleanSheet      // 'yes' or 'no'
      } = body;

      if (!participantId || !matchId) {
        return new Response(JSON.stringify({ error: 'Participant ID and Match ID are required' }), { status: 400, headers });
      }

      // 1. Fetch match to verify it exists and check if it has already started
      const match = await env.db.prepare('SELECT local_date, status, finished, home_score, away_score, home_ht_score, away_ht_score, over_under_line, actual_cards, actual_first_scorer, home_win_pct, away_win_pct FROM matches WHERE id = ?').bind(matchId).first();

      if (!match) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      // 2. Lock prediction if match has started
      const matchStartTime = new Date(match.local_date).getTime();
      const currentTime = Date.now();

      if (currentTime >= matchStartTime || match.status !== 'scheduled' || match.finished === 1) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      // Validate inputs
      const pHomeScore = predictedHomeScore !== null && predictedHomeScore !== undefined ? parseInt(predictedHomeScore) : null;
      const pAwayScore = predictedAwayScore !== null && predictedAwayScore !== undefined ? parseInt(predictedAwayScore) : null;
      const pTotalCards = (predictedTotalCards !== null && predictedTotalCards !== undefined && predictedTotalCards !== '') ? parseInt(predictedTotalCards) : null;
      const pFirstScorer = predictedFirstScorer || null;
      const pHalfPick = predictedHighestScoringHalf || null;
      const pCleanPick = predictedCleanSheet || null;

      // Get participant name and match info
      const participant = await env.db.prepare('SELECT name FROM participants WHERE id = ?').bind(participantId).first();
      const participantName = participant ? participant.name : `Player ID ${participantId}`;
      const matchDetails = await env.db.prepare(`
        SELECT m.home_team_name, m.away_team_name, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchId).first();
      
      const homeCode = matchDetails?.home_code || matchDetails?.home_team_name.substring(0, 3).toUpperCase() || 'HOM';
      const awayCode = matchDetails?.away_code || matchDetails?.away_team_name.substring(0, 3).toUpperCase() || 'AWA';
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // 3. Upsert prediction
      const checkQuery = 'SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?';
      const existing = await env.db.prepare(checkQuery).bind(participantId, matchId).first();

      // Log changes
      const oldWinner = existing ? existing.predicted_winner : null;
      const newWinner = predictedWinner || null;
      if (oldWinner !== newWinner) {
        await logChange(env.db, 'prediction', matchId, participantId, `${participantName} winner prediction for ${matchLabel}`, oldWinner, newWinner);
      }

      const oldOU = existing ? existing.predicted_over_under : null;
      const newOU = predictedOverUnder || null;
      if (oldOU !== newOU) {
        await logChange(env.db, 'prediction', matchId, participantId, `${participantName} over/under prediction for ${matchLabel}`, oldOU, newOU);
      }

      const oldHome = existing ? existing.predicted_home_score : null;
      const oldAway = existing ? existing.predicted_away_score : null;
      const oldScore = (oldHome !== null && oldAway !== null) ? `${oldHome}-${oldAway}` : null;
      const newScore = (pHomeScore !== null && pAwayScore !== null) ? `${pHomeScore}-${pAwayScore}` : null;
      if (oldScore !== newScore) {
        await logChange(env.db, 'prediction', matchId, participantId, `${participantName} score prediction for ${matchLabel}`, oldScore, newScore);
      }

      const oldCards = existing ? existing.predicted_total_cards : null;
      const newCards = pTotalCards;
      if (oldCards !== newCards) {
        await logChange(env.db, 'prediction', matchId, participantId, `${participantName} total cards prediction for ${matchLabel}`, oldCards, newCards);
      }

      const oldFirstScorer = existing ? existing.predicted_first_scorer : null;
      const newFirstScorer = pFirstScorer;
      if (oldFirstScorer !== newFirstScorer) {
        await logChange(env.db, 'prediction', matchId, participantId, `${participantName} first scorer prediction for ${matchLabel}`, oldFirstScorer, newFirstScorer);
      }

      const oldHalf = existing ? existing.predicted_highest_scoring_half : null;
      const newHalf = pHalfPick;
      if (oldHalf !== newHalf) {
        await logChange(env.db, 'prediction', matchId, participantId, `${participantName} highest scoring half prediction for ${matchLabel}`, oldHalf, newHalf);
      }

      const oldClean = existing ? existing.predicted_clean_sheet : null;
      const newClean = pCleanPick;
      if (oldClean !== newClean) {
        await logChange(env.db, 'prediction', matchId, participantId, `${participantName} clean sheet prediction for ${matchLabel}`, oldClean, newClean);
      }

      if (existing) {
        const updateQuery = `
          UPDATE predictions 
          SET 
            predicted_winner = ?, 
            predicted_over_under = ?, 
            predicted_home_score = ?, 
            predicted_away_score = ?,
            predicted_total_cards = ?,
            predicted_first_scorer = ?,
            predicted_highest_scoring_half = ?,
            predicted_clean_sheet = ?
          WHERE participant_id = ? AND match_id = ?
        `;
        await env.db.prepare(updateQuery)
          .bind(predictedWinner, predictedOverUnder, pHomeScore, pAwayScore, pTotalCards, pFirstScorer, pHalfPick, pCleanPick, participantId, matchId)
          .run();
      } else {
        const insertQuery = `
          INSERT INTO predictions (
            participant_id, 
            match_id, 
            predicted_winner, 
            predicted_over_under, 
            predicted_home_score, 
            predicted_away_score,
            predicted_total_cards,
            predicted_first_scorer,
            predicted_highest_scoring_half,
            predicted_clean_sheet
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await env.db.prepare(insertQuery)
          .bind(participantId, matchId, predictedWinner, predictedOverUnder, pHomeScore, pAwayScore, pTotalCards, pFirstScorer, pHalfPick, pCleanPick)
          .run();
      }

      // 4. Immediately calculate points for this prediction if the match is already finished
      if (match.finished === 1) {
        const homeScore = match.home_score;
        const awayScore = match.away_score;
        const ouLine = match.over_under_line;
        
        let winnerResult = 'draw';
        if (homeScore > awayScore) winnerResult = 'home';
        else if (awayScore > homeScore) winnerResult = 'away';
        
        const totalGoals = homeScore + awayScore;
        const ouResult = totalGoals > ouLine ? 'over' : 'under';
        
        const pWinner = predictedWinner === winnerResult ? 3 : 0;
        const pOu = predictedOverUnder === ouResult ? 1 : 0;
        const pScore = (pHomeScore === homeScore && pAwayScore === awayScore) ? 1 : 0;

        // Underdog Bonus: +1 if player picked the option and that outcome occurred, provided it was not the option with the highest win probability (favorite)
        let pUnderdog = 0;
        if (pWinner > 0 && match.home_win_pct != null && match.away_win_pct != null && match.draw_pct != null) {
          const maxPct = Math.max(match.home_win_pct, match.away_win_pct, match.draw_pct);
          if (winnerResult === 'home' && match.home_win_pct < maxPct) pUnderdog = 1;
          else if (winnerResult === 'away' && match.away_win_pct < maxPct) pUnderdog = 1;
          else if (winnerResult === 'draw' && match.draw_pct < maxPct) pUnderdog = 1;
        }

        let pTotalCardsEarned = 0;
        if (match.actual_cards !== null && pTotalCards !== null) {
          pTotalCardsEarned = pTotalCards === match.actual_cards ? 3 : 0;
        }

        let pFirstScorerEarned = 0;
        if (match.actual_first_scorer !== null && pFirstScorer !== null) {
          pFirstScorerEarned = pFirstScorer === match.actual_first_scorer ? 2 : 0;
        }

        // Halftime scorer calculations
        let winnerHalf = null;
        if (match.home_ht_score !== null && match.home_ht_score !== undefined && match.away_ht_score !== null && match.away_ht_score !== undefined) {
          const firstHalfGoals = match.home_ht_score + match.away_ht_score;
          const secondHalfGoals = totalGoals - firstHalfGoals;
          if (firstHalfGoals > secondHalfGoals) winnerHalf = 'first';
          else if (secondHalfGoals > firstHalfGoals) winnerHalf = 'second';
          else winnerHalf = 'equal';
        }

        let pHalf = 0;
        if (pHalfPick !== null) {
          pHalf = pHalfPick === winnerHalf ? 2 : 0;
        }

        // Clean sheet calculations
        const cleanSheetHappened = (homeScore === 0 || awayScore === 0) ? 'yes' : 'no';
        let pCleanSheet = 0;
        if (pCleanPick !== null) {
          pCleanSheet = pCleanPick === cleanSheetHappened ? 1 : 0;
        }

        const totalPoints = pWinner + pOu + pUnderdog + pTotalCardsEarned + pFirstScorerEarned + (pScore * 4) + pHalf + pCleanSheet;
        
        await env.db.prepare(`
          UPDATE predictions 
          SET 
            points_winner = ?,
            points_ou = ?,
            points_score = ?,
            points_cards_ou = ?,
            points_total_cards = ?,
            points_first_scorer = ?,
            points_highest_scoring_half = ?,
            points_clean_sheet = ?,
            total_points = ?
          WHERE participant_id = ? AND match_id = ?
        `).bind(pWinner, pOu, pScore, pUnderdog, pTotalCardsEarned, pFirstScorerEarned, pHalf, pCleanSheet, totalPoints, participantId, matchId).run();
      }

      const savedPrediction = await env.db.prepare('SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?')
        .bind(participantId, matchId)
        .first();

      // ── Signal Group Notification (fire-and-forget) ──
      // Never blocks or fails the save — if Signal is down, we just log and move on
      if (env.SIGNAL_API_URL && env.SIGNAL_SENDER && env.SIGNAL_GROUP_ID) {
        try {
          // Look up participant name and match details
          const participant = await env.db.prepare('SELECT name FROM participants WHERE id = ?').bind(participantId).first();
          const matchInfo = await env.db.prepare('SELECT home_team_name, away_team_name, local_date, over_under_line FROM matches WHERE id = ?').bind(matchId).first();

          if (participant && matchInfo) {
            const pName = participant.name;
            const home = matchInfo.home_team_name || 'Home';
            const away = matchInfo.away_team_name || 'Away';

            // Format the winner display
            const winnerDisplay = predictedWinner === 'home' ? home
              : predictedWinner === 'away' ? away
              : 'Draw';

            // Format first scorer display
            const firstDisplay = pFirstScorer === 'home' ? home
              : pFirstScorer === 'away' ? away
              : 'No Goal';

            // Format half display
            const halfDisplay = pHalfPick === 'first' ? '1st Half'
              : pHalfPick === 'second' ? '2nd Half'
              : 'Equal';

            // Format O/U display
            const ouDisplay = `${(predictedOverUnder || '').charAt(0).toUpperCase()}${(predictedOverUnder || '').slice(1)} ${matchInfo.over_under_line || '2.5'}`;

            const msg = [
              `🎯 ${pName} placed a pick!`,
              `🏟️ ${home} vs ${away}`,
              `━━━━━━━━━━━━━━━━━━`,
              `Winner: ${winnerDisplay}`,
              `Score: ${pHomeScore ?? '?'}-${pAwayScore ?? '?'} | O/U: ${ouDisplay}`,
              `Cards: ${pTotalCards ?? '?'} | First: ${firstDisplay}`,
              `Half: ${halfDisplay} | Clean Sheet: ${(pCleanPick || '?').toUpperCase()}`,
            ].join('\n');

            // Fire-and-forget — don't await in the critical path
            fetch(`${env.SIGNAL_API_URL}/v2/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: msg,
                number: env.SIGNAL_SENDER,
                recipients: [env.SIGNAL_GROUP_ID]
              })
            }).catch(err => {
              console.error('Signal notification failed (non-blocking):', err.message);
            });
          }
        } catch (signalErr) {
          console.error('Signal notification error (non-blocking):', signalErr.message);
        }
      }

      return new Response(JSON.stringify({ success: true, prediction: savedPrediction }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
