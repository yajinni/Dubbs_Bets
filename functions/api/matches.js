// Cloudflare Pages Functions: API route to retrieve and update matches (GET, POST)
import { checkAndInitDb, logChange, formatOuPct, emitEvent, recomputeLeaderboardCache, recomputeStatsCache, getMatchesCache, setMatchesCache, clearMatchesCache } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
      const url = new URL(request.url);
      const liveOnly = url.searchParams.get('liveOnly') === 'true';

      if (liveOnly) {
        const { results } = await env.db.prepare(`
          SELECT id, home_score, away_score, home_ht_score, away_ht_score, status, finished, actual_cards, actual_first_scorer, home_team_name, away_team_name
          FROM matches
          WHERE status = 'live'
        `).all();
        return new Response(JSON.stringify(results), { status: 200, headers });
      }

      const cached = getMatchesCache();
      if (cached) {
        return new Response(JSON.stringify(cached), { status: 200, headers });
      }

      const { results } = await env.db.prepare(`
        SELECT 
          m.*,
          t1.flag AS home_flag,
          t1.fifa_code AS home_code,
          t2.flag AS away_flag,
          t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        ORDER BY m.local_date ASC
      `).all();
      setMatchesCache(results);
      return new Response(JSON.stringify(results), { status: 200, headers });
    }

    if (method === 'POST') {
      // Admin update of match details (scores, odds, status)
      const body = await request.json();
      const { 
        password,
        matchId, 
        homeScore, 
        awayScore, 
        homeHtScore,
        awayHtScore,
        status, 
        finished,
        homeWinPct,
        awayWinPct,
        drawWinPct,
        overUnderLine,
        overOdds,
        underOdds,
        cardsLine,
        actualCards,
        actualFirstScorer
      } = body;

      // Validate Admin Password
      const adminPassSetting = await env.db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").first();
      const expectedPassword = adminPassSetting ? adminPassSetting.value : 'admin123';

      if (password !== expectedPassword) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Password' }), { status: 401, headers });
      }

      if (!matchId) {
        return new Response(JSON.stringify({ error: 'Match ID is required' }), { status: 400, headers });
      }

      // Convert variables to correct SQL types
      const hScore = homeScore !== undefined ? parseInt(homeScore) : 0;
      const aScore = awayScore !== undefined ? parseInt(awayScore) : 0;
      const hHtScore = (homeHtScore !== undefined && homeHtScore !== null && homeHtScore !== '') ? parseInt(homeHtScore) : null;
      const aHtScore = (awayHtScore !== undefined && awayHtScore !== null && awayHtScore !== '') ? parseInt(awayHtScore) : null;
      const finishedVal = finished ? 1 : 0;
      const hPct = homeWinPct !== undefined ? parseFloat(homeWinPct) : 33.3;
      const aPct = awayWinPct !== undefined ? parseFloat(awayWinPct) : 33.3;
      const dPct = drawWinPct !== undefined ? parseFloat(drawWinPct) : 33.3;
      const ouLine = overUnderLine !== undefined ? parseFloat(overUnderLine) : 2.5;
      const oOdds = overOdds !== undefined ? parseFloat(overOdds) : 1.9;
      const uOdds = underOdds !== undefined ? parseFloat(underOdds) : 1.9;
      const cLine = cardsLine !== undefined ? parseFloat(cardsLine) : 3.5;
      const actCards = (actualCards !== undefined && actualCards !== '') ? parseInt(actualCards) : null;
      let actFirstScorer = actualFirstScorer || null;

      const oldMatch = await env.db.prepare(`
        SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchId).first();

      if (oldMatch) {
        const homeCode = oldMatch.home_code || oldMatch.home_team_name.substring(0, 3).toUpperCase();
        const awayCode = oldMatch.away_code || oldMatch.away_team_name.substring(0, 3).toUpperCase();
        const matchLabel = `${homeCode} vs ${awayCode}`;
        
        // Log Odds changes (grouped Winner probabilities)
        if (oldMatch.home_win_pct !== hPct || oldMatch.away_win_pct !== aPct || oldMatch.draw_pct !== dPct) {
          const oldVal = `H: ${oldMatch.home_win_pct}%, D: ${oldMatch.draw_pct}%, A: ${oldMatch.away_win_pct}%`;
          const newVal = `H: ${hPct}%, D: ${dPct}%, A: ${aPct}%`;
          await logChange(env.db, 'odds', matchId, null, `${matchLabel} Winner`, oldVal, newVal);
        }

        // Log O/U Goals (combined line and odds)
        if (oldMatch.over_under_line !== ouLine || oldMatch.over_odds !== oOdds || oldMatch.under_odds !== uOdds) {
          const oldVal = `Line: ${oldMatch.over_under_line}, ${formatOuPct(oldMatch.over_odds, oldMatch.under_odds)}`;
          const newVal = `Line: ${ouLine}, ${formatOuPct(oOdds, uOdds)}`;
          await logChange(env.db, 'odds', matchId, null, `${matchLabel} O/U Goals`, oldVal, newVal);
        }

        // Log O/U Score First (Cards O/U line and odds combined)
        const oldCardsOverOdds = oldMatch.cards_over_odds !== undefined ? oldMatch.cards_over_odds : 1.9;
        const oldCardsUnderOdds = oldMatch.cards_under_odds !== undefined ? oldMatch.cards_under_odds : 1.9;
        if (oldMatch.cards_line !== cLine) {
          const oldVal = `Line: ${oldMatch.cards_line}, ${formatOuPct(oldCardsOverOdds, oldCardsUnderOdds)}`;
          const newVal = `Line: ${cLine}, ${formatOuPct(1.9, 1.9)}`;
          await logChange(env.db, 'odds', matchId, null, `${matchLabel} O/U Score First`, oldVal, newVal);
        }

        // Log Score/Cards changes
        if (oldMatch.home_score !== hScore || oldMatch.away_score !== aScore) {
          await logChange(env.db, 'score', matchId, null, `${matchLabel} score`, `${oldMatch.home_score}-${oldMatch.away_score}`, `${hScore}-${aScore}`);
        }
        if (oldMatch.home_ht_score !== hHtScore || oldMatch.away_ht_score !== aHtScore) {
          const oldHt = (oldMatch.home_ht_score !== null && oldMatch.away_ht_score !== null) ? `${oldMatch.home_ht_score}-${oldMatch.away_ht_score}` : 'null';
          const newHt = (hHtScore !== null && aHtScore !== null) ? `${hHtScore}-${aHtScore}` : 'null';
          if (oldHt !== newHt) {
            await logChange(env.db, 'score', matchId, null, `${matchLabel} halftime score`, oldHt, newHt);
          }
        }
        if (oldMatch.actual_cards !== actCards) {
          await logChange(env.db, 'cards', matchId, null, `${matchLabel} actual cards`, oldMatch.actual_cards, actCards);
        }
      }

      const updateQuery = `
        UPDATE matches 
        SET 
          home_score = ?,
          away_score = ?,
          home_ht_score = ?,
          away_ht_score = ?,
          status = ?,
          finished = ?,
          home_win_pct = ?,
          away_win_pct = ?,
          draw_pct = ?,
          over_under_line = ?,
          over_odds = ?,
          under_odds = ?,
          cards_line = ?,
          actual_cards = ?,
          actual_first_scorer = ?
        WHERE id = ?
      `;

      await env.db.prepare(updateQuery)
        .bind(hScore, aScore, hHtScore, aHtScore, status || 'scheduled', finishedVal, hPct, aPct, dPct, ouLine, oOdds, uOdds, cLine, actCards, actFirstScorer, matchId)
        .run();

      clearMatchesCache();

      // If finished, we want to recalculate predictions/points for this match
      if (finishedVal === 1) {
        await recalculateMatchPredictions(env.db, matchId, hScore, aScore, ouLine, cLine, actCards, actFirstScorer, hPct, aPct, dPct, hHtScore, aHtScore);
        await recomputeLeaderboardCache(env.db);
        await recomputeStatsCache(env.db);
      }

      await emitEvent(env.db, 'matches_updated');
      const updatedMatch = await env.db.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first();
      return new Response(JSON.stringify({ success: true, match: updatedMatch }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

async function recalculateMatchPredictions(db, matchId, homeScore, awayScore, ouLine, cardsLine, actualCards, actualFirstScorer, homeWinPct, awayWinPct, drawWinPct, homeHtScore, awayHtScore) {
  // Determine winner: 'home', 'away', or 'draw'
  let winner = 'draw';
  if (homeScore > awayScore) winner = 'home';
  else if (awayScore > homeScore) winner = 'away';

  // Determine over/under: 'over' or 'under'
  const totalGoals = homeScore + awayScore;
  const ouResult = totalGoals > ouLine ? 'over' : 'under';

  // Calculate highest scoring half
  let winnerHalf = null;
  if (homeHtScore !== null && homeHtScore !== undefined && awayHtScore !== null && awayHtScore !== undefined) {
    const firstHalfGoals = homeHtScore + awayHtScore;
    const secondHalfGoals = totalGoals - firstHalfGoals;
    if (firstHalfGoals > secondHalfGoals) winnerHalf = 'first';
    else if (secondHalfGoals > firstHalfGoals) winnerHalf = 'second';
    else winnerHalf = 'equal';
  }

  // Calculate clean sheet
  const cleanSheetHappened = (homeScore === 0 || awayScore === 0) ? 'yes' : 'no';

  // Get all predictions for this match
  const { results: predictions } = await db.prepare('SELECT * FROM predictions WHERE match_id = ?').bind(matchId).all();

  for (const pred of predictions) {
    const pWinner = pred.predicted_winner === winner ? 3 : 0;
    const pOu = pred.predicted_over_under === ouResult ? 1 : 0;
    const pScore = (pred.predicted_home_score === homeScore && pred.predicted_away_score === awayScore) ? 1 : 0;

    // Underdog Bonus: +1 if player picked the option and that outcome occurred, provided it was not the option with the highest win probability (favorite)
    let pUnderdog = 0;
    if (pWinner > 0 && homeWinPct != null && awayWinPct != null && drawWinPct != null) {
      const maxPct = Math.max(homeWinPct, awayWinPct, drawWinPct);
      if (winner === 'home' && homeWinPct < maxPct) pUnderdog = 1;
      else if (winner === 'away' && awayWinPct < maxPct) pUnderdog = 1;
      else if (winner === 'draw' && drawWinPct < maxPct) pUnderdog = 1;
    }

    let pTotalCardsEarned = 0;
    if (actualCards !== null && pred.predicted_total_cards !== null) {
      pTotalCardsEarned = pred.predicted_total_cards === actualCards ? 3 : 0;
    }

    let pFirstScorerEarned = 0;
    if (actualFirstScorer !== null && pred.predicted_first_scorer !== null) {
      pFirstScorerEarned = pred.predicted_first_scorer === actualFirstScorer ? 2 : 0;
    }

    let pHalf = 0;
    if (pred.predicted_highest_scoring_half !== null) {
      pHalf = pred.predicted_highest_scoring_half === winnerHalf ? 2 : 0;
    }

    let pCleanSheet = 0;
    if (pred.predicted_clean_sheet !== null) {
      pCleanSheet = pred.predicted_clean_sheet === cleanSheetHappened ? 1 : 0;
    }

    const totalPoints = pWinner + pOu + pUnderdog + pTotalCardsEarned + pFirstScorerEarned + (pScore * 4) + pHalf + pCleanSheet;

    await db.prepare(`
      UPDATE predictions 
      SET 
        points_winner = ?,
        points_ou = ?,
        points_score = ?,
        points_cards_ou = ?,
        points_total_cards = ?,
        points_first_scorer = ?,
        points_highest_scoring_half = ?,
        points_clean_sheet = ?,
        total_points = ?
      WHERE participant_id = ? AND match_id = ?
    `).bind(
      pWinner, 
      pOu, 
      pScore, 
      pUnderdog, 
      pTotalCardsEarned, 
      pFirstScorerEarned, 
      pHalf,
      pCleanSheet,
      totalPoints, 
      pred.participant_id, 
      matchId
    ).run();
  }
}
