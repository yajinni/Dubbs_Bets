// Cloudflare Pages Functions: /api/preferences
// GET  ?participantId=N  → returns { nav_layout: "..." }
// POST { participantId, navLayout: [...] } → saves to DB
import { checkAndInitDb, emitEvent } from './db_helper.js';

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

    // Ensure nav_layout column exists (safe migration — ignored if already there)
    try {
      await env.db.prepare('ALTER TABLE participants ADD COLUMN nav_layout TEXT DEFAULT NULL').run();
    } catch (_) { /* already exists */ }

    if (method === 'GET') {
      const url = new URL(request.url);
      const participantId = url.searchParams.get('participantId');

      if (!participantId) {
        return new Response(JSON.stringify({ error: 'participantId is required' }), { status: 400, headers });
      }

      const row = await env.db
        .prepare('SELECT nav_layout FROM participants WHERE id = ?')
        .bind(parseInt(participantId))
        .first();

      if (!row) {
        return new Response(JSON.stringify({ error: 'Participant not found' }), { status: 404, headers });
      }

      return new Response(
        JSON.stringify({ nav_layout: row.nav_layout || null }),
        { status: 200, headers }
      );
    }

    if (method === 'POST') {
      const body = await request.json();
      const { participantId, navLayout } = body;

      if (!participantId) {
        return new Response(JSON.stringify({ error: 'participantId is required' }), { status: 400, headers });
      }

      const serialized = navLayout ? JSON.stringify(navLayout) : null;

      await env.db
        .prepare('UPDATE participants SET nav_layout = ? WHERE id = ?')
        .bind(serialized, parseInt(participantId))
        .run();
      await emitEvent(env.db, 'preferences_updated');
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
