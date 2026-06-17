import { checkAndInitDb, recomputeLeaderboardCache, recomputeStatsCache, scoreAllPredictionsForMatch, flushLogs } from './db_helper.js';

export async function onRequest(context) {
  const { env } = context;
  try {
    await checkAndInitDb(env.db);

    const { results: matches } = await env.db.prepare('SELECT * FROM matches WHERE finished = 1').all();
    let updatedPredictionsCount = 0;

    for (const m of matches) {
      const count = await scoreAllPredictionsForMatch(env.db, m.id, m);
      updatedPredictionsCount += count;
    }

    await recomputeLeaderboardCache(env.db);
    await recomputeStatsCache(env.db);
    await flushLogs(env.db);

    return new Response(JSON.stringify({ success: true, message: `Successfully updated ${updatedPredictionsCount} predictions.` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    await flushLogs(env.db);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
