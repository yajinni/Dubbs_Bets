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
  return typeof value === 'number'
    ? Number.isInteger(value) && value > 0
    : typeof value === 'string' && /^[1-9]\d*$/.test(value.trim());
}

function isNonNegativeInteger(value) {
  return typeof value === 'number'
    ? Number.isInteger(value) && value >= 0
    : typeof value === 'string' && /^\d+$/.test(value.trim());
}

function isFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed !== '' && Number.isFinite(Number(trimmed));
  }

  return false;
}

function isEnumValue(value, allowedValues) {
  return typeof value === 'string' && allowedValues.includes(value);
}

function parseBooleanLike(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return null;
}

function hasMatchStarted(match, nowMs = Date.now()) {
  if (!match || match.finished === 1 || match.status !== 'scheduled') return true;
  if (!match.local_date) return true;

  const matchTime = new Date(match.local_date).getTime();
  if (Number.isNaN(matchTime)) return true;
  return matchTime <= nowMs;
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

      const normalizedStatusInput = status === undefined || status === null || status === '' ? 'scheduled' : status;
      if (!isEnumValue(normalizedStatusInput, ['scheduled', 'live', 'finished'])) {
        return new Response(JSON.stringify({ error: 'Status must be scheduled, live, or finished' }), { status: 400, headers });
      }

      let finishedVal = parseBooleanLike(finished);
      if (finishedVal === null) {
        if (finished === undefined || finished === null || finished === '') {
          finishedVal = 0;
        } else {
          return new Response(JSON.stringify({ error: 'Finished must be a boolean-like value' }), { status: 400, headers });
        }
      }

      let normalizedStatus = normalizedStatusInput;
      if (normalizedStatus === 'finished' || finishedVal === 1) {
        normalizedStatus = 'finished';
        finishedVal = 1;
      }

      const hScoreInput = homeScore === undefined || homeScore === null || homeScore === '' ? 0 : homeScore;
      const aScoreInput = awayScore === undefined || awayScore === null || awayScore === '' ? 0 : awayScore;
      if (!isNonNegativeInteger(hScoreInput)) {
        return new Response(JSON.stringify({ error: 'homeScore must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(aScoreInput)) {
        return new Response(JSON.stringify({ error: 'awayScore must be a non-negative integer' }), { status: 400, headers });
      }

      const hHtScore = (homeHtScore === undefined || homeHtScore === null || homeHtScore === '') ? null : homeHtScore;
      const aHtScore = (awayHtScore === undefined || awayHtScore === null || awayHtScore === '') ? null : awayHtScore;
      if (hHtScore !== null && !isNonNegativeInteger(hHtScore)) {
        return new Response(JSON.stringify({ error: 'homeHtScore must be null, empty, or a non-negative integer' }), { status: 400, headers });
      }
      if (aHtScore !== null && !isNonNegativeInteger(aHtScore)) {
        return new Response(JSON.stringify({ error: 'awayHtScore must be null, empty, or a non-negative integer' }), { status: 400, headers });
      }

      const hPctInput = homeWinPct === undefined || homeWinPct === null || homeWinPct === '' ? 33.3 : homeWinPct;
      const aPctInput = awayWinPct === undefined || awayWinPct === null || awayWinPct === '' ? 33.3 : awayWinPct;
      const dPctInput = drawWinPct === undefined || drawWinPct === null || drawWinPct === '' ? 33.3 : drawWinPct;
      const ouLineInput = overUnderLine === undefined || overUnderLine === null || overUnderLine === '' ? 2.5 : overUnderLine;
      const oOddsInput = overOdds === undefined || overOdds === null || overOdds === '' ? 1.9 : overOdds;
      const uOddsInput = underOdds === undefined || underOdds === null || underOdds === '' ? 1.9 : underOdds;
      const cLineInput = cardsLine === undefined || cardsLine === null || cardsLine === '' ? 3.5 : cardsLine;

      for (const [field, value] of [
        ['homeWinPct', hPctInput],
        ['awayWinPct', aPctInput],
        ['drawWinPct', dPctInput],
      ]) {
        if (!isFiniteNumber(value)) {
          return new Response(JSON.stringify({ error: `${field} must be a finite number` }), { status: 400, headers });
        }
        const numeric = Number(value);
        if (numeric < 0 || numeric > 100) {
          return new Response(JSON.stringify({ error: `${field} must be between 0 and 100` }), { status: 400, headers });
        }
      }

      for (const [field, value] of [
        ['overUnderLine', ouLineInput],
        ['overOdds', oOddsInput],
        ['underOdds', uOddsInput],
        ['cardsLine', cLineInput],
      ]) {
        if (!isFiniteNumber(value)) {
          return new Response(JSON.stringify({ error: `${field} must be a finite number` }), { status: 400, headers });
        }
        if (Number(value) < 0) {
          return new Response(JSON.stringify({ error: `${field} must be a non-negative number` }), { status: 400, headers });
        }
      }

      const actualCardsInput = actualCards === undefined || actualCards === null || actualCards === '' ? null : actualCards;
      if (actualCardsInput !== null && !isNonNegativeInteger(actualCardsInput)) {
        return new Response(JSON.stringify({ error: 'actualCards must be null, empty, or a non-negative integer' }), { status: 400, headers });
      }

      const actFirstScorer = actualFirstScorer === undefined || actualFirstScorer === null || actualFirstScorer === '' ? null : actualFirstScorer;
      if (actFirstScorer !== null && !isEnumValue(actFirstScorer, ['home', 'away', 'none'])) {
        return new Response(JSON.stringify({ error: 'actualFirstScorer must be null or home, away, or none' }), { status: 400, headers });
      }

      const hScore = Number(hScoreInput);
      const aScore = Number(aScoreInput);
      const hHtScoreValue = hHtScore === null ? null : Number(hHtScore);
      const aHtScoreValue = aHtScore === null ? null : Number(aHtScore);
      const hPct = Number(hPctInput);
      const aPct = Number(aPctInput);
      const dPct = Number(dPctInput);
      const ouLine = Number(ouLineInput);
      const oOdds = Number(oOddsInput);
      const uOdds = Number(uOddsInput);
      const cLine = Number(cLineInput);
      const actCards = actualCardsInput === null ? null : Number(actualCardsInput);

      const oldMatch = await env.db.prepare(`
        SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchIdInt).first();

      if (oldMatch) {
        const started = hasMatchStarted(oldMatch);
        const homeCode = oldMatch.home_code || oldMatch.home_team_name.substring(0, 3).toUpperCase();
        const awayCode = oldMatch.away_code || oldMatch.away_team_name.substring(0, 3).toUpperCase();
        const matchLabel = `${homeCode} vs ${awayCode}`;

        const oddsFieldsChanged =
          oldMatch.home_win_pct !== hPct ||
          oldMatch.away_win_pct !== aPct ||
          oldMatch.draw_pct !== dPct ||
          oldMatch.over_under_line !== ouLine ||
          oldMatch.over_odds !== oOdds ||
          oldMatch.under_odds !== uOdds ||
          oldMatch.cards_line !== cLine;

        if (started && oddsFieldsChanged) {
          return new Response(JSON.stringify({ error: 'Odds cannot be changed after kickoff' }), { status: 400, headers });
        }
        
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
        if (oldMatch.home_ht_score !== hHtScoreValue || oldMatch.away_ht_score !== aHtScoreValue) {
          const oldHt = (oldMatch.home_ht_score !== null && oldMatch.away_ht_score !== null) ? `${oldMatch.home_ht_score}-${oldMatch.away_ht_score}` : 'null';
          const newHt = (hHtScoreValue !== null && aHtScoreValue !== null) ? `${hHtScoreValue}-${aHtScoreValue}` : 'null';
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
        .bind(hScore, aScore, hHtScoreValue, aHtScoreValue, normalizedStatus, finishedVal, hPct, aPct, dPct, ouLine, oOdds, uOdds, cLine, actCards, actFirstScorer, matchIdInt)
        .run();

      clearMatchesCache();
      await bumpVersion(env.db, 'matches');

      // If finished, we want to recalculate predictions/points for this match
      if (finishedVal === 1) {
        await scoreAllPredictionsForMatch(env.db, matchIdInt, {
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
          home_ht_score: hHtScoreValue,
          away_ht_score: aHtScoreValue,
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

