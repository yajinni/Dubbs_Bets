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

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    const keys = ['version_matches', 'version_predictions', 'version_leaderboard', 'version_stats'];
    const rows = await env.db.prepare(
      `SELECT key, value FROM settings WHERE key IN ('version_matches', 'version_predictions', 'version_leaderboard', 'version_stats')`
    ).all();

    const versions = {};
    const missingKeys = [];

    for (const key of keys) {
      const row = (rows.results || []).find(r => r.key === key);
      if (row) {
        versions[key.replace('version_', '')] = row.value;
      } else {
        const defaultTime = new Date().toISOString();
        versions[key.replace('version_', '')] = defaultTime;
        missingKeys.push(key);
      }
    }

    // Initialize missing keys in DB
    if (missingKeys.length > 0) {
      const stmt = env.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
      const batch = missingKeys.map(k => stmt.bind(k, versions[k.replace('version_', '')]));
      await env.db.batch(batch);
    }

    const counts = await env.db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) as live,
        SUM(CASE WHEN finished = 1 THEN 1 ELSE 0 END) as finished,
        SUM(CASE WHEN status = 'scheduled' AND finished = 0 THEN 1 ELSE 0 END) as scheduled
      FROM matches
    `).first();
    versions.matchCounts = counts || { live: 0, finished: 0, scheduled: 0 };

    return new Response(JSON.stringify(versions), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
