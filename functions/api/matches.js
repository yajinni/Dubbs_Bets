// Cloudflare Pages Functions: API route to retrieve and update matches (GET, POST)
import { checkAndInitDb } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
      // Get all matches with home/away team flags
      const query = `
        SELECT 
          m.*,
          t1.flag AS home_flag,
          t1.fifa_code AS home_code,
          t2.flag AS away_flag,
          t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        ORDER BY m.local_date ASC
      `;
      
      const { results } = await env.db.prepare(query).all();
      return new Response(JSON.stringify(results), { status: 200, headers });
    }

    if (method === 'POST') {
      // Admin update of match details (scores, odds, status)
      const body = await request.json();
      const { 
        password,
        matchId, 
        homeScore, 
        awayScore, 
        status, 
        finished,
        homeWinPct,
        awayWinPct,
        drawWinPct,
        overUnderLine,
        overOdds,
        underOdds
      } = body;

      // Validate Admin Password
      const adminPassSetting = await env.db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").first();
      const expectedPassword = adminPassSetting ? adminPassSetting.value : 'admin123';

      if (password !== expectedPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Password' }), { status: 401, headers });
      }

      if (!matchId) {
        return new Response(JSON.stringify({ error: 'Match ID is required' }), { status: 400, headers });
      }

      // Convert variables to correct SQL types
      const hScore = homeScore !== undefined ? parseInt(homeScore) : 0;
      const aScore = awayScore !== undefined ? parseInt(awayScore) : 0;
      const finishedVal = finished ? 1 : 0;
      const hPct = homeWinPct !== undefined ? parseFloat(homeWinPct) : 33.3;
      const aPct = awayWinPct !== undefined ? parseFloat(awayWinPct) : 33.3;
      const dPct = drawWinPct !== undefined ? parseFloat(drawWinPct) : 33.3;
      const ouLine = overUnderLine !== undefined ? parseFloat(overUnderLine) : 2.5;
      const oOdds = overOdds !== undefined ? parseFloat(overOdds) : 1.9;
      const uOdds = underOdds !== undefined ? parseFloat(underOdds) : 1.9;

      const updateQuery = `
        UPDATE matches 
        SET 
          home_score = ?,
          away_score = ?,
          status = ?,
          finished = ?,
          home_win_pct = ?,
          away_win_pct = ?,
          draw_pct = ?,
          over_under_line = ?,
          over_odds = ?,
          under_odds = ?
        WHERE id = ?
      `;

      await env.db.prepare(updateQuery)
        .bind(hScore, aScore, status || 'scheduled', finishedVal, hPct, aPct, dPct, ouLine, oOdds, uOdds, matchId)
        .run();

      // If finished, we want to recalculate predictions/points for this match
      if (finishedVal === 1) {
        await recalculateMatchPredictions(env.db, matchId, hScore, aScore, ouLine);
      }

      const updatedMatch = await env.db.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first();
      return new Response(JSON.stringify({ success: true, match: updatedMatch }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

// Recalculates and stores point awards for a completed match
async function recalculateMatchPredictions(db, matchId, homeScore, awayScore, ouLine) {
  // Determine winner: 'home', 'away', or 'draw'
  let winner = 'draw';
  if (homeScore > awayScore) winner = 'home';
  else if (awayScore > homeScore) winner = 'away';

  // Determine over/under: 'over' or 'under'
  const totalGoals = homeScore + awayScore;
  const ouResult = totalGoals > ouLine ? 'over' : 'under';

  // Get all predictions for this match
  const { results: predictions } = await db.prepare('SELECT * FROM predictions WHERE match_id = ?').bind(matchId).all();

  for (const pred of predictions) {
    const pWinner = pred.predicted_winner === winner ? 1 : 0;
    const pOu = pred.predicted_over_under === ouResult ? 1 : 0;
    const pScore = (pred.predicted_home_score === homeScore && pred.predicted_away_score === awayScore) ? 1 : 0;
    const totalPoints = pWinner + pOu + pScore;

    await db.prepare(`
      UPDATE predictions 
      SET 
        points_winner = ?,
        points_ou = ?,
        points_score = ?,
        total_points = ?
      WHERE participant_id = ? AND match_id = ?
    `).bind(pWinner, pOu, pScore, totalPoints, pred.participant_id, matchId).run();
  }
}
