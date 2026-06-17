// Cloudflare Pages Functions: API route to retrieve leaderboard standings
import { checkAndInitDb, recomputeLeaderboardCache } from './db_helper.js';

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

    // Recompute cache if empty (e.g. first deploy, or cache not primed yet)
    if (!results || results.length === 0) {
      await recomputeLeaderboardCache(env.db);
      const refetch = await env.db.prepare(`
        SELECT * FROM leaderboard_cache
        ORDER BY total_points DESC, correct_scores DESC, correct_winners DESC, name ASC
        LIMIT 100
      `).all();
      results = refetch.results || [];
    }

    return new Response(JSON.stringify(results), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
