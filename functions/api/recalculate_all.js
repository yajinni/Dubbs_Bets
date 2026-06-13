import { checkAndInitDb } from './db_helper.js';

export async function onRequest(context) {
  const { env } = context;
  try {
    await checkAndInitDb(env.db);

    // Get all matches that are finished
    const { results: matches } = await env.db.prepare('SELECT * FROM matches WHERE finished = 1').all();
    let updatedPredictionsCount = 0;

    for (const m of matches) {
      const homeScore = m.home_score;
      const awayScore = m.away_score;
      const ouLine = m.over_under_line;
      const cardsLine = m.cards_line || 3.5;
      const actualCards = m.actual_cards;
      const actualFirstScorer = m.actual_first_scorer;
      const homeWinPct = m.home_win_pct;
      const awayWinPct = m.away_win_pct;
      const drawWinPct = m.draw_pct;
      const homeHtScore = m.home_ht_score;
      const awayHtScore = m.away_ht_score;

      let winner = 'draw';
      if (homeScore > awayScore) winner = 'home';
      else if (awayScore > homeScore) winner = 'away';

      const totalGoals = homeScore + awayScore;
      const ouResult = totalGoals > ouLine ? 'over' : 'under';

      let winnerHalf = null;
      if (homeHtScore !== null && homeHtScore !== undefined && awayHtScore !== null && awayHtScore !== undefined) {
        const firstHalfGoals = homeHtScore + awayHtScore;
        const secondHalfGoals = totalGoals - firstHalfGoals;
        if (firstHalfGoals > secondHalfGoals) winnerHalf = 'first';
        else if (secondHalfGoals > firstHalfGoals) winnerHalf = 'second';
        else winnerHalf = 'equal';
      }

      const cleanSheetHappened = (homeScore === 0 || awayScore === 0) ? 'yes' : 'no';

      const { results: predictions } = await env.db.prepare('SELECT * FROM predictions WHERE match_id = ?').bind(m.id).all();

      for (const pred of predictions) {
        const pWinner = pred.predicted_winner === winner ? 3 : 0;
        const pOu = pred.predicted_over_under === ouResult ? 1 : 0;
        const pScore = (pred.predicted_home_score === homeScore && pred.predicted_away_score === awayScore) ? 1 : 0;

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

        await env.db.prepare(`
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
          m.id
        ).run();

        updatedPredictionsCount++;
      }
    }

    return new Response(JSON.stringify({ success: true, message: `Successfully updated ${updatedPredictionsCount} predictions.` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
