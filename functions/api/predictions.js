// Cloudflare Pages Functions: API route to retrieve and submit predictions (GET, POST)
import { checkAndInitDb, logChange, emitEvent, bumpVersion, recomputeAllCaches, calculatePointsFromPrediction, flushLogs } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
function isEnumValue(v, allowed) {
  return typeof v === 'string' && allowed.includes(v);
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

      // 1. Validate IDs before any DB query.
      if (!isPositiveIntegerId(participantId)) {
        return new Response(JSON.stringify({ error: 'Participant ID must be a positive integer' }), { status: 400, headers });
      }
      if (!isPositiveIntegerId(matchId)) {
        return new Response(JSON.stringify({ error: 'Match ID must be a positive integer' }), { status: 400, headers });
      }

      // 2. Validate prediction payload.
      if (!isEnumValue(predictedWinner, ['home', 'away', 'draw'])) {
        return new Response(JSON.stringify({ error: 'predictedWinner must be one of: home, away, draw' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedOverUnder, ['over', 'under'])) {
        return new Response(JSON.stringify({ error: 'predictedOverUnder must be one of: over, under' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(predictedHomeScore)) {
        return new Response(JSON.stringify({ error: 'predictedHomeScore must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(predictedAwayScore)) {
        return new Response(JSON.stringify({ error: 'predictedAwayScore must be a non-negative integer' }), { status: 400, headers });
      }
      // predictedTotalCards is optional (null/empty allowed); if provided it must be a non-negative integer.
      const pTotalCards = (predictedTotalCards !== null && predictedTotalCards !== undefined && predictedTotalCards !== '')
        ? Number(predictedTotalCards)
        : null;
      if (pTotalCards !== null && !isNonNegativeInteger(pTotalCards)) {
        return new Response(JSON.stringify({ error: 'predictedTotalCards must be a non-negative integer' }), { status: 400, headers });
      }

      if (!isEnumValue(predictedFirstScorer, ['home', 'away', 'none'])) {
        return new Response(JSON.stringify({ error: 'predictedFirstScorer must be one of: home, away, none' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedHighestScoringHalf, ['first', 'second', 'equal'])) {
        return new Response(JSON.stringify({ error: 'predictedHighestScoringHalf must be one of: first, second, equal' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedCleanSheet, ['yes', 'no'])) {
        return new Response(JSON.stringify({ error: 'predictedCleanSheet must be one of: yes, no' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedPenalties, ['yes', 'no'])) {
        return new Response(JSON.stringify({ error: 'predictedPenalties must be one of: yes, no' }), { status: 400, headers });
      }

      const pHomeScore = Number(predictedHomeScore);
      const pAwayScore = Number(predictedAwayScore);
      const pFirstScorer = predictedFirstScorer;
      const pHalfPick = predictedHighestScoringHalf;
      const pCleanPick = predictedCleanSheet;
      const pPenalties = predictedPenalties;

      // 3. Fetch match with team info (merged query) for context + user-friendly lock message.
      const match = await env.db.prepare(`
        SELECT m.local_date, m.status, m.finished, m.home_score, m.away_score, m.home_ht_score, m.away_ht_score, m.over_under_line, m.actual_cards, m.actual_first_scorer, m.actual_penalties, m.home_win_pct, m.away_win_pct, m.home_team_name, m.away_team_name, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchId).first();

      if (!match) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      // 4. Early lock check for a user-friendly error message.
      const matchStartTime = new Date(match.local_date).getTime();
      const currentTime = Date.now();

      if (currentTime >= matchStartTime || match.status !== 'scheduled' || match.finished === 1) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      // 5. Participant must exist before writing.
      const participant = await env.db.prepare('SELECT name FROM participants WHERE id = ?').bind(participantId).first();
      if (!participant) {
        return new Response(JSON.stringify({ error: 'Participant not found' }), { status: 404, headers });
      }
      const participantName = participant.name;

      const homeCode = match?.home_code || match?.home_team_name.substring(0, 3).toUpperCase() || 'HOM';
      const awayCode = match?.away_code || match?.away_team_name.substring(0, 3).toUpperCase() || 'AWA';
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // 6. Conditional write: only succeeds if the match is still scheduled, not finished,
      //    and kickoff is in the future. This closes the read/write race.
      const nowIso = new Date().toISOString();
      const checkQuery = 'SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?';
      const existing = await env.db.prepare(checkQuery).bind(participantId, matchId).first();

      // Compute change diff BEFORE writing; only log if the write actually succeeds.
      const changes = [];

      const oldWinner = existing ? existing.predicted_winner : null;
      if (oldWinner !== predictedWinner) {
        changes.push(`Winner: ${oldWinner || 'None'} -> ${predictedWinner}`);
      }

      const oldOU = existing ? existing.predicted_over_under : null;
      if (oldOU !== predictedOverUnder) {
        changes.push(`O/U: ${oldOU || 'None'} -> ${predictedOverUnder}`);
      }

      const oldHome = existing ? existing.predicted_home_score : null;
      const oldAway = existing ? existing.predicted_away_score : null;
      const oldScore = (oldHome !== null && oldAway !== null) ? `${oldHome}-${oldAway}` : null;
      const newScore = (pHomeScore !== null && pAwayScore !== null) ? `${pHomeScore}-${pAwayScore}` : null;
      if (oldScore !== newScore) {
        changes.push(`Score: ${oldScore || 'None'} -> ${newScore}`);
      }

      const oldCards = existing ? existing.predicted_total_cards : null;
      if (oldCards !== pTotalCards) {
        changes.push(`Cards: ${oldCards === null ? 'None' : oldCards} -> ${pTotalCards === null ? 'None' : pTotalCards}`);
      }

      const oldFirstScorer = existing ? existing.predicted_first_scorer : null;
      if (oldFirstScorer !== pFirstScorer) {
        changes.push(`First Scorer: ${oldFirstScorer || 'None'} -> ${pFirstScorer || 'None'}`);
      }

      const oldHalf = existing ? existing.predicted_highest_scoring_half : null;
      if (oldHalf !== pHalfPick) {
        changes.push(`Highest Scoring Half: ${oldHalf || 'None'} -> ${pHalfPick || 'None'}`);
      }

      const oldClean = existing ? existing.predicted_clean_sheet : null;
      if (oldClean !== pCleanPick) {
        changes.push(`Clean Sheet: ${oldClean || 'None'} -> ${pCleanPick || 'None'}`);
      }

      const oldPenalties = existing ? existing.predicted_penalties : null;
      if (oldPenalties !== pPenalties) {
        changes.push(`Penalties: ${oldPenalties || 'None'} -> ${pPenalties || 'None'}`);
      }

      let writeResult;
      if (existing) {
        // Conditional UPDATE: only applies if the match is still unlocked at write time.
        const updateQuery = `
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
        writeResult = await env.db.prepare(updateQuery)
          .bind(predictedWinner, predictedOverUnder, pHomeScore, pAwayScore, pTotalCards, pFirstScorer, pHalfPick, pCleanPick, pPenalties, participantId, matchId, matchId, nowIso)
          .run();
      } else {
        // Conditional INSERT: only inserts if the match is still unlocked at write time.
        const insertQuery = `
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
        writeResult = await env.db.prepare(insertQuery)
          .bind(participantId, matchId, predictedWinner, predictedOverUnder, pHomeScore, pAwayScore, pTotalCards, pFirstScorer, pHalfPick, pCleanPick, pPenalties, matchId, nowIso)
          .run();
      }

      const rowsChanged = writeResult?.meta?.changes || 0;

      // Zero rows changed means the match locked between read and write (race) -> reject.
      if (rowsChanged === 0) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      // Conditional write succeeded: bump version and log the change.
      await bumpVersion(env.db, 'predictions');

      if (changes.length > 0) {
        const actionType = existing ? 'updated' : 'submitted';
        const description = `${participantName} ${actionType} prediction for ${matchLabel}`;
        const oldValue = existing ? 'Existing prediction' : 'None';
        const newValue = changes.join(', ');
        await logChange(env.db, 'prediction', matchId, participantId, description, oldValue, newValue);
      }

      // Points recalculation only runs when the match was already finished; with the
      // conditional write above a finished match can no longer be written here, so this
      // branch is kept for completeness and legacy safety.
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
