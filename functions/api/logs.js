// Cloudflare Pages Functions: API route to retrieve logs (GET)
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
  const { request, env } = context;
  const method = request.method;

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    if (method === 'GET') {
      // Return logs in reverse chronological order, limit to latest 500 entries
      const { results } = await env.db.prepare(`
        SELECT l.*, m.home_team_name, m.away_team_name, p.name AS participant_name
        FROM logs l
        LEFT JOIN matches m ON l.match_id = m.id
        LEFT JOIN participants p ON l.participant_id = p.id
        ORDER BY l.timestamp DESC, l.id DESC
        LIMIT 500
      `).all();

      return new Response(JSON.stringify(results), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
