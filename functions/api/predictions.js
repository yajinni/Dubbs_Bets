// Cloudflare Pages Functions: API route to retrieve and submit predictions (GET, POST)
import { checkAndInitDb, logChange, emitEvent, bumpVersion, recomputeAllCaches, calculatePointsFromPrediction, flushLogs } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function isPositiveIntegerId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0;
}

function isEnumValue(value, allowed) {
  return allowed.includes(value);
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

      if (!isPositiveIntegerId(participantId)) {
        return new Response(JSON.stringify({ error: 'Participant ID must be a positive integer' }), { status: 400, headers });
      }
      if (!isPositiveIntegerId(matchId)) {
        return new Response(JSON.stringify({ error: 'Match ID must be a positive integer' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedWinner, ['home', 'away', 'draw'])) {
        return new Response(JSON.stringify({ error: 'Predicted winner must be home, away, or draw' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedOverUnder, ['over', 'under'])) {
        return new Response(JSON.stringify({ error: 'Predicted over/under must be over or under' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(predictedHomeScore) || !isNonNegativeInteger(predictedAwayScore)) {
        return new Response(JSON.stringify({ error: 'Predicted scores must be non-negative integers' }), { status: 400, headers });
      }
      if (!isNonNegativeInteger(predictedTotalCards)) {
        return new Response(JSON.stringify({ error: 'Predicted total cards must be a non-negative integer' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedFirstScorer, ['home', 'away', 'none'])) {
        return new Response(JSON.stringify({ error: 'Predicted first scorer must be home, away, or none' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedHighestScoringHalf, ['first', 'second', 'equal'])) {
        return new Response(JSON.stringify({ error: 'Predicted highest scoring half must be first, second, or equal' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedCleanSheet, ['yes', 'no'])) {
        return new Response(JSON.stringify({ error: 'Predicted clean sheet must be yes or no' }), { status: 400, headers });
      }
      if (!isEnumValue(predictedPenalties, ['yes', 'no'])) {
        return new Response(JSON.stringify({ error: 'Predicted penalties must be yes or no' }), { status: 400, headers });
      }

      const participantIdInt = Number(participantId);
      const matchIdInt = Number(matchId);

      // 1. Fetch match with team info (merged query)
      const match = await env.db.prepare(`
        SELECT m.local_date, m.status, m.finished, m.home_score, m.away_score, m.home_ht_score, m.away_ht_score, m.over_under_line, m.actual_cards, m.actual_first_scorer, m.actual_penalties, m.home_win_pct, m.away_win_pct, m.home_team_name, m.away_team_name, t1.fifa_code AS home_code, t2.fifa_code AS away_code
        FROM matches m
        LEFT JOIN teams t1 ON m.home_team_id = t1.id
        LEFT JOIN teams t2 ON m.away_team_id = t2.id
        WHERE m.id = ?
      `).bind(matchIdInt).first();

      if (!match) {
        return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
      }

      // 2. Lock prediction if match has started
      const matchStartTime = new Date(match.local_date).getTime();
      const currentTime = Date.now();

      if (currentTime >= matchStartTime || match.status !== 'scheduled' || match.finished === 1) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      // Validate inputs
      const pHomeScore = Number(predictedHomeScore);
      const pAwayScore = Number(predictedAwayScore);
      const pTotalCards = Number(predictedTotalCards);
      const pFirstScorer = predictedFirstScorer;
      const pHalfPick = predictedHighestScoringHalf;
      const pCleanPick = predictedCleanSheet;
      const pPenalties = predictedPenalties;

      // Get participant name
      const participant = await env.db.prepare('SELECT name FROM participants WHERE id = ?').bind(participantIdInt).first();
      if (!participant) {
        return new Response(JSON.stringify({ error: 'Participant not found' }), { status: 404, headers });
      }
      const participantName = participant.name;

      const homeCode = match?.home_code || match?.home_team_name.substring(0, 3).toUpperCase() || 'HOM';
      const awayCode = match?.away_code || match?.away_team_name.substring(0, 3).toUpperCase() || 'AWA';
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // 3. Upsert prediction
      const checkQuery = 'SELECT * FROM predictions WHERE participant_id = ? AND match_id = ?';
      const existing = await env.db.prepare(checkQuery).bind(participantIdInt, matchIdInt).first();

      // Log changes
      const changes = [];
      
      const oldWinner = existing ? existing.predicted_winner : null;
      const newWinner = predictedWinner || null;
      if (oldWinner !== newWinner) {
        changes.push(`Winner: ${oldWinner || 'None'} -> ${newWinner}`);
      }

      const oldOU = existing ? existing.predicted_over_under : null;
      const newOU = predictedOverUnder || null;
      if (oldOU !== newOU) {
        changes.push(`O/U: ${oldOU || 'None'} -> ${newOU}`);
      }

      const oldHome = existing ? existing.predicted_home_score : null;
      const oldAway = existing ? existing.predicted_away_score : null;
      const oldScore = (oldHome !== null && oldAway !== null) ? `${oldHome}-${oldAway}` : null;
      const newScore = (pHomeScore !== null && pAwayScore !== null) ? `${pHomeScore}-${pAwayScore}` : null;
      if (oldScore !== newScore) {
        changes.push(`Score: ${oldScore || 'None'} -> ${newScore}`);
      }

      const oldCards = existing ? existing.predicted_total_cards : null;
      const newCards = pTotalCards;
      if (oldCards !== newCards) {
        changes.push(`Cards: ${oldCards === null ? 'None' : oldCards} -> ${newCards === null ? 'None' : newCards}`);
      }

      const oldFirstScorer = existing ? existing.predicted_first_scorer : null;
      const newFirstScorer = pFirstScorer;
      if (oldFirstScorer !== newFirstScorer) {
        changes.push(`First Scorer: ${oldFirstScorer || 'None'} -> ${newFirstScorer || 'None'}`);
      }

      const oldHalf = existing ? existing.predicted_highest_scoring_half : null;
      const newHalf = pHalfPick;
      if (oldHalf !== newHalf) {
        changes.push(`Highest Scoring Half: ${oldHalf || 'None'} -> ${newHalf || 'None'}`);
      }

      const oldClean = existing ? existing.predicted_clean_sheet : null;
      const newClean = pCleanPick;
      if (oldClean !== newClean) {
        changes.push(`Clean Sheet: ${oldClean || 'None'} -> ${newClean || 'None'}`);
      }

      const oldPenalties = existing ? existing.predicted_penalties : null;
      const newPenalties = pPenalties;
      if (oldPenalties !== newPenalties) {
        changes.push(`Penalties: ${oldPenalties || 'None'} -> ${newPenalties || 'None'}`);
      }

      const nowIso = new Date().toISOString();
      let writeResult;
      if (existing) {
        writeResult = await env.db.prepare(`
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
        `).bind(predictedWinner, predictedOverUnder, pHomeScore, pAwayScore, pTotalCards, pFirstScorer, pHalfPick, pCleanPick, pPenalties, participantIdInt, matchIdInt, matchIdInt, nowIso).run();
      } else {
        writeResult = await env.db.prepare(`
          INSERT INTO predictions (participant_id, match_id, predicted_winner, predicted_over_under, predicted_home_score, predicted_away_score, predicted_total_cards, predicted_first_scorer, predicted_highest_scoring_half, predicted_clean_sheet, predicted_penalties)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM matches
            WHERE id = ?
              AND status = 'scheduled'
              AND finished = 0
              AND datetime(local_date) > datetime(?)
          )
        `).bind(participantIdInt, matchIdInt, predictedWinner, predictedOverUnder, pHomeScore, pAwayScore, pTotalCards, pFirstScorer, pHalfPick, pCleanPick, pPenalties, matchIdInt, nowIso).run();
      }

      if ((writeResult.meta?.changes || 0) === 0 && changes.length > 0) {
        return new Response(JSON.stringify({ error: 'Predictions are locked. This match has already started or finished.' }), { status: 403, headers });
      }

      if (changes.length > 0) {
        const actionType = existing ? 'updated' : 'submitted';
        const description = `${participantName} ${actionType} prediction for ${matchLabel}`;
        const oldValue = existing ? 'Existing prediction' : 'None';
        const newValue = changes.join(', ');
        await logChange(env.db, 'prediction', matchIdInt, participantIdInt, description, oldValue, newValue);
        await bumpVersion(env.db, 'predictions');
      }

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
          participantIdInt, matchIdInt
        ).run();

        await recomputeAllCaches(env.db);
      }

      await emitEvent(env.db, 'predictions_updated');

      await flushLogs(env.db);
      return new Response(JSON.stringify({
        success: true,
        prediction: {
          participant_id: participantIdInt,
          match_id: matchIdInt,
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
