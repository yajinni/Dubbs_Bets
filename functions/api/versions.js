import { checkAndInitDb, getVersionsCache, setVersionsCache } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
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

    const cached = getVersionsCache();
    if (cached) {
      return new Response(JSON.stringify(cached), { status: 200, headers });
    }

    const keys = ['version_matches', 'version_predictions', 'version_leaderboard', 'version_stats'];
    const row = await env.db.prepare(`
      SELECT
        (SELECT value FROM settings WHERE key = 'version_matches') AS matches,
        (SELECT value FROM settings WHERE key = 'version_predictions') AS predictions,
        (SELECT value FROM settings WHERE key = 'version_leaderboard') AS leaderboard,
        (SELECT value FROM settings WHERE key = 'version_stats') AS stats,
        (SELECT value FROM settings WHERE key = 'cached_match_counts') AS match_counts
    `).first();

    const versions = {};
    const missingKeys = [];

    for (const key of keys) {
      const shortKey = key.replace('version_', '');
      if (row?.[shortKey]) {
        versions[shortKey] = row[shortKey];
      } else {
        const defaultTime = new Date().toISOString();
        versions[shortKey] = defaultTime;
        missingKeys.push(key);
      }
    }

    // Initialize missing keys in DB
    if (missingKeys.length > 0) {
      const stmt = env.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
      const batch = missingKeys.map(k => stmt.bind(k, versions[k.replace('version_', '')]));
      await env.db.batch(batch);
    }

    let matchCounts = { live: 0, finished: 0, scheduled: 0 };
    if (row?.match_counts) {
      try { matchCounts = JSON.parse(row.match_counts); } catch (_) {}
    }
    versions.matchCounts = matchCounts;

    setVersionsCache(versions);

    return new Response(JSON.stringify(versions), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
