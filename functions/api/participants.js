// Cloudflare Pages Functions: API route to manage participants (GET, POST, DELETE)
import { checkAndInitDb, emitEvent, recomputeAllCaches } from './db_helper.js';

// CORS headers
const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
      const { results } = await env.db.prepare('SELECT * FROM participants ORDER BY name ASC').all();
      return new Response(JSON.stringify(results), { status: 200, headers });
    }

    if (method === 'POST') {
      const body = await request.json();
      const { name } = body;

      if (!name || name.trim() === '') {
        return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400, headers });
      }

      const cleanName = name.trim();
      
      try {
        await env.db.prepare('INSERT INTO participants (name) VALUES (?)').bind(cleanName).run();
        await recomputeAllCaches(env.db);
        await emitEvent(env.db, 'participants_updated');
        const newParticipant = await env.db.prepare('SELECT * FROM participants WHERE name = ?').bind(cleanName).first();
        return new Response(JSON.stringify(newParticipant), { status: 201, headers });
      } catch (err) {
        if (err.message.includes('UNIQUE') || err.message.includes('constraint')) {
          return new Response(JSON.stringify({ error: 'Participant name already exists' }), { status: 409, headers });
        }
        throw err;
      }
    }

    if (method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');

      if (!id) {
        return new Response(JSON.stringify({ error: 'ID is required' }), { status: 400, headers });
      }

      const res = await env.db.prepare('DELETE FROM participants WHERE id = ?').bind(parseInt(id)).run();
      await recomputeAllCaches(env.db);
      await emitEvent(env.db, 'participants_updated');
      return new Response(JSON.stringify({ success: true, changes: res.meta.changes }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
