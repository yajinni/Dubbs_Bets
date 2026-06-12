// Cloudflare Pages Functions: API route to retrieve leaderboard standings
import { checkAndInitDb } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequest(context) {
  const { env } = context;

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    const query = `
      SELECT 
        p.id,
        p.name,
        COALESCE(SUM(pred.total_points), 0) AS total_points,
        COALESCE(SUM(pred.points_winner), 0) AS correct_winners,
        COALESCE(SUM(pred.points_ou), 0) AS correct_ou,
        COALESCE(SUM(pred.points_score), 0) AS correct_scores,
        COALESCE(SUM(pred.points_first_scorer), 0) AS correct_first_scorer,
        COALESCE(SUM(pred.points_total_cards), 0) AS correct_total_cards,
        COALESCE(SUM(pred.points_highest_scoring_half), 0) AS correct_highest_scoring_half,
        COALESCE(SUM(pred.points_clean_sheet), 0) AS correct_clean_sheet,
        COUNT(pred.match_id) AS predictions_count
      FROM participants p
      LEFT JOIN predictions pred ON p.id = pred.participant_id
      GROUP BY p.id, p.name
      ORDER BY total_points DESC, correct_scores DESC, correct_winners DESC, p.name ASC
    `;

    const { results } = await env.db.prepare(query).all();

    return new Response(JSON.stringify(results), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
