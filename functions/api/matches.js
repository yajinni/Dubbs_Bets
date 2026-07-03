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

// --------------------------------------------------------
// Validation helpers (Phase 9)
// --------------------------------------------------------

function isPositiveIntegerId(v) {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v !== 'number' && typeof v !== 'string') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0 && Number.isFinite(n);
}

function isNonNegativeInteger(v) {
  if (v === null || v === undefined || v === '') return true;
  if (typeof v !== 'number' && typeof v !== 'string') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && Number.isFinite(n);
}

function isFiniteNumber(v) {
  if (v === null || v === undefined || v === '') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && !Number.isNaN(n);
}

function isEnumValue(v, allowed) {
  if (v === null || v === undefined || v === '') return true;
  return allowed.includes(v);
}

function isTruthyFlag(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false' || v === null || v === undefined || v === '') return 0;
  return null;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

// Local helper equivalent to hasMatchStarted in sync.js. Duplicated here on
// purpose to avoid broad shared-module refactors for what is a tiny predicate.
function matchHasStarted(match) {
  if (!match) return true;
  if (match.status && match.status !== 'scheduled') return true;
  if (match.finished === 1) return true;
  if (!match.local_date) return true;
  const t = new Date(match.local_date).getTime();
  if (Number.isNaN(t)) return true;
  if (t <= Date.now()) return true;
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

      if (matchId === undefined || matchId === null || matchId === '') {
        return jsonError('Match ID is required', 400);
      }
      if (!isPositiveIntegerId(matchId)) {
        return jsonError('Invalid match ID: must be a positive integer', 400);
      }

      // --------------------------------------------------------
      // Strict payload validation (Phase 9)
      // --------------------------------------------------------
      if (!isNonNegativeInteger(homeScore)) {
        return jsonError('Invalid homeScore: must be a non-negative integer', 400);
      }
      if (!isNonNegativeInteger(awayScore)) {
        return jsonError('Invalid awayScore: must be a non-negative integer', 400);
      }
      if (homeHtScore !== null && homeHtScore !== undefined && homeHtScore !== '') {
        if (!isNonNegativeInteger(homeHtScore)) {
          return jsonError('Invalid homeHtScore: must be a non-negative integer or null', 400);
        }
      }
      if (awayHtScore !== null && awayHtScore !== undefined && awayHtScore !== '') {
        if (!isNonNegativeInteger(awayHtScore)) {
          return jsonError('Invalid awayHtScore: must be a non-negative integer or null', 400);
        }
      }
      const STATUS_VALUES = ['scheduled', 'live', 'finished'];
      if (!isEnumValue(status, STATUS_VALUES)) {
        return jsonError('Invalid status: must be one of scheduled, live, finished', 400);
      }
      const finishedFlag = isTruthyFlag(finished);
      if (finishedFlag === null) {
        return jsonError('Invalid finished: must be boolean-like (true/false/0/1)', 400);
      }
      const finishedVal = finishedFlag;
      // Enforce status/finished consistency
      if (finishedVal === 1 && status !== 'finished') {
        return jsonError('Inconsistent payload: finished=1 requires status="finished"', 400);
      }
      if (status === 'finished' && finishedVal !== 1) {
        return jsonError('Inconsistent payload: status="finished" requires finished=1', 400);
      }

      // Validate odds percentage fields. 0-100 inclusive.
      const pctCheck = (v, name) => {
        if (v === null || v === undefined || v === '') return null;
        if (!isFiniteNumber(v)) return `${name} must be a finite number`;
        const n = Number(v);
        if (n < 0 || n > 100) return `${name} must be between 0 and 100`;
        return null;
      };
      const pctErr = pctCheck(homeWinPct, 'homeWinPct') || pctCheck(awayWinPct, 'awayWinPct') || pctCheck(drawWinPct, 'drawWinPct');
      if (pctErr) return jsonError(`Invalid odds percentage: ${pctErr}`, 400);

      // Validate finite non-negative numbers for line/odds.
      const nonNegNumCheck = (v, name) => {
        if (v === null || v === undefined || v === '') return null;
        if (!isFiniteNumber(v)) return `${name} must be a finite number`;
        const n = Number(v);
        if (n < 0) return `${name} must be non-negative`;
        return null;
      };
      const oddsErr = nonNegNumCheck(overUnderLine, 'overUnderLine')
        || nonNegNumCheck(overOdds, 'overOdds')
        || nonNegNumCheck(underOdds, 'underOdds')
        || nonNegNumCheck(cardsLine, 'cardsLine');
      if (oddsErr) return jsonError(`Invalid odds value: ${oddsErr}`, 400);

      // Validate actualCards
      if (actualCards !== null && actualCards !== undefined && actualCards !== '') {
        if (!isNonNegativeInteger(actualCards)) {
          return jsonError('Invalid actualCards: must be a non-negative integer or null', 400);
        }
      }

      // Validate actualFirstScorer
      const FIRST_SCORER_VALUES = ['home', 'away', 'none'];
      if (!isEnumValue(actualFirstScorer, FIRST_SCORER_VALUES)) {
        return jsonError('Invalid actualFirstScorer: must be null or one of home, away, none', 400);
      }

      // Convert variables to correct SQL types. Defaults only apply when the
      // field is omitted from the payload — explicit null/empty is preserved.
      const hScore = homeScore !== undefined ? Number(homeScore) : 0;
      const aScore = awayScore !== undefined ? Number(awayScore) : 0;
      const hHtScore = (homeHtScore !== undefined && homeHtScore !== null && homeHtScore !== '') ? Number(homeHtScore) : null;
      const aHtScore = (awayHtScore !== undefined && awayHtScore !== null && awayHtScore !== '') ? Number(awayHtScore) : null;
      const hPct = homeWinPct !== undefined ? Number(homeWinPct) : 33.3;
      const aPct = awayWinPct !== undefined ? Number(awayWinPct) : 33.3;
      const dPct = drawWinPct !== undefined ? Number(drawWinPct) : 33.3;
      const ouLine = overUnderLine !== undefined ? Number(overUnderLine) : 2.5;
      const oOdds = overOdds !== undefined ? Number(overOdds) : 1.9;
      const uOdds = underOdds !== undefined ? Number(underOdds) : 1.9;
      const cLine = cardsLine !== undefined ? Number(cardsLine) : 3.5;
      const actCards = (actualCards !== undefined && actualCards !== '') ? Number(actualCards) : null;
      const actFirstScorer = actualFirstScorer || null;
      const statusVal = status || 'scheduled';

      const oldMatch = await env.db.prepare(`
        SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchId).first();

      // --------------------------------------------------------
      // Phase 10: protect manual odds writes after kickoff
      // --------------------------------------------------------
      const started = matchHasStarted(oldMatch);

      // Snapshot what the caller is trying to change vs. what is currently in
      // the DB. If the match has started, ANY change to odds fields is rejected
      // and no log entry is created. Score / status / actual_* fields may still
      // update after kickoff.
      const oddsFieldChanged =
        oldMatch && (
          oldMatch.home_win_pct !== hPct ||
          oldMatch.away_win_pct !== aPct ||
          oldMatch.draw_pct !== dPct ||
          oldMatch.over_under_line !== ouLine ||
          oldMatch.over_odds !== oOdds ||
          oldMatch.under_odds !== uOdds ||
          oldMatch.cards_line !== cLine
        );

      if (started && oddsFieldChanged) {
        return jsonError('Odds are locked for this match because it has already started.', 400);
      }

      if (oldMatch) {
        const homeCode = oldMatch.home_code || oldMatch.home_team_name.substring(0, 3).toUpperCase();
        const awayCode = oldMatch.away_code || oldMatch.away_team_name.substring(0, 3).toUpperCase();
        const matchLabel = `${homeCode} vs ${awayCode}`;

        // Log Odds changes (grouped Winner probabilities) — only when actually changed.
        if (oddsFieldChanged) {
          if (oldMatch.home_win_pct !== hPct || oldMatch.away_win_pct !== aPct || oldMatch.draw_pct !== dPct) {
            const oldVal = `H: ${oldMatch.home_win_pct}%, D: ${oldMatch.draw_pct}%, A: ${oldMatch.away_win_pct}%`;
            const newVal = `H: ${hPct}%, D: ${dPct}%, A: ${aPct}%`;
            await logChange(env.db, 'odds', matchId, null, `${matchLabel} Winner`, oldVal, newVal);
          }

          if (oldMatch.over_under_line !== ouLine || oldMatch.over_odds !== oOdds || oldMatch.under_odds !== uOdds) {
            const oldVal = `Line: ${oldMatch.over_under_line}, ${formatOuPct(oldMatch.over_odds, oldMatch.under_odds)}`;
            const newVal = `Line: ${ouLine}, ${formatOuPct(oOdds, uOdds)}`;
            await logChange(env.db, 'odds', matchId, null, `${matchLabel} O/U Goals`, oldVal, newVal);
          }

          if (oldMatch.cards_line !== cLine) {
            const oldCardsOverOdds = oldMatch.cards_over_odds !== undefined ? oldMatch.cards_over_odds : 1.9;
            const oldCardsUnderOdds = oldMatch.cards_under_odds !== undefined ? oldMatch.cards_under_odds : 1.9;
            const oldVal = `Line: ${oldMatch.cards_line}, ${formatOuPct(oldCardsOverOdds, oldCardsUnderOdds)}`;
            const newVal = `Line: ${cLine}, ${formatOuPct(1.9, 1.9)}`;
            await logChange(env.db, 'odds', matchId, null, `${matchLabel} O/U Score First`, oldVal, newVal);
          }
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

