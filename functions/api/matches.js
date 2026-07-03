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

// ---- Validation helpers (strict server-side validation) ----
function isPositiveIntegerId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}
function isNonNegativeInteger(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0;
}
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && !Number.isNaN(v);
}
function isEnumValue(v, allowed) {
  return typeof v === 'string' && allowed.includes(v);
}
// A match has started if it is not scheduled, already finished, at/after kickoff,
// or has a missing/invalid date. Duplicated locally to avoid a shared-module refactor.
function hasMatchStartedLocal(match, nowMs = Date.now()) {
  if (!match) return true;
  if (match.status !== 'scheduled') return true;
  if (match.finished === 1) return true;
  if (!match.local_date) return true;
  const kickoff = new Date(match.local_date).getTime();
  if (isNaN(kickoff)) return true;
  return nowMs >= kickoff;
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

      // Fetch existing match before applying updates (needed for odds-change detection).
      const oldMatch = await env.db.prepare(`
        SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchId).first();

      if (!oldMatch) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      // ---- Validate scores (non-negative integers) ----
      const hScore = homeScore !== undefined ? Number(homeScore) : 0;
      const aScore = awayScore !== undefined ? Number(awayScore) : 0;
      if (!isNonNegativeInteger(hScore)) {
        return new Response(JSON.stringify({ error: 'homeScore must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(aScore)) {
        return new Response(JSON.stringify({ error: 'awayScore must be a non-negative integer' }), { status: 400, headers });
      }

      // ---- Validate halftime scores (null/empty or non-negative integers) ----
      const hHtScore = (homeHtScore === undefined || homeHtScore === null || homeHtScore === '') ? null : Number(homeHtScore);
      const aHtScore = (awayHtScore === undefined || awayHtScore === null || awayHtScore === '') ? null : Number(awayHtScore);
      if (hHtScore !== null && !isNonNegativeInteger(hHtScore)) {
        return new Response(JSON.stringify({ error: 'homeHtScore must be null or a non-negative integer' }), { status: 400, headers });
      }
      if (aHtScore !== null && !isNonNegativeInteger(aHtScore)) {
        return new Response(JSON.stringify({ error: 'awayHtScore must be null or a non-negative integer' }), { status: 400, headers });
      }

      // ---- Validate status (enum) ----
      const statusVal = status !== undefined ? status : 'scheduled';
      if (!isEnumValue(statusVal, ['scheduled', 'live', 'finished'])) {
        return new Response(JSON.stringify({ error: 'status must be one of: scheduled, live, finished' }), { status: 400, headers });
      }

      // ---- Validate/normalize finished (boolean-like -> 0/1) ----
      let finishedVal;
      if (finished === undefined || finished === null || finished === '') {
        finishedVal = 0;
      } else if (finished === true || finished === 1 || finished === '1' || finished === 'true') {
        finishedVal = 1;
      } else if (finished === false || finished === 0 || finished === '0' || finished === 'false') {
        finishedVal = 0;
      } else {
        return new Response(JSON.stringify({ error: 'finished must be a boolean-like value' }), { status: 400, headers });
      }

      // ---- Enforce finished/status consistency ----
      if (finishedVal === 1 && statusVal !== 'finished') {
        return new Response(JSON.stringify({ error: "status must be 'finished' when finished is 1" }), { status: 400, headers });
      }
      if (statusVal === 'finished' && finishedVal !== 1) {
        return new Response(JSON.stringify({ error: "finished must be 1 when status is 'finished'" }), { status: 400, headers });
      }

      // ---- Validate odds percentage fields (finite number between 0 and 100) ----
      function validatePct(v) {
        return isFiniteNumber(v) && v >= 0 && v <= 100 ? v : null;
      }
      const hPct = homeWinPct !== undefined ? validatePct(Number(homeWinPct)) : oldMatch.home_win_pct;
      const aPct = awayWinPct !== undefined ? validatePct(Number(awayWinPct)) : oldMatch.away_win_pct;
      const dPct = drawWinPct !== undefined ? validatePct(Number(drawWinPct)) : oldMatch.draw_pct;
      if (hPct === null) { return new Response(JSON.stringify({ error: 'homeWinPct must be a finite number between 0 and 100' }), { status: 400, headers }); }
      if (aPct === null) { return new Response(JSON.stringify({ error: 'awayWinPct must be a finite number between 0 and 100' }), { status: 400, headers }); }
      if (dPct === null) { return new Response(JSON.stringify({ error: 'drawWinPct must be a finite number between 0 and 100' }), { status: 400, headers }); }

      // ---- Validate O/U line, over/under odds, cards line (finite non-negative numbers) ----
      function validateNonNeg(v) {
        return isFiniteNumber(v) && v >= 0 ? v : null;
      }
      const ouLine = overUnderLine !== undefined ? validateNonNeg(Number(overUnderLine)) : oldMatch.over_under_line;
      const oOdds = overOdds !== undefined ? validateNonNeg(Number(overOdds)) : oldMatch.over_odds;
      const uOdds = underOdds !== undefined ? validateNonNeg(Number(underOdds)) : oldMatch.under_odds;
      const cLine = cardsLine !== undefined ? validateNonNeg(Number(cardsLine)) : oldMatch.cards_line;
      if (ouLine === null) { return new Response(JSON.stringify({ error: 'overUnderLine must be a finite non-negative number' }), { status: 400, headers }); }
      if (oOdds === null) { return new Response(JSON.stringify({ error: 'overOdds must be a finite non-negative number' }), { status: 400, headers }); }
      if (uOdds === null) { return new Response(JSON.stringify({ error: 'underOdds must be a finite non-negative number' }), { status: 400, headers }); }
      if (cLine === null) { return new Response(JSON.stringify({ error: 'cardsLine must be a finite non-negative number' }), { status: 400, headers }); }

      // ---- Validate actualCards (null/empty or non-negative integer) ----
      const actCards = (actualCards === undefined || actualCards === null || actualCards === '') ? null : Number(actualCards);
      if (actCards !== null && !isNonNegativeInteger(actCards)) {
        return new Response(JSON.stringify({ error: 'actualCards must be null or a non-negative integer' }), { status: 400, headers });
      }

      // ---- Validate actualFirstScorer (null or one of home/away/none) ----
      let actFirstScorer = actualFirstScorer || null;
      if (actFirstScorer !== null && !isEnumValue(actFirstScorer, ['home', 'away', 'none'])) {
        return new Response(JSON.stringify({ error: 'actualFirstScorer must be null or one of: home, away, none' }), { status: 400, headers });
      }

      // ---- After kickoff, odds fields must never change. Score/status/result updates still allowed. ----
      const started = hasMatchStartedLocal(oldMatch);
      const oddsFieldsChanged =
        Number(oldMatch.home_win_pct) !== Number(hPct) ||
        Number(oldMatch.away_win_pct) !== Number(aPct) ||
        Number(oldMatch.draw_pct) !== Number(dPct) ||
        Number(oldMatch.over_under_line) !== Number(ouLine) ||
        Number(oldMatch.over_odds) !== Number(oOdds) ||
        Number(oldMatch.under_odds) !== Number(uOdds) ||
        Number(oldMatch.cards_line) !== Number(cLine);

      if (started && oddsFieldsChanged) {
        return new Response(JSON.stringify({ error: 'Odds cannot be changed after kickoff. Score/status/result updates are still allowed.' }), { status: 400, headers });
      }

      // ---- Log changes (odds logs only when odds actually changed) ----
      const homeCode = oldMatch.home_code || oldMatch.home_team_name.substring(0, 3).toUpperCase();
      const awayCode = oldMatch.away_code || oldMatch.away_team_name.substring(0, 3).toUpperCase();
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // Log Odds changes (grouped Winner probabilities)
      if (Number(oldMatch.home_win_pct) !== Number(hPct) || Number(oldMatch.away_win_pct) !== Number(aPct) || Number(oldMatch.draw_pct) !== Number(dPct)) {
        const oldVal = `H: ${oldMatch.home_win_pct}%, D: ${oldMatch.draw_pct}%, A: ${oldMatch.away_win_pct}%`;
        const newVal = `H: ${hPct}%, D: ${dPct}%, A: ${aPct}%`;
        await logChange(env.db, 'odds', matchId, null, `${matchLabel} Winner`, oldVal, newVal);
      }

      // Log O/U Goals (combined line and odds)
      if (Number(oldMatch.over_under_line) !== Number(ouLine) || Number(oldMatch.over_odds) !== Number(oOdds) || Number(oldMatch.under_odds) !== Number(uOdds)) {
        const oldVal = `Line: ${oldMatch.over_under_line}, ${formatOuPct(oldMatch.over_odds, oldMatch.under_odds)}`;
        const newVal = `Line: ${ouLine}, ${formatOuPct(oOdds, uOdds)}`;
        await logChange(env.db, 'odds', matchId, null, `${matchLabel} O/U Goals`, oldVal, newVal);
      }

      // Log O/U Score First (Cards O/U line and odds combined)
      const oldCardsOverOdds = oldMatch.cards_over_odds !== undefined ? oldMatch.cards_over_odds : 1.9;
      const oldCardsUnderOdds = oldMatch.cards_under_odds !== undefined ? oldMatch.cards_under_odds : 1.9;
      if (Number(oldMatch.cards_line) !== Number(cLine)) {
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
        .bind(hScore, aScore, hHtScore, aHtScore, statusVal, finishedVal, hPct, aPct, dPct, ouLine, oOdds, uOdds, cLine, actCards, actFirstScorer, matchId)
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
      const updatedMatch = await env.db.prepare('SELECT * FROM matches WHERE id = ?').bind(matchId).first();
      return new Response(JSON.stringify({ success: true, match: updatedMatch }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    await flushLogs(env.db);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

