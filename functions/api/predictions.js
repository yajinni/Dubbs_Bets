// Cloudflare Pages Functions: API route to retrieve and submit predictions (GET, POST)
import { checkAndInitDb, logChange, emitEvent, bumpVersion, recomputeAllCaches, calculatePointsFromPrediction, flushLogs } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// --------------------------------------------------------
// Validation helpers
// --------------------------------------------------------

function isPositiveIntegerId(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0;
}

function isNonNegativeInteger(v) {
  if (v === null || v === undefined || v === '') return true;
  if (typeof v !== 'number' && typeof v !== 'string') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 0;
}

function isEnumValue(v, allowed) {
  if (v === null || v === undefined || v === '') return true;
  return allowed.includes(v);
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers });
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
      const participantId = url.searchParams.get('participantId');
      const matchIdParam = url.searchParams.get('matchId');

      if (matchIdParam) {
        const { results } = await env.db.prepare(`
          SELECT 
            p.id AS participant_id,
            p.name AS participant_name,
            pr.participant_id AS id,
            pr.match_id,
            pr.predicted_winner,
            pr.predicted_over_under,
            pr.predicted_home_score,
            pr.predicted_away_score,
            pr.predicted_total_cards,
            pr.predicted_first_scorer,
            pr.predicted_highest_scoring_half,
            pr.predicted_clean_sheet,
            pr.predicted_penalties,
            COALESCE(pr.total_points, 0) AS total_points,
            COALESCE(pr.points_winner, 0) AS points_winner,
            COALESCE(pr.points_ou, 0) AS points_ou,
            COALESCE(pr.points_score, 0) AS points_score,
            COALESCE(pr.points_first_scorer, 0) AS points_first_scorer,
            COALESCE(pr.points_total_cards, 0) AS points_total_cards,
            COALESCE(pr.points_highest_scoring_half, 0) AS points_highest_scoring_half,
            COALESCE(pr.points_clean_sheet, 0) AS points_clean_sheet,
            COALESCE(pr.points_penalties, 0) AS points_penalties,
            COALESCE(pr.points_cards_ou, 0) AS points_cards_ou
          FROM participants p
          LEFT JOIN predictions pr ON pr.participant_id = p.id AND pr.match_id = ?
        `).bind(parseInt(matchIdParam)).all();

        const runningPointsSetting = await env.db.prepare("SELECT value FROM settings WHERE key = 'cached_running_points'").first();
        let runningPointsMap = {};
        if (runningPointsSetting && runningPointsSetting.value) {
          try {
            const parsed = JSON.parse(runningPointsSetting.value);
            if (parsed && typeof parsed === 'object') {
              runningPointsMap = parsed;
            }
          } catch (e) {
            console.error('Failed to parse cached_running_points:', e);
          }
        }

        const mappedResults = results.map(row => ({
          ...row,
          running_total: runningPointsMap[`${row.participant_id}_${matchIdParam}`] || 0
        }));

        return new Response(JSON.stringify(mappedResults), { status: 200, headers });
      }

      if (!participantId) {
        // Return all predictions in system with participant names
        const { results } = await env.db.prepare(`
          SELECT pr.*, p.name AS participant_name
          FROM predictions pr
          INNER JOIN participants p ON pr.participant_id = p.id
          LIMIT 5000
        `).all();
        return new Response(JSON.stringify(results), { status: 200, headers });
      }

      // Return predictions for a specific participant
      const { results } = await env.db.prepare(`
        SELECT p.*, m.home_team_name, m.away_team_name, m.local_date, m.status, m.finished
        FROM predictions p
        INNER JOIN matches m ON p.match_id = m.id
        WHERE p.participant_id = ?
      `).bind(parseInt(participantId)).all();

      return new Response(JSON.stringify(results), { status: 200, headers });
    }

    if (method === 'POST') {
      const body = await request.json();
      const {
        participantId,
        matchId,
        predictedWinner,       // 'home', 'away', or 'draw'
        predictedOverUnder,    // 'over' or 'under'
        predictedHomeScore,
        predictedAwayScore,
        predictedTotalCards,     // integer or null
        predictedFirstScorer,     // 'home', 'away', or 'none'
        predictedHighestScoringHalf, // 'first', 'second', or 'equal'
        predictedCleanSheet,      // 'yes' or 'no'
        predictedPenalties      // 'yes' or 'no'
      } = body;

      // --------------------------------------------------------
      // Strict payload validation (Phase 7)
      // --------------------------------------------------------
      if (participantId === undefined || participantId === null || participantId === '') {
        return jsonError('Participant ID is required', 400);
      }
      if (matchId === undefined || matchId === null || matchId === '') {
        return jsonError('Match ID is required', 400);
      }
      if (!isPositiveIntegerId(participantId)) {
        return jsonError('Invalid participant ID: must be a positive integer', 400);
      }
      if (!isPositiveIntegerId(matchId)) {
        return jsonError('Invalid match ID: must be a positive integer', 400);
      }

      const WINNER_VALUES = ['home', 'away', 'draw'];
      const OU_VALUES = ['over', 'under'];
      const FIRST_SCORER_VALUES = ['home', 'away', 'none'];
      const HALF_VALUES = ['first', 'second', 'equal'];
      const YES_NO_VALUES = ['yes', 'no'];

      if (!isEnumValue(predictedWinner, WINNER_VALUES)) {
        return jsonError('Invalid predictedWinner: must be one of home, away, draw', 400);
      }
      if (!isEnumValue(predictedOverUnder, OU_VALUES)) {
        return jsonError('Invalid predictedOverUnder: must be one of over, under', 400);
      }
      if (!isNonNegativeInteger(predictedHomeScore)) {
        return jsonError('Invalid predictedHomeScore: must be a non-negative integer', 400);
      }
      if (!isNonNegativeInteger(predictedAwayScore)) {
        return jsonError('Invalid predictedAwayScore: must be a non-negative integer', 400);
      }
      if (!isNonNegativeInteger(predictedTotalCards)) {
        return jsonError('Invalid predictedTotalCards: must be a non-negative integer', 400);
      }
      if (!isEnumValue(predictedFirstScorer, FIRST_SCORER_VALUES)) {
        return jsonError('Invalid predictedFirstScorer: must be one of home, away, none', 400);
      }
      if (!isEnumValue(predictedHighestScoringHalf, HALF_VALUES)) {
        return jsonError('Invalid predictedHighestScoringHalf: must be one of first, second, equal', 400);
      }
      if (!isEnumValue(predictedCleanSheet, YES_NO_VALUES)) {
        return jsonError('Invalid predictedCleanSheet: must be one of yes, no', 400);
      }
      if (!isEnumValue(predictedPenalties, YES_NO_VALUES)) {
        return jsonError('Invalid predictedPenalties: must be one of yes, no', 400);
      }

      // 1. Fetch match with team info (merged query) — needed for early lock check + labels
      const match = await env.db.prepare(`
        SELECT m.local_date, m.status, m.finished, m.home_score, m.away_score, m.home_ht_score, m.away_ht_score, m.over_under_line, m.actual_cards, m.actual_first_scorer, m.actual_penalties, m.home_win_pct, m.away_win_pct, m.home_team_name, m.away_team_name, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchId).first();

      if (!match) {
        return jsonError('Match not found', 404);
      }

      // 2. Early lock check for user-friendly error messages. The conditional
      // write below is the actual race-safe guard, but this saves a round-trip
      // when callers can already see the match is locked.
      const matchStartTime = new Date(match.local_date).getTime();
      const currentTime = Date.now();

      if (Number.isNaN(matchStartTime) || currentTime >= matchStartTime || match.status !== 'scheduled' || match.finished === 1) {
        return jsonError('Predictions are locked. This match has already started or finished.', 403);
      }

      // 3. Check the participant exists before writing.
      const participant = await env.db.prepare('SELECT name FROM participants WHERE id = ?').bind(participantId).first();
      if (!participant) {
        return jsonError('Participant not found', 404);
      }
      const participantName = participant.name;

      // 4. Normalize values to plain JS types (no NaN reaches .bind()).
      const pHomeScore = (predictedHomeScore === null || predictedHomeScore === undefined || predictedHomeScore === '') ? null : Number(predictedHomeScore);
      const pAwayScore = (predictedAwayScore === null || predictedAwayScore === undefined || predictedAwayScore === '') ? null : Number(predictedAwayScore);
      const pTotalCards = (predictedTotalCards === null || predictedTotalCards === undefined || predictedTotalCards === '') ? null : Number(predictedTotalCards);
      const pFirstScorer = predictedFirstScorer || null;
      const pHalfPick = predictedHighestScoringHalf || null;
      const pCleanPick = predictedCleanSheet || null;
      const pPenalties = predictedPenalties || null;

      const homeCode = match?.home_code || (match?.home_team_name ? match.home_team_name.substring(0, 3).toUpperCase() : 'HOM');
      const awayCode = match?.away_code || (match?.away_team_name ? match.away_team_name.substring(0, 3).toUpperCase() : 'AWA');
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // 5. Fetch existing prediction (only used to build the change log AFTER
      // a successful write — we do not log or bump version on a failed write).
      const existing = await env.db.prepare(
        'SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?'
      ).bind(participantId, matchId).first();

      // 6. nowIso used in the EXISTS guard so the write is evaluated at write
      // time. A match that flips to live/finished between the early check and
      // this point will be rejected.
      const nowIso = new Date().toISOString();

      // 7. Conditional write. The write only succeeds if the match is still
      // scheduled, unfinished, and in the future AT write time. This is the
      // race-safe lock that closes the read-then-write gap in the early check.
      let writeResult;
      if (existing) {
        const updateSql = `
          UPDATE predictions
          SET
            predicted_winner = ?,
            predicted_over_under = ?,
            predicted_home_score = ?,
            predicted_away_score = ?,
            predicted_total_cards = ?,
            predicted_first_scorer = ?,
            predicted_highest_scoring_half = ?,
            predicted_clean_sheet = ?,
            predicted_penalties = ?
          WHERE participant_id = ? AND match_id = ?
            AND EXISTS (
              SELECT 1 FROM matches
              WHERE id = ?
                AND status = 'scheduled'
                AND finished = 0
                AND datetime(local_date) > datetime(?)
            )
        `;
        writeResult = await env.db.prepare(updateSql)
          .bind(
            predictedWinner ?? null, predictedOverUnder ?? null,
            pHomeScore, pAwayScore, pTotalCards,
            pFirstScorer, pHalfPick, pCleanPick, pPenalties,
            participantId, matchId,
            matchId, nowIso
          )
          .run();
      } else {
        const insertSql = `
          INSERT INTO predictions (
            participant_id,
            match_id,
            predicted_winner,
            predicted_over_under,
            predicted_home_score,
            predicted_away_score,
            predicted_total_cards,
            predicted_first_scorer,
            predicted_highest_scoring_half,
            predicted_clean_sheet,
            predicted_penalties
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM matches
            WHERE id = ?
              AND status = 'scheduled'
              AND finished = 0
              AND datetime(local_date) > datetime(?)
          )
        `;
        writeResult = await env.db.prepare(insertSql)
          .bind(
            participantId, matchId,
            predictedWinner ?? null, predictedOverUnder ?? null,
            pHomeScore, pAwayScore, pTotalCards,
            pFirstScorer, pHalfPick, pCleanPick, pPenalties,
            matchId, nowIso
          )
          .run();
      }

      const changes = writeResult.meta?.changes ?? 0;
      if (changes === 0) {
        // Match is now locked (live/finished/kickoff passed) between the early
        // check and the write. Reject with 403 and do NOT bump version or log.
        await flushLogs(env.db);
        return jsonError('Predictions are locked. This match has already started or finished.', 403);
      }

      // 8. Build the change log after a successful write.
      const changeLines = [];
      const oldWinner = existing ? existing.predicted_winner : null;
      const newWinner = predictedWinner ?? null;
      if (oldWinner !== newWinner) {
        changeLines.push(`Winner: ${oldWinner || 'None'} -> ${newWinner || 'None'}`);
      }

      const oldOU = existing ? existing.predicted_over_under : null;
      const newOU = predictedOverUnder ?? null;
      if (oldOU !== newOU) {
        changeLines.push(`O/U: ${oldOU || 'None'} -> ${newOU || 'None'}`);
      }

      const oldHome = existing ? existing.predicted_home_score : null;
      const oldAway = existing ? existing.predicted_away_score : null;
      const oldScore = (oldHome !== null && oldAway !== null) ? `${oldHome}-${oldAway}` : null;
      const newScore = (pHomeScore !== null && pAwayScore !== null) ? `${pHomeScore}-${pAwayScore}` : null;
      if (oldScore !== newScore) {
        changeLines.push(`Score: ${oldScore || 'None'} -> ${newScore || 'None'}`);
      }

      const oldCards = existing ? existing.predicted_total_cards : null;
      if (oldCards !== pTotalCards) {
        changeLines.push(`Cards: ${oldCards === null ? 'None' : oldCards} -> ${pTotalCards === null ? 'None' : pTotalCards}`);
      }

      const oldFirstScorer = existing ? existing.predicted_first_scorer : null;
      if (oldFirstScorer !== pFirstScorer) {
        changeLines.push(`First Scorer: ${oldFirstScorer || 'None'} -> ${pFirstScorer || 'None'}`);
      }

      const oldHalf = existing ? existing.predicted_highest_scoring_half : null;
      if (oldHalf !== pHalfPick) {
        changeLines.push(`Highest Scoring Half: ${oldHalf || 'None'} -> ${pHalfPick || 'None'}`);
      }

      const oldClean = existing ? existing.predicted_clean_sheet : null;
      if (oldClean !== pCleanPick) {
        changeLines.push(`Clean Sheet: ${oldClean || 'None'} -> ${pCleanPick || 'None'}`);
      }

      const oldPenalties = existing ? existing.predicted_penalties : null;
      if (oldPenalties !== pPenalties) {
        changeLines.push(`Penalties: ${oldPenalties || 'None'} -> ${pPenalties || 'None'}`);
      }

      if (changeLines.length > 0) {
        const actionType = existing ? 'updated' : 'submitted';
        const description = `${participantName} ${actionType} prediction for ${matchLabel}`;
        const oldValue = existing ? 'Existing prediction' : 'None';
        const newValue = changeLines.join(', ');
        await logChange(env.db, 'prediction', matchId, participantId, description, oldValue, newValue);
      }

      await bumpVersion(env.db, 'predictions');

      // 4. Immediately calculate points for this prediction if the match is already finished
      if (match.finished === 1) {
        const pts = calculatePointsFromPrediction({
          predicted_winner: predictedWinner,
          predicted_over_under: predictedOverUnder,
          predicted_home_score: pHomeScore,
          predicted_away_score: pAwayScore,
          predicted_total_cards: pTotalCards,
          predicted_first_scorer: pFirstScorer,
          predicted_highest_scoring_half: pHalfPick,
          predicted_clean_sheet: pCleanPick,
          predicted_penalties: pPenalties,
        }, match);

        await env.db.prepare(`
          UPDATE predictions
          SET
            points_winner = ?, points_ou = ?, points_score = ?, points_cards_ou = ?,
            points_total_cards = ?, points_first_scorer = ?, points_highest_scoring_half = ?,
            points_clean_sheet = ?, points_penalties = ?, total_points = ?
          WHERE participant_id = ? AND match_id = ?
        `).bind(
          pts.points_winner, pts.points_ou, pts.points_score, pts.points_cards_ou,
          pts.points_total_cards, pts.points_first_scorer, pts.points_highest_scoring_half,
          pts.points_clean_sheet, pts.points_penalties, pts.total_points,
          participantId, matchId
        ).run();

        await recomputeAllCaches(env.db);
      }

      await emitEvent(env.db, 'predictions_updated');

      await flushLogs(env.db);
      return new Response(JSON.stringify({
        success: true,
        prediction: {
          participant_id: participantId,
          match_id: matchId,
          predicted_winner: predictedWinner,
          predicted_over_under: predictedOverUnder,
          predicted_home_score: pHomeScore,
          predicted_away_score: pAwayScore,
          predicted_total_cards: pTotalCards,
          predicted_first_scorer: pFirstScorer,
          predicted_highest_scoring_half: pHalfPick,
          predicted_clean_sheet: pCleanPick,
          predicted_penalties: pPenalties,
          points_winner: 0,
          points_ou: 0,
          points_score: 0,
          total_points: 0,
        }
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
  } catch (error) {
    await flushLogs(env.db);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
