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

    let { results } = await env.db.prepare(`
      SELECT * FROM leaderboard_cache
      ORDER BY total_points DESC, correct_scores DESC, correct_winners DESC, name ASC
      LIMIT 100
    `).all();

    // Fallback to participants table if cache is empty (e.g. no matches scored yet)
    if (!results || results.length === 0) {
      results = await env.db.prepare(`
        SELECT id, name, 0 AS total_points, 0 AS correct_winners, 0 AS correct_ou,
               0 AS correct_scores, 0 AS correct_first_scorer, 0 AS correct_total_cards,
               0 AS correct_highest_scoring_half, 0 AS correct_clean_sheet,
               0 AS correct_bets_count, 0 AS total_bets_count
        FROM participants ORDER BY name ASC
      `).all();
      results = results.results || [];
    }

    return new Response(JSON.stringify(results), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
