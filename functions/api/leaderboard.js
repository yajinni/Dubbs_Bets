// Cloudflare Pages Functions: API route to retrieve leaderboard standings
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
  const { env } = context;

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    const query = `
      SELECT 
        p.id,
        p.name,
        COALESCE(SUM(pred.total_points), 0) AS total_points,
        COALESCE(SUM(CASE WHEN pred.points_winner > 0 THEN 1 ELSE 0 END), 0) AS correct_winners,
        COALESCE(SUM(CASE WHEN pred.points_ou > 0 THEN 1 ELSE 0 END), 0) AS correct_ou,
        COALESCE(SUM(CASE WHEN pred.points_score > 0 THEN 1 ELSE 0 END), 0) AS correct_scores,
        COALESCE(SUM(CASE WHEN pred.points_first_scorer > 0 THEN 1 ELSE 0 END), 0) AS correct_first_scorer,
        COALESCE(SUM(CASE WHEN pred.points_total_cards > 0 THEN 1 ELSE 0 END), 0) AS correct_total_cards,
        COALESCE(SUM(CASE WHEN pred.points_highest_scoring_half > 0 THEN 1 ELSE 0 END), 0) AS correct_highest_scoring_half,
        COALESCE(SUM(CASE WHEN pred.points_clean_sheet > 0 THEN 1 ELSE 0 END), 0) AS correct_clean_sheet,
        SUM(
          CASE WHEN m.finished = 1 THEN
            (CASE WHEN pred.points_winner > 0 THEN 1 ELSE 0 END) +
            (CASE WHEN pred.points_ou > 0 THEN 1 ELSE 0 END) +
            (CASE WHEN pred.points_score > 0 THEN 1 ELSE 0 END) +
            (CASE WHEN pred.points_first_scorer > 0 THEN 1 ELSE 0 END) +
            (CASE WHEN pred.points_total_cards > 0 THEN 1 ELSE 0 END) +
            (CASE WHEN pred.points_highest_scoring_half > 0 THEN 1 ELSE 0 END) +
            (CASE WHEN pred.points_clean_sheet > 0 THEN 1 ELSE 0 END)
          ELSE 0 END
        ) AS correct_bets_count,
        SUM(
          CASE WHEN m.finished = 1 THEN
            (CASE WHEN pred.predicted_winner IS NOT NULL AND pred.predicted_winner != '' THEN 1 ELSE 0 END) +
            (CASE WHEN pred.predicted_over_under IS NOT NULL AND pred.predicted_over_under != '' THEN 1 ELSE 0 END) +
            (CASE WHEN pred.predicted_home_score IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN pred.predicted_first_scorer IS NOT NULL AND pred.predicted_first_scorer != '' THEN 1 ELSE 0 END) +
            (CASE WHEN pred.predicted_total_cards IS NOT NULL THEN 1 ELSE 0 END) +
            (CASE WHEN pred.predicted_highest_scoring_half IS NOT NULL AND pred.predicted_highest_scoring_half != '' THEN 1 ELSE 0 END) +
            (CASE WHEN pred.predicted_clean_sheet IS NOT NULL AND pred.predicted_clean_sheet != '' THEN 1 ELSE 0 END)
          ELSE 0 END
        ) AS total_bets_count
      FROM participants p
      LEFT JOIN predictions pred ON p.id = pred.participant_id
      LEFT JOIN matches m ON pred.match_id = m.id
      GROUP BY p.id, p.name
      ORDER BY total_points DESC, correct_scores DESC, correct_winners DESC, p.name ASC
    `;

    const { results } = await env.db.prepare(query).all();

    return new Response(JSON.stringify(results), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
