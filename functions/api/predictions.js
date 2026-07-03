// Cloudflare Pages Functions: API route to retrieve and submit predictions (GET, POST)
import { checkAndInitDb, logChange, emitEvent, bumpVersion, recomputeAllCaches, calculatePointsFromPrediction, flushLogs } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Validation helpers
function isPositiveIntegerId(v) {
  if (v === undefined || v === null) return false;
  const n = parseInt(v);
  return Number.isInteger(n) && n > 0;
}

function isNonNegativeInteger(v) {
  if (v === null || v === undefined) return true;
  const n = parseInt(v);
  return Number.isInteger(n) && n >= 0;
}

function isEnumValue(v, allowed) {
  return allowed.includes(v);
}

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
          SELECT 
            p.id AS participant_id,
            p.name AS participant_name,
            pr.participant_id AS id,
            pr.match_id,
            pr.predicted_winner,
            pr.predicted_over_under,
            pr.predicted_home_score,
            pr.predicted_away_score,
            pr.predicted_total_cards,
            pr.predicted_first_scorer,
            pr.predicted_highest_scoring_half,
            pr.predicted_clean_sheet,
            pr.predicted_penalties,
            COALESCE(pr.total_points, 0) AS total_points,
            COALESCE(pr.points_winner, 0) AS points_winner,
            COALESCE(pr.points_ou, 0) AS points_ou,
            COALESCE(pr.points_score, 0) AS points_score,
            COALESCE(pr.points_first_scorer, 0) AS points_first_scorer,
            COALESCE(pr.points_total_cards, 0) AS points_total_cards,
            COALESCE(pr.points_highest_scoring_half, 0) AS points_highest_scoring_half,
            COALESCE(pr.points_clean_sheet, 0) AS points_clean_sheet,
            COALESCE(pr.points_penalties, 0) AS points_penalties,
            COALESCE(pr.points_cards_ou, 0) AS points_cards_ou
          FROM participants p
          LEFT JOIN predictions pr ON pr.participant_id = p.id AND pr.match_id = ?
        `).bind(parseInt(matchIdParam)).all();

        const runningPointsSetting = await env.db.prepare("SELECT value FROM settings WHERE key = 'cached_running_points'").first();
        let runningPointsMap = {};
        if (runningPointsSetting && runningPointsSetting.value) {
          try {
            const parsed = JSON.parse(runningPointsSetting.value);
            if (parsed && typeof parsed === 'object') {
              runningPointsMap = parsed;
            }
          } catch (e) {
            console.error('Failed to parse cached_running_points:', e);
          }
        }

        const mappedResults = results.map(row => ({
          ...row,
          running_total: runningPointsMap[`${row.participant_id}_${matchIdParam}`] || 0
        }));

        return new Response(JSON.stringify(mappedResults), { status: 200, headers });
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
        predictedWinner,
        predictedOverUnder,
        predictedHomeScore, 
        predictedAwayScore,
        predictedTotalCards,
        predictedFirstScorer,
        predictedHighestScoringHalf,
        predictedCleanSheet,
        predictedPenalties
      } = body;

      // Strict input validation
      if (!isPositiveIntegerId(participantId)) {
        return new Response(JSON.stringify({ error: 'Invalid participantId: must be a positive integer' }), { status: 400, headers });
      }
      if (!isPositiveIntegerId(matchId)) {
        return new Response(JSON.stringify({ error: 'Invalid matchId: must be a positive integer' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedWinner, ['home', 'away', 'draw'])) {
        return new Response(JSON.stringify({ error: 'Invalid predictedWinner: must be home, away, or draw' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedOverUnder, ['over', 'under'])) {
        return new Response(JSON.stringify({ error: 'Invalid predictedOverUnder: must be over or under' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(predictedHomeScore)) {
        return new Response(JSON.stringify({ error: 'Invalid predictedHomeScore: must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(predictedAwayScore)) {
        return new Response(JSON.stringify({ error: 'Invalid predictedAwayScore: must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(predictedTotalCards)) {
        return new Response(JSON.stringify({ error: 'Invalid predictedTotalCards: must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedFirstScorer, ['home', 'away', 'none'])) {
        return new Response(JSON.stringify({ error: 'Invalid predictedFirstScorer: must be home, away, or none' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedHighestScoringHalf, ['first', 'second', 'equal'])) {
        return new Response(JSON.stringify({ error: 'Invalid predictedHighestScoringHalf: must be first, second, or equal' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedCleanSheet, ['yes', 'no'])) {
        return new Response(JSON.stringify({ error: 'Invalid predictedCleanSheet: must be yes or no' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedPenalties, ['yes', 'no'])) {
        return new Response(JSON.stringify({ error: 'Invalid predictedPenalties: must be yes or no' }), { status: 400, headers });
      }

      // Check participant exists
      const participant = await env.db.prepare('SELECT name FROM participants WHERE id = ?').bind(parseInt(participantId)).first();
      if (!participant) {
        return new Response(JSON.stringify({ error: 'Participant not found' }), { status: 404, headers });
      }
      const participantName = participant.name;

      // Fetch match with team info
      const match = await env.db.prepare(`
        SELECT m.local_date, m.status, m.finished, m.home_score, m.away_score, m.home_ht_score, m.away_ht_score, m.over_under_line, m.actual_cards, m.actual_first_scorer, m.actual_penalties, m.home_win_pct, m.away_win_pct, m.home_team_name, m.away_team_name, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(parseInt(matchId)).first();

      if (!match) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      // Early lock check for user-friendly error
      const matchStartTime = new Date(match.local_date).getTime();
      const currentTime = Date.now();

      if (currentTime >= matchStartTime || match.status !== 'scheduled' || match.finished === 1) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      // Parse validated inputs
      const pHomeScore = predictedHomeScore !== null && predictedHomeScore !== undefined ? parseInt(predictedHomeScore) : null;
      const pAwayScore = predictedAwayScore !== null && predictedAwayScore !== undefined ? parseInt(predictedAwayScore) : null;
      const pTotalCards = (predictedTotalCards !== null && predictedTotalCards !== undefined && predictedTotalCards !== '') ? parseInt(predictedTotalCards) : null;
      const pFirstScorer = predictedFirstScorer || null;
      const pHalfPick = predictedHighestScoringHalf || null;
      const pCleanPick = predictedCleanSheet || null;
      const pPenalties = predictedPenalties || null;

      const homeCode = match?.home_code || match?.home_team_name.substring(0, 3).toUpperCase() || 'HOM';
      const awayCode = match?.away_code || match?.away_team_name.substring(0, 3).toUpperCase() || 'AWA';
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // Conditional write: INSERT ... SELECT ... WHERE EXISTS to prevent race conditions
      const nowIso = new Date().toISOString();
      const conditionalUpsert = `
        INSERT INTO predictions (
          participant_id, match_id, predicted_winner, predicted_over_under,
          predicted_home_score, predicted_away_score, predicted_total_cards,
          predicted_first_scorer, predicted_highest_scoring_half,
          predicted_clean_sheet, predicted_penalties
        ) 
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM matches
          WHERE id = ?
            AND status = 'scheduled'
            AND finished = 0
            AND datetime(local_date) > datetime(?)
        )
        ON CONFLICT (participant_id, match_id) DO UPDATE SET
          predicted_winner = excluded.predicted_winner,
          predicted_over_under = excluded.predicted_over_under,
          predicted_home_score = excluded.predicted_home_score,
          predicted_away_score = excluded.predicted_away_score,
          predicted_total_cards = excluded.predicted_total_cards,
          predicted_first_scorer = excluded.predicted_first_scorer,
          predicted_highest_scoring_half = excluded.predicted_highest_scoring_half,
          predicted_clean_sheet = excluded.predicted_clean_sheet,
          predicted_penalties = excluded.predicted_penalties
      `;

      const result = await env.db.prepare(conditionalUpsert)
        .bind(
          parseInt(participantId), parseInt(matchId),
          predictedWinner, predictedOverUnder,
          pHomeScore, pAwayScore, pTotalCards,
          pFirstScorer, pHalfPick, pCleanPick, pPenalties,
          parseInt(matchId), nowIso
        )
        .run();

      if (!result.meta?.changes || result.meta.changes === 0) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      // Log changes only after successful conditional write
      let actionType = 'submitted';
      const changes = [];

      const existingBefore = await env.db.prepare('SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?').bind(parseInt(participantId), parseInt(matchId)).first();
      if (existingBefore && existingBefore.predicted_winner !== predictedWinner) {
        // But this is the same row we just upserted, so check the pre-existing values
      }
      
      // Since we get `meta.changes > 0`, we know the write succeeded. Log generically.
      if (existingBefore) {
        actionType = 'updated';
        // Compute specific changes for log
        if (existingBefore.predicted_winner !== predictedWinner) changes.push(`Winner: ${existingBefore.predicted_winner || 'None'} -> ${predictedWinner}`);
        if (existingBefore.predicted_over_under !== predictedOverUnder) changes.push(`O/U: ${existingBefore.predicted_over_under || 'None'} -> ${predictedOverUnder}`);
        const oldScore = existingBefore.predicted_home_score !== null ? `${existingBefore.predicted_home_score}-${existingBefore.predicted_away_score}` : null;
        const newScore = pHomeScore !== null ? `${pHomeScore}-${pAwayScore}` : null;
        if (oldScore !== newScore) changes.push(`Score: ${oldScore || 'None'} -> ${newScore}`);
        if (existingBefore.predicted_total_cards !== pTotalCards) changes.push(`Cards: ${existingBefore.predicted_total_cards === null ? 'None' : existingBefore.predicted_total_cards} -> ${pTotalCards === null ? 'None' : pTotalCards}`);
        if (existingBefore.predicted_first_scorer !== pFirstScorer) changes.push(`First Scorer: ${existingBefore.predicted_first_scorer || 'None'} -> ${pFirstScorer || 'None'}`);
        if (existingBefore.predicted_highest_scoring_half !== pHalfPick) changes.push(`Highest Scoring Half: ${existingBefore.predicted_highest_scoring_half || 'None'} -> ${pHalfPick || 'None'}`);
        if (existingBefore.predicted_clean_sheet !== pCleanPick) changes.push(`Clean Sheet: ${existingBefore.predicted_clean_sheet || 'None'} -> ${pCleanPick || 'None'}`);
        if (existingBefore.predicted_penalties !== pPenalties) changes.push(`Penalties: ${existingBefore.predicted_penalties || 'None'} -> ${pPenalties || 'None'}`);
      }

      if (changes.length > 0 || !existingBefore) {
        const description = `${participantName} ${actionType} prediction for ${matchLabel}`;
        const oldValue = existingBefore ? 'Existing prediction' : 'None';
        const newValue = existingBefore ? changes.join(', ') : `Winner: ${predictedWinner}, O/U: ${predictedOverUnder}, Score: ${pHomeScore}-${pAwayScore}`;
        await logChange(env.db, 'prediction', parseInt(matchId), parseInt(participantId), description, oldValue, newValue);
      }

      await bumpVersion(env.db, 'predictions');

      // Immediately calculate points for this prediction if the match is already finished
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
          predicted_penalties: pPenalties,
        }, match);

        await env.db.prepare(`
          UPDATE predictions
          SET
            points_winner = ?, points_ou = ?, points_score = ?, points_cards_ou = ?,
            points_total_cards = ?, points_first_scorer = ?, points_highest_scoring_half = ?,
            points_clean_sheet = ?, points_penalties = ?, total_points = ?
          WHERE participant_id = ? AND match_id = ?
        `).bind(
          pts.points_winner, pts.points_ou, pts.points_score, pts.points_cards_ou,
          pts.points_total_cards, pts.points_first_scorer, pts.points_highest_scoring_half,
          pts.points_clean_sheet, pts.points_penalties, pts.total_points,
          parseInt(participantId), parseInt(matchId)
        ).run();

        await recomputeAllCaches(env.db);
      }

      await emitEvent(env.db, 'predictions_updated');
      await flushLogs(env.db);

      return new Response(JSON.stringify({
        success: true,
        prediction: {
          participant_id: parseInt(participantId),
          match_id: parseInt(matchId),
          predicted_winner: predictedWinner,
          predicted_over_under: predictedOverUnder,
          predicted_home_score: pHomeScore,
          predicted_away_score: pAwayScore,
          predicted_total_cards: pTotalCards,
          predicted_first_scorer: pFirstScorer,
          predicted_highest_scoring_half: pHalfPick,
          predicted_clean_sheet: pCleanPick,
          predicted_penalties: pPenalties,
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
