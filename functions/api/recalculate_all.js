import { checkAndInitDb, recomputeAllCaches, scoreAllPredictionsForMatch, flushLogs } from './db_helper.js';
import { getSyncSecretAuthError } from './auth.js';

const headers = { 'Content-Type': 'application/json' };

export async function onRequest(context) {
  const { request, env } = context;
  try {
    const authError = getSyncSecretAuthError(request, env);
    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), { status: authError.status, headers });
    }

    await checkAndInitDb(env.db);

    const { results: matches } = await env.db.prepare('SELECT * FROM matches WHERE finished = 1').all();
    let updatedPredictionsCount = 0;

    for (const m of matches) {
      const count = await scoreAllPredictionsForMatch(env.db, m.id, m);
      updatedPredictionsCount += count;
    }

    await recomputeAllCaches(env.db);
    await flushLogs(env.db);

    return new Response(JSON.stringify({ success: true, message: `Successfully updated ${updatedPredictionsCount} predictions.` }), {
      status: 200,
      headers
    });
  } catch (error) {
    await flushLogs(env.db);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers
    });
  }
}
