// Cloudflare Pages Functions: API route to retrieve and submit predictions (GET, POST)
import { checkAndInitDb } from './db_helper.js';

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
        predictedAwayScore 
      } = body;

      if (!participantId || !matchId) {
        return new Response(JSON.stringify({ error: 'Participant ID and Match ID are required' }), { status: 400, headers });
      }

      // 1. Fetch match to verify it exists and check if it has already started
      const match = await env.db.prepare('SELECT local_date, status, finished FROM matches WHERE id = ?').bind(matchId).first();

      if (!match) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      // 2. Lock prediction if match has started
      const matchStartTime = new Date(match.local_date).getTime();
      const currentTime = Date.now();

      if (matchId !== 999 && (currentTime >= matchStartTime || match.status !== 'scheduled' || match.finished === 1)) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      // Validate inputs
      const pHomeScore = predictedHomeScore !== null && predictedHomeScore !== undefined ? parseInt(predictedHomeScore) : null;
      const pAwayScore = predictedAwayScore !== null && predictedAwayScore !== undefined ? parseInt(predictedAwayScore) : null;

      // 3. Upsert prediction
      const checkQuery = 'SELECT 1 FROM predictions WHERE participant_id = ? AND match_id = ?';
      const existing = await env.db.prepare(checkQuery).bind(participantId, matchId).first();

      if (existing) {
        const updateQuery = `
          UPDATE predictions 
          SET 
            predicted_winner = ?, 
            predicted_over_under = ?, 
            predicted_home_score = ?, 
            predicted_away_score = ?
          WHERE participant_id = ? AND match_id = ?
        `;
        await env.db.prepare(updateQuery)
          .bind(predictedWinner, predictedOverUnder, pHomeScore, pAwayScore, participantId, matchId)
          .run();
      } else {
        const insertQuery = `
          INSERT INTO predictions (
            participant_id, 
            match_id, 
            predicted_winner, 
            predicted_over_under, 
            predicted_home_score, 
            predicted_away_score
          ) VALUES (?, ?, ?, ?, ?, ?)
        `;
        await env.db.prepare(insertQuery)
          .bind(participantId, matchId, predictedWinner, predictedOverUnder, pHomeScore, pAwayScore)
          .run();
      }

      const savedPrediction = await env.db.prepare('SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?')
        .bind(participantId, matchId)
        .first();

      return new Response(JSON.stringify({ success: true, prediction: savedPrediction }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
