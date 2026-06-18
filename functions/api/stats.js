import { checkAndInitDb, recomputeStatsCache } from './db_helper.js';

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

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    // Fetch the precalculated stats payload from cache
    let cachedStatsRow = await env.db.prepare("SELECT value FROM settings WHERE key = 'cached_stats_payload'").first();

    if (!cachedStatsRow || !cachedStatsRow.value) {
      // Recompute stats cache if missing (e.g. first run)
      await recomputeStatsCache(env.db);
      cachedStatsRow = await env.db.prepare("SELECT value FROM settings WHERE key = 'cached_stats_payload'").first();
    }

    if (!cachedStatsRow || !cachedStatsRow.value) {
      return new Response(JSON.stringify({ error: 'Stats payload not cached and failed to recompute.' }), { status: 500, headers });
    }

    return new Response(cachedStatsRow.value, { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}