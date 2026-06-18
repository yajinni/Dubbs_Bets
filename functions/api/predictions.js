// Cloudflare Pages Functions: API route to retrieve and submit predictions (GET, POST)
import { checkAndInitDb, logChange, emitEvent, bumpVersion, recomputeAllCaches, calculatePointsFromPrediction, flushLogs } from './db_helper.js';

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
      const matchIdParam = url.searchParams.get('matchId');

      if (matchIdParam) {
        const { results } = await env.db.prepare(`
          SELECT pr.*, p.name AS participant_name, COALESCE(rpc.total_points, 0) AS running_total
          FROM predictions pr
          INNER JOIN participants p ON pr.participant_id = p.id
          LEFT JOIN running_points_cache rpc ON rpc.participant_id = pr.participant_id AND rpc.match_id = pr.match_id
          WHERE pr.match_id = ?
        `).bind(parseInt(matchIdParam)).all();
        return new Response(JSON.stringify(results), { status: 200, headers });
      }

      if (!participantId) {
        // Return all predictions in system with participant names
        const { results } = await env.db.prepare(`
          SELECT pr.*, p.name AS participant_name
          FROM predictions pr
          INNER JOIN participants p ON pr.participant_id = p.id
          LIMIT 5000
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

      // 1. Fetch match with team info (merged query)
      const match = await env.db.prepare(`
        SELECT m.local_date, m.status, m.finished, m.home_score, m.away_score, m.home_ht_score, m.away_ht_score, m.over_under_line, m.actual_cards, m.actual_first_scorer, m.home_win_pct, m.away_win_pct, m.home_team_name, m.away_team_name, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchId).first();

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

      // Get participant name
      const participant = await env.db.prepare('SELECT name FROM participants WHERE id = ?').bind(participantId).first();
      const participantName = participant ? participant.name : `Player ID ${participantId}`;

      const homeCode = match?.home_code || match?.home_team_name.substring(0, 3).toUpperCase() || 'HOM';
      const awayCode = match?.away_code || match?.away_team_name.substring(0, 3).toUpperCase() || 'AWA';
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // 3. Upsert prediction
      const checkQuery = 'SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?';
      const existing = await env.db.prepare(checkQuery).bind(participantId, matchId).first();

      // Log changes
      const changes = [];
      
      const oldWinner = existing ? existing.predicted_winner : null;
      const newWinner = predictedWinner || null;
      if (oldWinner !== newWinner) {
        changes.push(`Winner: ${oldWinner || 'None'} -> ${newWinner}`);
      }

      const oldOU = existing ? existing.predicted_over_under : null;
      const newOU = predictedOverUnder || null;
      if (oldOU !== newOU) {
        changes.push(`O/U: ${oldOU || 'None'} -> ${newOU}`);
      }

      const oldHome = existing ? existing.predicted_home_score : null;
      const oldAway = existing ? existing.predicted_away_score : null;
      const oldScore = (oldHome !== null && oldAway !== null) ? `${oldHome}-${oldAway}` : null;
      const newScore = (pHomeScore !== null && pAwayScore !== null) ? `${pHomeScore}-${pAwayScore}` : null;
      if (oldScore !== newScore) {
        changes.push(`Score: ${oldScore || 'None'} -> ${newScore}`);
      }

      const oldCards = existing ? existing.predicted_total_cards : null;
      const newCards = pTotalCards;
      if (oldCards !== newCards) {
        changes.push(`Cards: ${oldCards === null ? 'None' : oldCards} -> ${newCards === null ? 'None' : newCards}`);
      }

      const oldFirstScorer = existing ? existing.predicted_first_scorer : null;
      const newFirstScorer = pFirstScorer;
      if (oldFirstScorer !== newFirstScorer) {
        changes.push(`First Scorer: ${oldFirstScorer || 'None'} -> ${newFirstScorer || 'None'}`);
      }

      const oldHalf = existing ? existing.predicted_highest_scoring_half : null;
      const newHalf = pHalfPick;
      if (oldHalf !== newHalf) {
        changes.push(`Highest Scoring Half: ${oldHalf || 'None'} -> ${newHalf || 'None'}`);
      }

      const oldClean = existing ? existing.predicted_clean_sheet : null;
      const newClean = pCleanPick;
      if (oldClean !== newClean) {
        changes.push(`Clean Sheet: ${oldClean || 'None'} -> ${newClean || 'None'}`);
      }

      if (changes.length > 0) {
        const actionType = existing ? 'updated' : 'submitted';
        const description = `${participantName} ${actionType} prediction for ${matchLabel}`;
        const oldValue = existing ? 'Existing prediction' : 'None';
        const newValue = changes.join(', ');
        await logChange(env.db, 'prediction', matchId, participantId, description, oldValue, newValue);
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

      await bumpVersion(env.db, 'predictions');

      // 4. Immediately calculate points for this prediction if the match is already finished
      if (match.finished === 1) {
        const pts = calculatePointsFromPrediction({
          predicted_winner: predictedWinner,
          predicted_over_under: predictedOverUnder,
          predicted_home_score: pHomeScore,
          predicted_away_score: pAwayScore,
          predicted_total_cards: pTotalCards,
          predicted_first_scorer: pFirstScorer,
          predicted_highest_scoring_half: pHalfPick,
          predicted_clean_sheet: pCleanPick,
        }, match);

        await env.db.prepare(`
          UPDATE predictions
          SET
            points_winner = ?, points_ou = ?, points_score = ?, points_cards_ou = ?,
            points_total_cards = ?, points_first_scorer = ?, points_highest_scoring_half = ?,
            points_clean_sheet = ?, total_points = ?
          WHERE participant_id = ? AND match_id = ?
        `).bind(
          pts.points_winner, pts.points_ou, pts.points_score, pts.points_cards_ou,
          pts.points_total_cards, pts.points_first_scorer, pts.points_highest_scoring_half,
          pts.points_clean_sheet, pts.total_points,
          participantId, matchId
        ).run();

        await recomputeAllCaches(env.db);
      }

      await emitEvent(env.db, 'predictions_updated');
      // ── Signal Group Notification (fire-and-forget, reuse already-fetched data) ──
      if (env.SIGNAL_API_URL && env.SIGNAL_SENDER && env.SIGNAL_GROUP_ID) {
        try {
          if (participant && match) {
            const pName = participant.name;
            const home = match.home_team_name || 'Home';
            const away = match.away_team_name || 'Away';

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
            const ouDisplay = `${(predictedOverUnder || '').charAt(0).toUpperCase()}${(predictedOverUnder || '').slice(1)} ${match.over_under_line || '2.5'}`;

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

      await flushLogs(env.db);
      return new Response(JSON.stringify({
        success: true,
        prediction: {
          participant_id: participantId,
          match_id: matchId,
          predicted_winner: predictedWinner,
          predicted_over_under: predictedOverUnder,
          predicted_home_score: pHomeScore,
          predicted_away_score: pAwayScore,
          predicted_total_cards: pTotalCards,
          predicted_first_scorer: pFirstScorer,
          predicted_highest_scoring_half: pHalfPick,
          predicted_clean_sheet: pCleanPick,
          points_winner: 0,
          points_ou: 0,
          points_score: 0,
          total_points: 0,
        }
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    await flushLogs(env.db);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
