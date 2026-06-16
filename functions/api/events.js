import { checkAndInitDb } from './db_helper.js';

const headers = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID' } });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.db) {
    return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  await checkAndInitDb(env.db);

  const lastEventId = parseInt(new URL(request.url).searchParams.get('cursor') || request.headers.get('Last-Event-ID') || '0');

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  let closed = false;
  const closeStream = () => { if (!closed) { closed = true; writer.close().catch(() => {}); } };

  request.signal.addEventListener('abort', closeStream);

  const send = (data, eventId) => {
    if (!closed) {
      let msg = '';
      if (eventId !== undefined) msg += `id: ${eventId}\n`;
      msg += `data: ${JSON.stringify(data)}\n\n`;
      writer.write(encoder.encode(msg)).catch(closeStream);
    }
  };

  const POLL_INTERVAL_MS = 2000;
  const MAX_RUN_MS = 25000;
  const startTime = Date.now();
  let cursor = lastEventId;

  (async () => {
    while (!closed && Date.now() - startTime < MAX_RUN_MS) {
      try {
        const { results } = await env.db.prepare(
          "SELECT id, type, created_at FROM events WHERE id > ? ORDER BY id ASC LIMIT 50"
        ).bind(cursor).all();

        if (results && results.length > 0) {
          for (const row of results) {
            send({ type: row.type, created_at: row.created_at }, row.id);
            cursor = Math.max(cursor, row.id);
          }
          // Clean up delivered events
          env.db.prepare("DELETE FROM events WHERE id <= ?").bind(cursor).run().catch(() => {});
        }
      } catch (e) {
        console.error('SSE poll error:', e);
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    send({ type: 'done', cursor });
    closeStream();
  })();

  return new Response(readable, { headers });
}
