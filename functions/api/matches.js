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

// Validation helpers
function isPositiveIntegerId(v) {
  if (v === undefined || v === null) return false;
  const n = parseInt(v);
  return Number.isInteger(n) && n > 0;
}

function isNonNegativeInteger(v) {
  if (v === null || v === undefined) return true;
  const n = parseInt(v);
  return Number.isInteger(n) && n >= 0;
}

function isFiniteNumber(v) {
  if (v === null || v === undefined) return false;
  return typeof v === 'number' && Number.isFinite(v);
}

function isPercentValue(v) {
  if (v === undefined || v === null) return false;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

function isEnumValue(v, allowed) {
  return allowed.includes(v);
}

// Local helper: treat a match as started
function matchHasStarted(match) {
  if (!match) return true;
  if (match.status !== 'scheduled') return true;
  if (match.finished === 1) return true;
  if (!match.local_date) return true;
  const ms = new Date(match.local_date).getTime();
  if (isNaN(ms)) return true;
  if (ms <= Date.now()) return true;
  return false;
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

      // Strict input validation
      if (!isPositiveIntegerId(matchId)) {
        return new Response(JSON.stringify({ error: 'Invalid matchId: must be a positive integer' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(homeScore)) {
        return new Response(JSON.stringify({ error: 'Invalid homeScore: must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(awayScore)) {
        return new Response(JSON.stringify({ error: 'Invalid awayScore: must be a non-negative integer' }), { status: 400, headers });
      }
      if (homeHtScore !== null && homeHtScore !== undefined && !isNonNegativeInteger(homeHtScore)) {
        return new Response(JSON.stringify({ error: 'Invalid homeHtScore: must be a non-negative integer' }), { status: 400, headers });
      }
      if (awayHtScore !== null && awayHtScore !== undefined && !isNonNegativeInteger(awayHtScore)) {
        return new Response(JSON.stringify({ error: 'Invalid awayHtScore: must be a non-negative integer' }), { status: 400, headers });
      }
      if (status && !isEnumValue(status, ['scheduled', 'live', 'finished'])) {
        return new Response(JSON.stringify({ error: 'Invalid status: must be scheduled, live, or finished' }), { status: 400, headers });
      }
      if (actualCards !== undefined && actualCards !== null && actualCards !== '' && !isNonNegativeInteger(actualCards)) {
        return new Response(JSON.stringify({ error: 'Invalid actualCards: must be a non-negative integer' }), { status: 400, headers });
      }
      if (actualFirstScorer && !isEnumValue(actualFirstScorer, ['home', 'away', 'none'])) {
        return new Response(JSON.stringify({ error: 'Invalid actualFirstScorer: must be home, away, or none' }), { status: 400, headers });
      }
      if (homeWinPct !== undefined && !isPercentValue(parseFloat(homeWinPct))) {
        return new Response(JSON.stringify({ error: 'Invalid homeWinPct: must be a number between 0 and 100' }), { status: 400, headers });
      }
      if (awayWinPct !== undefined && !isPercentValue(parseFloat(awayWinPct))) {
        return new Response(JSON.stringify({ error: 'Invalid awayWinPct: must be a number between 0 and 100' }), { status: 400, headers });
      }
      if (drawWinPct !== undefined && !isPercentValue(parseFloat(drawWinPct))) {
        return new Response(JSON.stringify({ error: 'Invalid drawWinPct: must be a number between 0 and 100' }), { status: 400, headers });
      }
      if (overUnderLine !== undefined && !isFiniteNumber(parseFloat(overUnderLine))) {
        return new Response(JSON.stringify({ error: 'Invalid overUnderLine: must be a finite number' }), { status: 400, headers });
      }
      if (overOdds !== undefined && !isFiniteNumber(parseFloat(overOdds))) {
        return new Response(JSON.stringify({ error: 'Invalid overOdds: must be a finite number' }), { status: 400, headers });
      }
      if (underOdds !== undefined && !isFiniteNumber(parseFloat(underOdds))) {
        return new Response(JSON.stringify({ error: 'Invalid underOdds: must be a finite number' }), { status: 400, headers });
      }
      if (cardsLine !== undefined && !isFiniteNumber(parseFloat(cardsLine))) {
        return new Response(JSON.stringify({ error: 'Invalid cardsLine: must be a finite number' }), { status: 400, headers });
      }

      // Normalize types
      const hScore = homeScore !== undefined ? parseInt(homeScore) : 0;
      const aScore = awayScore !== undefined ? parseInt(awayScore) : 0;
      const hHtScore = (homeHtScore !== undefined && homeHtScore !== null && homeHtScore !== '') ? parseInt(homeHtScore) : null;
      const aHtScore = (awayHtScore !== undefined && awayHtScore !== null && awayHtScore !== '') ? parseInt(awayHtScore) : null;
      let finishedVal = finished ? 1 : 0;
      let normalizedStatus = status || 'scheduled';

      // Enforce consistency
      if (finishedVal === 1) normalizedStatus = 'finished';
      if (normalizedStatus === 'finished') finishedVal = 1;

      const hPct = homeWinPct !== undefined ? parseFloat(homeWinPct) : 33.3;
      const aPct = awayWinPct !== undefined ? parseFloat(awayWinPct) : 33.3;
      const dPct = drawWinPct !== undefined ? parseFloat(drawWinPct) : 33.3;
      const ouLine = overUnderLine !== undefined ? parseFloat(overUnderLine) : 2.5;
      const oOdds = overOdds !== undefined ? parseFloat(overOdds) : 1.9;
      const uOdds = underOdds !== undefined ? parseFloat(underOdds) : 1.9;
      const cLine = cardsLine !== undefined ? parseFloat(cardsLine) : 3.5;
      const actCards = (actualCards !== undefined && actualCards !== '') ? parseInt(actualCards) : null;
      let actFirstScorer = actualFirstScorer || null;

      // Fetch existing match
      const oldMatch = await env.db.prepare(`
        SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(parseInt(matchId)).first();

      if (!oldMatch) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      // Protect odds after kickoff
      if (matchHasStarted(oldMatch)) {
        const oddsFieldsChanged =
          (homeWinPct !== undefined && oldMatch.home_win_pct !== hPct) ||
          (awayWinPct !== undefined && oldMatch.away_win_pct !== aPct) ||
          (drawWinPct !== undefined && oldMatch.draw_pct !== dPct) ||
          (overUnderLine !== undefined && oldMatch.over_under_line !== ouLine) ||
          (overOdds !== undefined && oldMatch.over_odds !== oOdds) ||
          (underOdds !== undefined && oldMatch.under_odds !== uOdds) ||
          (cardsLine !== undefined && oldMatch.cards_line !== cLine);

        if (oddsFieldsChanged) {
          return new Response(JSON.stringify({ error: 'Cannot change odds after match has started' }), { status: 400, headers });
        }
      }

      // Log odds changes only when odds actually changed
      if (oldMatch) {
        const homeCode = oldMatch.home_code || oldMatch.home_team_name.substring(0, 3).toUpperCase();
        const awayCode = oldMatch.away_code || oldMatch.away_team_name.substring(0, 3).toUpperCase();
        const matchLabel = `${homeCode} vs ${awayCode}`;
        
        if (homeWinPct !== undefined && (oldMatch.home_win_pct !== hPct || oldMatch.away_win_pct !== aPct || oldMatch.draw_pct !== dPct)) {
          const oldVal = `H: ${oldMatch.home_win_pct}%, D: ${oldMatch.draw_pct}%, A: ${oldMatch.away_win_pct}%`;
          const newVal = `H: ${hPct}%, D: ${dPct}%, A: ${aPct}%`;
          await logChange(env.db, 'odds', parseInt(matchId), null, `${matchLabel} Winner`, oldVal, newVal);
        }

        if (overUnderLine !== undefined && (oldMatch.over_under_line !== ouLine || oldMatch.over_odds !== oOdds || oldMatch.under_odds !== uOdds)) {
          const oldVal = `Line: ${oldMatch.over_under_line}, ${formatOuPct(oldMatch.over_odds, oldMatch.under_odds)}`;
          const newVal = `Line: ${ouLine}, ${formatOuPct(oOdds, uOdds)}`;
          await logChange(env.db, 'odds', parseInt(matchId), null, `${matchLabel} O/U Goals`, oldVal, newVal);
        }

        const oldCardsOverOdds = oldMatch.cards_over_odds !== undefined ? oldMatch.cards_over_odds : 1.9;
        const oldCardsUnderOdds = oldMatch.cards_under_odds !== undefined ? oldMatch.cards_under_odds : 1.9;
        if (cardsLine !== undefined && oldMatch.cards_line !== cLine) {
          const oldVal = `Line: ${oldMatch.cards_line}, ${formatOuPct(oldCardsOverOdds, oldCardsUnderOdds)}`;
          const newVal = `Line: ${cLine}, ${formatOuPct(1.9, 1.9)}`;
          await logChange(env.db, 'odds', parseInt(matchId), null, `${matchLabel} O/U Score First`, oldVal, newVal);
        }

        if (oldMatch.home_score !== hScore || oldMatch.away_score !== aScore) {
          await logChange(env.db, 'score', parseInt(matchId), null, `${matchLabel} score`, `${oldMatch.home_score}-${oldMatch.away_score}`, `${hScore}-${aScore}`);
        }
        if (oldMatch.home_ht_score !== hHtScore || oldMatch.away_ht_score !== aHtScore) {
          const oldHt = (oldMatch.home_ht_score !== null && oldMatch.away_ht_score !== null) ? `${oldMatch.home_ht_score}-${oldMatch.away_ht_score}` : 'null';
          const newHt = (hHtScore !== null && aHtScore !== null) ? `${hHtScore}-${aHtScore}` : 'null';
          if (oldHt !== newHt) {
            await logChange(env.db, 'score', parseInt(matchId), null, `${matchLabel} halftime score`, oldHt, newHt);
          }
        }
        if (oldMatch.actual_cards !== actCards) {
          await logChange(env.db, 'cards', parseInt(matchId), null, `${matchLabel} actual cards`, oldMatch.actual_cards, actCards);
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
        .bind(hScore, aScore, hHtScore, aHtScore, normalizedStatus, finishedVal, hPct, aPct, dPct, ouLine, oOdds, uOdds, cLine, actCards, actFirstScorer, parseInt(matchId))
        .run();

      clearMatchesCache();
      await bumpVersion(env.db, 'matches');

      if (finishedVal === 1) {
        await scoreAllPredictionsForMatch(env.db, parseInt(matchId), {
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
      const updatedMatch = await env.db.prepare('SELECT * FROM matches WHERE id = ?').bind(parseInt(matchId)).first();
      return new Response(JSON.stringify({ success: true, match: updatedMatch }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    await flushLogs(env.db);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

