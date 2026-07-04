// Cloudflare Pages Functions: API route to retrieve and update matches (GET, POST)
import { checkAndInitDb, logChange, formatOuPct, emitEvent, bumpVersion, recomputeAllCaches, getMatchesCache, setMatchesCache, clearMatchesCache, scoreAllPredictionsForMatch, flushLogs } from './db_helper.js';
import { getAdminPasswordAuthError } from './auth.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function isPositiveIntegerId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function isEnumValue(value, allowed) {
  return allowed.includes(value);
}

function parseOptionalNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  return isNonNegativeInteger(value) ? Number(value) : NaN;
}

function hasMatchStarted(match) {
  if (!match || match.status !== 'scheduled' || match.finished === 1 || !match.local_date) return true;
  const matchTime = new Date(match.local_date).getTime();
  return Number.isNaN(matchTime) || matchTime <= Date.now();
}

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
      const activeOnly = url.searchParams.get('activeOnly') === 'true';

      if (liveOnly) {
        const { results } = await env.db.prepare(`
          SELECT id, home_score, away_score, home_ht_score, away_ht_score, status, finished, actual_cards, actual_first_scorer, home_team_name, away_team_name
          FROM matches
          WHERE status = 'live'
        `).all();
        return new Response(JSON.stringify(results), { status: 200, headers });
      }

      if (activeOnly) {
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
          WHERE m.status = 'live' 
             OR m.finished = 0 
             OR (m.finished = 1 AND m.local_date >= datetime('now', '-2 days'))
          ORDER BY m.local_date ASC
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

      const authError = await getAdminPasswordAuthError(env.db, password);
      if (authError) {
        return new Response(JSON.stringify({ error: authError.message }), { status: authError.status, headers });
      }

      if (!isPositiveIntegerId(matchId)) {
        return new Response(JSON.stringify({ error: 'Match ID must be a positive integer' }), { status: 400, headers });
      }
      const matchIdInt = Number(matchId);
      if (!isEnumValue(status, ['scheduled', 'live', 'finished'])) {
        return new Response(JSON.stringify({ error: 'Status must be scheduled, live, or finished' }), { status: 400, headers });
      }
      if (typeof finished !== 'boolean' && finished !== 0 && finished !== 1 && finished !== '0' && finished !== '1') {
        return new Response(JSON.stringify({ error: 'Finished must be boolean-like' }), { status: 400, headers });
      }
      let finishedVal = finished === true || finished === 1 || finished === '1' ? 1 : 0;
      let normalizedStatus = status;
      if (finishedVal === 1) normalizedStatus = 'finished';
      if (normalizedStatus === 'finished') finishedVal = 1;

      if (!isNonNegativeInteger(homeScore) || !isNonNegativeInteger(awayScore)) {
        return new Response(JSON.stringify({ error: 'Scores must be non-negative integers' }), { status: 400, headers });
      }

      const hHtScore = parseOptionalNonNegativeInteger(homeHtScore);
      const aHtScore = parseOptionalNonNegativeInteger(awayHtScore);
      if (Number.isNaN(hHtScore) || Number.isNaN(aHtScore)) {
        return new Response(JSON.stringify({ error: 'Halftime scores must be empty or non-negative integers' }), { status: 400, headers });
      }

      // Convert variables to correct SQL types
      const hScore = Number(homeScore);
      const aScore = Number(awayScore);
      const hPct = Number(homeWinPct);
      const aPct = Number(awayWinPct);
      const dPct = Number(drawWinPct);
      const ouLine = Number(overUnderLine);
      const oOdds = Number(overOdds);
      const uOdds = Number(underOdds);
      const cLine = Number(cardsLine);
      const actCards = parseOptionalNonNegativeInteger(actualCards);
      let actFirstScorer = actualFirstScorer || null;

      if (![hPct, aPct, dPct].every(n => Number.isFinite(n) && n >= 0 && n <= 100)) {
        return new Response(JSON.stringify({ error: 'Odds percentages must be finite numbers between 0 and 100' }), { status: 400, headers });
      }
      if (![overUnderLine, overOdds, underOdds, cardsLine].every(v => isFiniteNumber(v) && Number(v) >= 0)) {
        return new Response(JSON.stringify({ error: 'Odds lines and prices must be finite non-negative numbers' }), { status: 400, headers });
      }
      if (Number.isNaN(actCards)) {
        return new Response(JSON.stringify({ error: 'Actual cards must be empty or a non-negative integer' }), { status: 400, headers });
      }
      if (actFirstScorer !== null && !isEnumValue(actFirstScorer, ['home', 'away', 'none'])) {
        return new Response(JSON.stringify({ error: 'Actual first scorer must be home, away, none, or empty' }), { status: 400, headers });
      }

      const oldMatch = await env.db.prepare(`
        SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchIdInt).first();

      if (!oldMatch) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      const oddsChanged =
        oldMatch.home_win_pct !== hPct ||
        oldMatch.away_win_pct !== aPct ||
        oldMatch.draw_pct !== dPct ||
        oldMatch.over_under_line !== ouLine ||
        oldMatch.over_odds !== oOdds ||
        oldMatch.under_odds !== uOdds ||
        oldMatch.cards_line !== cLine;

      if (hasMatchStarted(oldMatch) && oddsChanged) {
        return new Response(JSON.stringify({ error: 'Odds cannot be changed after kickoff' }), { status: 400, headers });
      }

      if (oldMatch) {
        const homeCode = oldMatch.home_code || oldMatch.home_team_name.substring(0, 3).toUpperCase();
        const awayCode = oldMatch.away_code || oldMatch.away_team_name.substring(0, 3).toUpperCase();
        const matchLabel = `${homeCode} vs ${awayCode}`;
        
        // Log Odds changes (grouped Winner probabilities)
        if (oldMatch.home_win_pct !== hPct || oldMatch.away_win_pct !== aPct || oldMatch.draw_pct !== dPct) {
          const oldVal = `H: ${oldMatch.home_win_pct}%, D: ${oldMatch.draw_pct}%, A: ${oldMatch.away_win_pct}%`;
          const newVal = `H: ${hPct}%, D: ${dPct}%, A: ${aPct}%`;
          await logChange(env.db, 'odds', matchIdInt, null, `${matchLabel} Winner`, oldVal, newVal);
        }

        // Log O/U Goals (combined line and odds)
        if (oldMatch.over_under_line !== ouLine || oldMatch.over_odds !== oOdds || oldMatch.under_odds !== uOdds) {
          const oldVal = `Line: ${oldMatch.over_under_line}, ${formatOuPct(oldMatch.over_odds, oldMatch.under_odds)}`;
          const newVal = `Line: ${ouLine}, ${formatOuPct(oOdds, uOdds)}`;
          await logChange(env.db, 'odds', matchIdInt, null, `${matchLabel} O/U Goals`, oldVal, newVal);
        }

        // Log O/U Score First (Cards O/U line and odds combined)
        const oldCardsOverOdds = oldMatch.cards_over_odds !== undefined ? oldMatch.cards_over_odds : 1.9;
        const oldCardsUnderOdds = oldMatch.cards_under_odds !== undefined ? oldMatch.cards_under_odds : 1.9;
        if (oldMatch.cards_line !== cLine) {
          const oldVal = `Line: ${oldMatch.cards_line}, ${formatOuPct(oldCardsOverOdds, oldCardsUnderOdds)}`;
          const newVal = `Line: ${cLine}, ${formatOuPct(1.9, 1.9)}`;
          await logChange(env.db, 'odds', matchIdInt, null, `${matchLabel} O/U Score First`, oldVal, newVal);
        }

        // Log Score/Cards changes
        if (oldMatch.home_score !== hScore || oldMatch.away_score !== aScore) {
          await logChange(env.db, 'score', matchIdInt, null, `${matchLabel} score`, `${oldMatch.home_score}-${oldMatch.away_score}`, `${hScore}-${aScore}`);
        }
        if (oldMatch.home_ht_score !== hHtScore || oldMatch.away_ht_score !== aHtScore) {
          const oldHt = (oldMatch.home_ht_score !== null && oldMatch.away_ht_score !== null) ? `${oldMatch.home_ht_score}-${oldMatch.away_ht_score}` : 'null';
          const newHt = (hHtScore !== null && aHtScore !== null) ? `${hHtScore}-${aHtScore}` : 'null';
          if (oldHt !== newHt) {
            await logChange(env.db, 'score', matchIdInt, null, `${matchLabel} halftime score`, oldHt, newHt);
          }
        }
        if (oldMatch.actual_cards !== actCards) {
          await logChange(env.db, 'cards', matchIdInt, null, `${matchLabel} actual cards`, oldMatch.actual_cards, actCards);
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
        .bind(hScore, aScore, hHtScore, aHtScore, normalizedStatus, finishedVal, hPct, aPct, dPct, ouLine, oOdds, uOdds, cLine, actCards, actFirstScorer, matchIdInt)
        .run();

      clearMatchesCache();
      await bumpVersion(env.db, 'matches');

      // If finished, we want to recalculate predictions/points for this match
      if (finishedVal === 1) {
        await scoreAllPredictionsForMatch(env.db, matchId, {
          home_score: hScore,
          away_score: aScore,
          over_under_line: ouLine,
          home_win_pct: hPct,
          away_win_pct: aPct,
          draw_pct: dPct,
          actual_cards: actCards,
          actual_first_scorer: actFirstScorer,
          actual_penalties: oldMatch.actual_penalties,
          shootout_winner: oldMatch.shootout_winner,
          home_ht_score: hHtScore,
          away_ht_score: aHtScore,
        });
        await recomputeAllCaches(env.db);
      }

      await emitEvent(env.db, 'matches_updated');
      await flushLogs(env.db);
      const updatedMatch = await env.db.prepare('SELECT * FROM matches WHERE id = ?').bind(matchIdInt).first();
      return new Response(JSON.stringify({ success: true, match: updatedMatch }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    await flushLogs(env.db);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

