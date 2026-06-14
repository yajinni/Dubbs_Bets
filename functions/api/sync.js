// Cloudflare Pages Functions: API route to sync matches, scores, and odds from API-Football
import { checkAndInitDb, logChange, formatOuPct } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    const checkOnly = url.searchParams.get('checkOnly') === 'true';
    if (checkOnly) {
      const lastSyncSetting = await env.db.prepare("SELECT value FROM settings WHERE key = 'last_sync'").first();
      return new Response(JSON.stringify({ 
        success: true, 
        last_sync: lastSyncSetting ? lastSyncSetting.value : null
      }), { status: 200, headers });
    }

    // Verify secret key if configured in environment (allow same-origin browser requests to bypass)
    const clientSecret = url.searchParams.get('secret');
    const secFetchSite = request.headers.get('sec-fetch-site');
    const isSameOrigin = secFetchSite === 'same-origin' || secFetchSite === 'same-site';
    const isDiagnostic = url.searchParams.get('checkBets') === 'true' || url.searchParams.get('checkOddsFixture') !== null;

    if (!isDiagnostic && env.SYNC_SECRET && env.SYNC_SECRET !== '' && !isSameOrigin && clientSecret !== env.SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid sync secret' }), { status: 401, headers });
    }

    // Handle QStash task webhooks
    const lockMatchId = url.searchParams.get('lockMatchId');
    if (lockMatchId) {
      const apiKeyOdds = env.THE_ODDS_API_KEY;
      if (!apiKeyOdds) {
        return new Response(JSON.stringify({ error: 'THE_ODDS_API_KEY is missing' }), { status: 400, headers });
      }
      await logChange(env.db, 'system', parseInt(lockMatchId), null, 'QStash Webhook Received: Lock Match Odds', null, `Match ID: ${lockMatchId}`);
      await handleLockMatchTask(env.db, parseInt(lockMatchId), apiKeyOdds);
      return new Response(JSON.stringify({ success: true, message: `Match ${lockMatchId} odds locked.` }), { status: 200, headers });
    }

    const scoreMatchId = url.searchParams.get('scoreMatchId');
    if (scoreMatchId) {
      const pagesUrl = env.PAGES_URL || "https://dubbs-bets.pages.dev";
      await logChange(env.db, 'system', parseInt(scoreMatchId), null, 'QStash Webhook Received: Score Match & Recalculate Predictions', null, `Match ID: ${scoreMatchId}`);
      await handleScoreMatchTask(env.db, parseInt(scoreMatchId), env.QSTASH_TOKEN, pagesUrl, env.SYNC_SECRET, env.QSTASH_URL);
      return new Response(JSON.stringify({ success: true, message: `Match ${scoreMatchId} scores synced and predictions scored.` }), { status: 200, headers });
    }

    // Diagnostic Helpers
    const apiKeyFootball = env.API_FOOTBALL_KEY;
    const checkBets = url.searchParams.get('checkBets') === 'true';
    if (checkBets) {
      if (!apiKeyFootball) {
        return new Response(JSON.stringify({ error: 'API_FOOTBALL_KEY environment variable is missing or empty.' }), { status: 400, headers });
      }
      const betsRes = await fetch(`https://v3.football.api-sports.io/odds/bets`, {
        headers: { 'x-apisports-key': apiKeyFootball }
      });
      const betsData = await betsRes.json();
      return new Response(JSON.stringify(betsData), { status: 200, headers });
    }

    const checkOddsFixture = url.searchParams.get('checkOddsFixture');
    if (checkOddsFixture) {
      if (!apiKeyFootball) {
        return new Response(JSON.stringify({ error: 'API_FOOTBALL_KEY environment variable is missing or empty.' }), { status: 400, headers });
      }
      const oddsRes = await fetch(`https://v3.football.api-sports.io/odds?fixture=${checkOddsFixture}`, {
        headers: { 'x-apisports-key': apiKeyFootball }
      });
      const oddsData = await oddsRes.json();
      return new Response(JSON.stringify(oddsData), { status: 200, headers });
    }

    // 1. Check if we should sync
    const lastSyncSetting = await env.db.prepare("SELECT value FROM settings WHERE key = 'last_sync'").first();
    const lastSyncTime = lastSyncSetting ? new Date(lastSyncSetting.value).getTime() : 0;
    const currentTime = Date.now();
    const sixHoursInMs = 6 * 60 * 60 * 1000; // 6 hours

    let shouldSync = force || (currentTime - lastSyncTime >= sixHoursInMs);
    let reason = 'Sync skipped. Updated within the last 6 hours.';

    if (!shouldSync) {
      const { results: dbMatches } = await env.db.prepare('SELECT local_date, finished FROM matches WHERE finished = 0').all();
      const activeMatchInWindow = dbMatches.some(m => {
        const matchTime = new Date(m.local_date).getTime();
        const elapsedMinutes = (currentTime - matchTime) / (60 * 1000);
        return elapsedMinutes >= 105 && elapsedMinutes < 300;
      });

      if (activeMatchInWindow) {
        shouldSync = true;
        reason = 'Sync triggered: Active match in the 105-minute post-start window.';
      }
    }

    if (!shouldSync) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: reason,
        last_sync: lastSyncSetting ? lastSyncSetting.value : null
      }), { status: 200, headers });
    }

    // 2. Perform Sync
    const apiKeyOdds = env.THE_ODDS_API_KEY;
    const skipOdds = url.searchParams.get('skipOdds') === 'true';
    let syncResults = { source: 'espn', matchesUpdated: 0, oddsUpdated: 0 };

    const trigger = url.searchParams.get('trigger') || (force ? 'manual_force' : 'web_request');
    await logChange(env.db, 'system', null, null, `Sync Started (${trigger})`, null, `skipOdds: ${skipOdds}`);

    // Run actual sync. If it fails, let the error propagate.
    syncResults = await syncFromESPN(env.db, env.QSTASH_TOKEN, env.QSTASH_URL);

    if (!skipOdds && apiKeyOdds && apiKeyOdds !== '') {
      try {
        const oddsResults = await syncFromTheOddsAPI(env.db, apiKeyOdds);
        syncResults.oddsUpdated = oddsResults.oddsUpdated;
        syncResults.source += ' + the-odds-api';
      } catch (err) {
        console.error('The Odds API sync failed:', err.message);
        syncResults.oddsError = err.message;
      }
    }

    // 2.5 Schedule QStash jobs for future unscheduled matches if QStash token is configured
    if (env.QSTASH_TOKEN) {
      const pagesUrl = env.PAGES_URL || "https://dubbs-bets.pages.dev";
      try {
        await checkAndScheduleQStashJobs(env.db, env.QSTASH_TOKEN, pagesUrl, env.SYNC_SECRET, env.QSTASH_URL);
      } catch (err) {
        console.error('Failed to schedule QStash jobs:', err.message);
      }
    }
    // 3. Update last sync time
    const isoString = new Date().toISOString();
    await env.db.prepare("UPDATE settings SET value = ? WHERE key = 'last_sync'").bind(isoString).run();

    await logChange(env.db, 'system', null, null, `Sync Completed successfully`, null, `Updated: ${syncResults.matchesUpdated} matches, ${syncResults.oddsUpdated} odds. Source: ${syncResults.source}`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Sync completed successfully.',
      sync_time: isoString,
      results: syncResults
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

// --------------------------------------------------------
// API-Football Sync Implementation
// --------------------------------------------------------
// Helper to normalize team names for ESPN matching
function normalizeTeamName(name) {
  let n = name.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // strip accents (e.g. Curaçao -> curacao)
  
  // Clean database encoding anomalies like 'CuraÃ§ao'
  if (n.includes('curaã§ao') || n.includes('cura') && n.includes('ao')) {
    n = 'curacao';
  }

  if (n.includes('czech') || n === 'czechia') return 'czech';
  if (n.includes('korea')) return 'korea';
  if (n.includes('united states') || n === 'usa') return 'usa';
  if (n.includes('bosnia')) return 'bosnia';
  if (n.includes('turkey') || n.includes('turkiye')) return 'turkey';
  if (n.includes('congo') || n.includes('drc')) return 'congo';
  if (n.includes('curacao')) return 'curacao';
  return n;
}

// --------------------------------------------------------
// ESPN Scoreboard Sync Implementation (Free, Keyless)
// --------------------------------------------------------
async function syncFromESPN(db, qstashToken = null, qstashUrl = null) {
  console.log('Syncing from ESPN Scoreboard API...');
  const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard');
  const data = await res.json();
  const events = data.events || [];
  
  const { results: dbMatches } = await db.prepare('SELECT * FROM matches').all();
  let matchesUpdated = 0;
  
  for (const event of events) {
    const comp = event.competitions[0];
    if (!comp) continue;
    
    const homeCompetitor = comp.competitors.find(c => c.homeAway === 'home');
    const awayCompetitor = comp.competitors.find(c => c.homeAway === 'away');
    if (!homeCompetitor || !awayCompetitor) continue;
    
    const homeName = homeCompetitor.team.name;
    const awayName = awayCompetitor.team.name;
    
    // Find matching match in the database
    const dbMatch = dbMatches.find(m => {
      const dbHome = normalizeTeamName(m.home_team_name);
      const dbAway = normalizeTeamName(m.away_team_name);
      const espnHome = normalizeTeamName(homeName);
      const espnAway = normalizeTeamName(awayName);
      return (dbHome === espnHome && dbAway === espnAway);
    });
    
    if (dbMatch) {
      const homeScore = parseInt(homeCompetitor.score) || 0;
      const awayScore = parseInt(awayCompetitor.score) || 0;
      
      const state = comp.status?.type?.state;
      const completed = comp.status?.type?.completed;
      
      let status = 'scheduled';
      if (state === 'in') status = 'live';
      else if (state === 'post') status = 'finished';
      
      const finished = completed ? 1 : 0;
      
      // Parse details/timeline for Halftime scores, Cards, and First Scorer
      let homeHtScore = 0;
      let awayHtScore = 0;
      let actualFirstScorer = 'none';
      let firstGoalTime = Infinity;
      let actualCards = 0;
      
      const details = comp.details || [];
      for (const detail of details) {
        // Count cards
        if (detail.yellowCard || detail.redCard) {
          actualCards++;
        }
        
        // Process goals
        const isGoal = detail.scoringPlay || (detail.type && detail.type.text.toLowerCase().includes('goal'));
        if (isGoal) {
          const isHome = detail.team?.id === homeCompetitor.team?.id;
          const clockVal = detail.clock?.value || 0;
          
          // Halftime score (clock value <= 2700 seconds/45 minutes)
          if (clockVal <= 2700) {
            if (isHome) homeHtScore++;
            else awayHtScore++;
          }
          
          // First scorer
          if (clockVal < firstGoalTime) {
            firstGoalTime = clockVal;
            actualFirstScorer = isHome ? 'home' : 'away';
          }
        }
      }
      
      // If live and no goals yet, keep first scorer as null
      if (!finished && actualFirstScorer === 'none') {
        actualFirstScorer = null;
      }
      
      // If scheduled, keep everything clean/null
      if (status === 'scheduled') {
        homeHtScore = null;
        awayHtScore = null;
        actualFirstScorer = null;
        actualCards = null;
      }
      
      // Update kickoff time from ESPN sync if it changed
      const dbKickoff = new Date(dbMatch.local_date).getTime();
      const espnKickoff = new Date(event.date).getTime();
      let newLocalDate = dbMatch.local_date;
      let dateChanged = false;
      if (dbKickoff !== espnKickoff) {
        newLocalDate = new Date(event.date).toISOString();
        dateChanged = true;
      }

      if (dateChanged) {
        const matchLabel = `${dbMatch.home_team_name} vs ${dbMatch.away_team_name}`;
        console.log(`[Sync] Kickoff time changed for match ${dbMatch.id} (${matchLabel}). Old: ${dbMatch.local_date}, New: ${newLocalDate}. Rescheduling QStash triggers.`);
        await logChange(db, 'match_time', dbMatch.id, null, `${matchLabel} Kickoff Time Changed`, dbMatch.local_date, newLocalDate);

        if (qstashToken) {
          if (dbMatch.qstash_lock_msg_id) {
            await cancelQStashMessage(db, dbMatch.qstash_lock_msg_id, qstashToken, qstashUrl);
          }
          if (dbMatch.qstash_score_msg_id) {
            await cancelQStashMessage(db, dbMatch.qstash_score_msg_id, qstashToken, qstashUrl);
          }
        }
      }

      // Update D1 database
      await db.prepare(`
        UPDATE matches
        SET
          home_score = ?,
          away_score = ?,
          home_ht_score = ?,
          away_ht_score = ?,
          status = ?,
          finished = ?,
          actual_cards = ?,
          actual_first_scorer = ?,
          espn_event_id = ?,
          local_date = ?,
          qstash_scheduled = ?,
          qstash_lock_msg_id = ?,
          qstash_score_msg_id = ?
        WHERE id = ?
      `).bind(
        homeScore,
        awayScore,
        homeHtScore,
        awayHtScore,
        status,
        finished,
        actualCards,
        actualFirstScorer,
        event.id,
        newLocalDate,
        dateChanged ? 0 : dbMatch.qstash_scheduled,
        dateChanged ? null : dbMatch.qstash_lock_msg_id,
        dateChanged ? null : dbMatch.qstash_score_msg_id,
        dbMatch.id
      ).run();
      
      // Recalculate predictions if the match has finished
      if (finished === 1) {
        await recalculateMatchPredictionsInSync(
          db, 
          dbMatch.id, 
          homeScore, 
          awayScore, 
          dbMatch.over_under_line,
          dbMatch.cards_line || 3.5,
          actualCards,
          actualFirstScorer,
          dbMatch.home_win_pct,
          dbMatch.away_win_pct,
          dbMatch.draw_pct,
          homeHtScore,
          awayHtScore
        );
      } else {
        // Reset prediction points to 0 since match is not finished
        await db.prepare(`
          UPDATE predictions
          SET
            points_winner = 0,
            points_ou = 0,
            points_score = 0,
            points_cards_ou = 0,
            points_total_cards = 0,
            points_first_scorer = 0,
            points_highest_scoring_half = 0,
            points_clean_sheet = 0,
            total_points = 0
          WHERE match_id = ?
        `).bind(dbMatch.id).run();
      }
      
      matchesUpdated++;
    }
  }
  
  return { source: 'espn', matchesUpdated, oddsUpdated: 0 };
}


// --------------------------------------------------------
// Prediction Point Distribution
// --------------------------------------------------------
async function recalculateMatchPredictionsInSync(db, matchId, homeScore, awayScore, ouLine, cardsLine, actualCards, actualFirstScorer, homeWinPct, awayWinPct, drawWinPct, homeHtScore, awayHtScore) {
  let winner = 'draw';
  if (homeScore > awayScore) winner = 'home';
  else if (awayScore > homeScore) winner = 'away';

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

// --------------------------------------------------------
// The Odds API Sync Implementation
// --------------------------------------------------------
async function syncFromTheOddsAPI(db, apiKey) {
  console.log('Syncing from The Odds API...');
  const sportKey = 'soccer_fifa_world_cup';
  
  // 1. Fetch Odds & Fixtures
  const oddsRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,totals&oddsFormat=decimal`);
  const oddsData = await oddsRes.json();
  
  if (oddsRes.status !== 200) {
    throw new Error(`The Odds API odds error: ${JSON.stringify(oddsData)}`);
  }
  
  
  const { results: dbMatches } = await db.prepare(`
    SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
    FROM matches m
    LEFT JOIN teams t1 ON m.home_team_id = t1.id
    LEFT JOIN teams t2 ON m.away_team_id = t2.id
  `).all();
  let matchesUpdated = 0;
  let oddsUpdated = 0;
  
  // 1. Process Odds and Schedules (loop over all matches returned in oddsData)
  for (const match of oddsData) {
    const dbMatch = dbMatches.find(m => 
      m.home_team_name.toLowerCase() === match.home_team.toLowerCase() && 
      m.away_team_name.toLowerCase() === match.away_team.toLowerCase()
    );
    
    if (dbMatch) {
      if (dbMatch.odds_locked === 1) {
        continue;
      }
      let homePct = dbMatch.home_win_pct;
      let awayPct = dbMatch.away_win_pct;
      let drawPct = dbMatch.draw_pct;
      let ouLine = dbMatch.over_under_line;
      let overOdds = dbMatch.over_odds;
      let underOdds = dbMatch.under_odds;
      
      if (match.bookmakers && match.bookmakers.length > 0) {
        const bookmaker = match.bookmakers.find(b => {
          const markets = b.markets || [];
          return markets.some(mk => mk.key === 'h2h') && markets.some(mk => mk.key === 'totals');
        }) || match.bookmakers[0];
        
        if (bookmaker) {
          const h2h = bookmaker.markets.find(mk => mk.key === 'h2h');
          if (h2h) {
            const homeOutcome = h2h.outcomes.find(o => o.name === match.home_team);
            const awayOutcome = h2h.outcomes.find(o => o.name === match.away_team);
            const drawOutcome = h2h.outcomes.find(o => o.name === 'Draw');
            
            if (homeOutcome && awayOutcome && drawOutcome) {
              const pHome = 1.0 / homeOutcome.price;
              const pAway = 1.0 / awayOutcome.price;
              const pDraw = 1.0 / drawOutcome.price;
              const sum = pHome + pAway + pDraw;
              homePct = Math.round((pHome / sum) * 1000) / 10;
              awayPct = Math.round((pAway / sum) * 1000) / 10;
              drawPct = Math.round((pDraw / sum) * 1000) / 10;
              oddsUpdated++;
            }
          }
          
          const totals = bookmaker.markets.find(mk => mk.key === 'totals');
          if (totals) {
            const overOutcome = totals.outcomes.find(o => o.name === 'Over');
            const underOutcome = totals.outcomes.find(o => o.name === 'Under');
            if (overOutcome) {
              ouLine = overOutcome.point;
              overOdds = overOutcome.price;
            }
            if (underOutcome) {
              underOdds = underOutcome.price;
            }
          }
        }
      }
      
      const homeCode = dbMatch.home_code || dbMatch.home_team_name.substring(0, 3).toUpperCase();
      const awayCode = dbMatch.away_code || dbMatch.away_team_name.substring(0, 3).toUpperCase();
      const matchLabel = `${homeCode} vs ${awayCode}`;

      // Log Winner probabilities change
      if (dbMatch.home_win_pct !== homePct || dbMatch.away_win_pct !== awayPct || dbMatch.draw_pct !== drawPct) {
        const oldVal = `H: ${dbMatch.home_win_pct}%, D: ${dbMatch.draw_pct}%, A: ${dbMatch.away_win_pct}%`;
        const newVal = `H: ${homePct}%, D: ${drawPct}%, A: ${awayPct}%`;
        await logChange(db, 'odds', dbMatch.id, null, `${matchLabel} Winner`, oldVal, newVal);
      }

      // Log Goals O/U changes (combined line and odds)
      if (dbMatch.over_under_line !== ouLine || dbMatch.over_odds !== overOdds || dbMatch.under_odds !== underOdds) {
        const oldVal = `Line: ${dbMatch.over_under_line}, ${formatOuPct(dbMatch.over_odds, dbMatch.under_odds)}`;
        const newVal = `Line: ${ouLine}, ${formatOuPct(overOdds, underOdds)}`;
        await logChange(db, 'odds', dbMatch.id, null, `${matchLabel} O/U Goals`, oldVal, newVal);
      }

      // Update D1 database with the latest odds and schedule
      await db.prepare(`
        UPDATE matches
        SET
          home_win_pct = ?,
          away_win_pct = ?,
          draw_pct = ?,
          over_under_line = ?,
          over_odds = ?,
          under_odds = ?,
          odds_updated_at = ?
        WHERE id = ?
      `).bind(
        homePct,
        awayPct,
        drawPct,
        ouLine,
        overOdds,
        underOdds,
        new Date().toISOString(),
        dbMatch.id
      ).run();
      
      matchesUpdated++;
    }
  }
  

  
  return { source: 'the-odds-api', matchesUpdated, oddsUpdated };
}

// --------------------------------------------------------
// QStash Webhook and Scheduling Helpers
// --------------------------------------------------------

async function handleLockMatchTask(db, matchId, apiKey) {
  console.log(`[QStash Webhook] Locking odds for match ${matchId}...`);
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first();
  if (!match) {
    throw new Error(`Match ${matchId} not found in database.`);
  }
  
  if (match.odds_locked === 1) {
    console.log(`Match ${matchId} is already locked.`);
    return;
  }
  
  let homePct = match.home_win_pct;
  let awayPct = match.away_win_pct;
  let drawPct = match.draw_pct;
  let ouLine = match.over_under_line;
  let overOdds = match.over_odds;
  let underOdds = match.under_odds;

  if (apiKey && apiKey !== '') {
    try {
      // Fetch odds
      const sportKey = 'soccer_fifa_world_cup';
      const oddsRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,totals&oddsFormat=decimal`);
      const oddsData = await oddsRes.json();
      
      if (oddsRes.status === 200) {
        const apiMatch = oddsData.find(m => 
          m.home_team.toLowerCase() === match.home_team_name.toLowerCase() && 
          m.away_team.toLowerCase() === match.away_team_name.toLowerCase()
        );
        
        if (apiMatch && apiMatch.bookmakers && apiMatch.bookmakers.length > 0) {
          const bookmaker = apiMatch.bookmakers.find(b => {
            const markets = b.markets || [];
            return markets.some(mk => mk.key === 'h2h') && markets.some(mk => mk.key === 'totals');
          }) || apiMatch.bookmakers[0];
          
          if (bookmaker) {
            const h2h = bookmaker.markets.find(mk => mk.key === 'h2h');
            if (h2h) {
              const homeOutcome = h2h.outcomes.find(o => o.name === apiMatch.home_team);
              const awayOutcome = h2h.outcomes.find(o => o.name === apiMatch.away_team);
              const drawOutcome = h2h.outcomes.find(o => o.name === 'Draw');
              
              if (homeOutcome && awayOutcome && drawOutcome) {
                const pHome = 1.0 / homeOutcome.price;
                const pAway = 1.0 / awayOutcome.price;
                const pDraw = 1.0 / drawOutcome.price;
                const sum = pHome + pAway + pDraw;
                homePct = Math.round((pHome / sum) * 1000) / 10;
                awayPct = Math.round((pAway / sum) * 1000) / 10;
                drawPct = Math.round((pDraw / sum) * 1000) / 10;
              }
            }
            
            const totals = bookmaker.markets.find(mk => mk.key === 'totals');
            if (totals) {
              const overOutcome = totals.outcomes.find(o => o.name === 'Over');
              const underOutcome = totals.outcomes.find(o => o.name === 'Under');
              if (overOutcome) {
                ouLine = overOutcome.point;
                overOdds = overOutcome.price;
              }
              if (underOutcome) {
                underOdds = underOutcome.price;
              }
            }
          }
        }
      } else {
        console.warn(`The Odds API lock request returned status ${oddsRes.status}. Using existing odds.`);
      }
    } catch (err) {
      console.warn(`Failed to fetch latest odds for locking match ${matchId}: ${err.message}. Using existing odds.`);
    }
  }
  
  // Log changes if any
  const matchLabel = `${match.home_team_name} vs ${match.away_team_name}`;
  if (match.home_win_pct !== homePct || match.away_win_pct !== awayPct || match.draw_pct !== drawPct) {
    const oldVal = `H: ${match.home_win_pct}%, D: ${match.draw_pct}%, A: ${match.away_win_pct}%`;
    const newVal = `H: ${homePct}%, D: ${drawPct}%, A: ${awayPct}%`;
    await logChange(db, 'odds', match.id, null, `${matchLabel} Win Probabilities (LOCK)`, oldVal, newVal);
  }
  if (match.over_under_line !== ouLine || match.over_odds !== overOdds || match.under_odds !== underOdds) {
    const oldVal = `Line: ${match.over_under_line}, ${formatOuPct(match.over_odds, match.under_odds)}`;
    const newVal = `Line: ${ouLine}, ${formatOuPct(overOdds, underOdds)}`;
    await logChange(db, 'odds', match.id, null, `${matchLabel} O/U Goals (LOCK)`, oldVal, newVal);
  }

  // Update D1 database and set odds_locked = 1
  await db.prepare(`
    UPDATE matches
    SET
      home_win_pct = ?,
      away_win_pct = ?,
      draw_pct = ?,
      over_under_line = ?,
      over_odds = ?,
      under_odds = ?,
      odds_locked = 1,
      odds_updated_at = ?
    WHERE id = ?
  `).bind(
    homePct,
    awayPct,
    drawPct,
    ouLine,
    overOdds,
    underOdds,
    new Date().toISOString(),
    matchId
  ).run();
  
  console.log(`[QStash Webhook] Successfully updated and locked odds for match ${matchId}.`);
}

async function handleScoreMatchTask(db, matchId, qstashToken, pagesUrl, secret, qstashUrl) {
  console.log(`[QStash Webhook] Syncing score and completing predictions for match ${matchId}...`);
  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first();
  if (!match) {
    throw new Error(`Match ${matchId} not found in database.`);
  }
  
  // Format localDate as YYYYMMDD
  const dateObj = new Date(match.local_date);
  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getUTCDate()).padStart(2, '0');
  const yyyymmdd = `${year}${month}${day}`;
  
  console.log(`[QStash Webhook] Fetching ESPN scoreboard for date: ${yyyymmdd}`);
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${yyyymmdd}`);
  const data = await res.json();
  const events = data.events || [];
  
  let matchFound = false;
  let isMatchFinished = false;
  for (const event of events) {
    const comp = event.competitions[0];
    if (!comp) continue;
    
    const homeCompetitor = comp.competitors.find(c => c.homeAway === 'home');
    const awayCompetitor = comp.competitors.find(c => c.homeAway === 'away');
    if (!homeCompetitor || !awayCompetitor) continue;
    
    const homeName = homeCompetitor.team.name;
    const awayName = awayCompetitor.team.name;
    
    const dbHome = normalizeTeamName(match.home_team_name);
    const dbAway = normalizeTeamName(match.away_team_name);
    const espnHome = normalizeTeamName(homeName);
    const espnAway = normalizeTeamName(awayName);
    
    if (dbHome === espnHome && dbAway === espnAway) {
      matchFound = true;
      const homeScore = parseInt(homeCompetitor.score) || 0;
      const awayScore = parseInt(awayCompetitor.score) || 0;
      
      const state = comp.status?.type?.state;
      const completed = comp.status?.type?.completed;
      
      let status = 'scheduled';
      if (state === 'in') status = 'live';
      else if (state === 'post') status = 'finished';
      
      const finished = completed ? 1 : 0;
      isMatchFinished = completed ? true : false;
      
      let homeHtScore = 0;
      let awayHtScore = 0;
      let actualFirstScorer = 'none';
      let firstGoalTime = Infinity;
      let actualCards = 0;
      
      const details = comp.details || [];
      for (const detail of details) {
        if (detail.yellowCard || detail.redCard) {
          actualCards++;
        }
        
        const isGoal = detail.scoringPlay || (detail.type && detail.type.text.toLowerCase().includes('goal'));
        if (isGoal) {
          const isHome = detail.team?.id === homeCompetitor.team?.id;
          const clockVal = detail.clock?.value || 0;
          if (clockVal <= 2700) {
            if (isHome) homeHtScore++;
            else awayHtScore++;
          }
          if (clockVal < firstGoalTime) {
            firstGoalTime = clockVal;
            actualFirstScorer = isHome ? 'home' : 'away';
          }
        }
      }
      
      if (!finished && actualFirstScorer === 'none') {
        actualFirstScorer = null;
      }
      
      if (status === 'scheduled') {
        homeHtScore = null;
        awayHtScore = null;
        actualFirstScorer = null;
        actualCards = null;
      }
      
      // Update DB
      await db.prepare(`
        UPDATE matches
        SET
          home_score = ?,
          away_score = ?,
          home_ht_score = ?,
          away_ht_score = ?,
          status = ?,
          finished = ?,
          actual_cards = ?,
          actual_first_scorer = ?,
          espn_event_id = ?
        WHERE id = ?
      `).bind(
        homeScore,
        awayScore,
        homeHtScore,
        awayHtScore,
        status,
        finished,
        actualCards,
        actualFirstScorer,
        event.id,
        matchId
      ).run();
      
      if (finished === 1) {
        await recalculateMatchPredictionsInSync(
          db, 
          matchId, 
          homeScore, 
          awayScore, 
          match.over_under_line,
          match.cards_line || 3.5,
          actualCards,
          actualFirstScorer,
          match.home_win_pct,
          match.away_win_pct,
          match.draw_pct,
          homeHtScore,
          awayHtScore
        );
      }
      break;
    }
  }
  
  if (!matchFound) {
    console.log(`[QStash Webhook] Match ${matchId} not found in ESPN scoreboard events.`);
  }

  const elapsedSinceKickoff = Date.now() - new Date(match.local_date).getTime();
  const sixHoursInMs = 6 * 60 * 60 * 1000;
  
  if ((!matchFound || !isMatchFinished) && qstashToken) {
    if (elapsedSinceKickoff < sixHoursInMs) {
      console.log(`[QStash Webhook] Match ${matchId} is not finished yet. Scheduling a retry in 1 minute...`);
      const qstashEndpoint = qstashUrl || "https://qstash-us-east-1.upstash.io";
      const retryEpoch = Math.floor((Date.now() + 60 * 1000) / 1000);
      const scoreUrl = `${pagesUrl}/api/sync?scoreMatchId=${matchId}${secret ? `&secret=${secret}` : ''}`;
      
      try {
        const scoreRes = await fetch(`${qstashEndpoint}/v2/publish/${scoreUrl}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${qstashToken}`,
            'Upstash-Not-Before': String(retryEpoch)
          }
        });
        if (!scoreRes.ok) {
          const errText = await scoreRes.text();
          console.error(`[QStash Webhook] Failed to schedule retry on QStash: ${errText}`);
        } else {
          console.log(`[QStash Webhook] Successfully rescheduled match ${matchId} score sync in 1 minute.`);
          await logChange(db, 'system', matchId, null, 'QStash Message Sent: Rescheduled Score Sync (Retry)', null, `Scheduled Time: 1 minute from now`);
        }
      } catch (err) {
        console.error(`[QStash Webhook] Failed to reschedule score sync:`, err.message);
      }
    } else {
      console.log(`[QStash Webhook] Match ${matchId} has been kicking off for over 6 hours and is still not finished. Stopping retries.`);
    }
  }
}

async function checkAndScheduleQStashJobs(db, qstashToken, pagesUrl, secret, qstashUrl) {
  const currentTime = Date.now();
  const qstashEndpoint = qstashUrl || "https://qstash-us-east-1.upstash.io";
  const { results: allDbMatches } = await db.prepare("SELECT * FROM matches WHERE qstash_scheduled = 0 AND finished = 0").all();
  
  // Only schedule matches starting within the next 3 days to stay well within QStash Free Tier limits
  const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
  const unscheduledMatches = allDbMatches.filter(m => {
    const matchTime = new Date(m.local_date).getTime();
    return matchTime > currentTime && (matchTime - currentTime) <= threeDaysInMs;
  });
  
  for (const m of unscheduledMatches) {
    const matchTime = new Date(m.local_date).getTime();
    
    if (matchTime > currentTime) {
      console.log(`[QStash Scheduler] Scheduling QStash jobs for match ${m.id} (${m.home_team_name} vs ${m.away_team_name})...`);
      
      // 1. Lock odds job (kickoff - 2 hours)
      const lockEpoch = Math.floor((matchTime - 2 * 60 * 60 * 1000) / 1000);
      const lockUrl = `${pagesUrl}/api/sync?lockMatchId=${m.id}${secret ? `&secret=${secret}` : ''}`;
      
      // 2. Score match job (kickoff + 105 minutes)
      const scoreEpoch = Math.floor((matchTime + 105 * 60 * 1000) / 1000);
      const scoreUrl = `${pagesUrl}/api/sync?scoreMatchId=${m.id}${secret ? `&secret=${secret}` : ''}`;
      
      let lockMsgId = null;
      let scoreMsgId = null;
      
      try {
        // Schedule lock odds job if in the future
        if (lockEpoch * 1000 > currentTime) {
          const lockRes = await fetch(`${qstashEndpoint}/v2/publish/${lockUrl}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${qstashToken}`,
              'Upstash-Not-Before': String(lockEpoch)
            }
          });
          console.log(`[QStash Scheduler] Lock odds scheduled: status ${lockRes.status}`);
          if (!lockRes.ok) {
            const errText = await lockRes.text();
            throw new Error(`QStash Lock publish failed with status ${lockRes.status}: ${errText}`);
          }
          try {
            const resJson = await lockRes.json();
            lockMsgId = resJson.messageId || null;
            await logChange(db, 'system', m.id, null, 'QStash Message Sent: Scheduled Odds Lock', null, `Msg ID: ${lockMsgId}, Scheduled Time: ${new Date(lockEpoch * 1000).toISOString()}`);
          } catch (e) {
            console.error('[QStash Scheduler] Failed to parse lock response JSON:', e.message);
          }
        } else {
          console.log(`[QStash Scheduler] Lock time is in the past for match ${m.id}, skipping lock schedule.`);
        }
        
        // Schedule score match job if in the future
        if (scoreEpoch * 1000 > currentTime) {
          const scoreRes = await fetch(`${qstashEndpoint}/v2/publish/${scoreUrl}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${qstashToken}`,
              'Upstash-Not-Before': String(scoreEpoch)
            }
          });
          console.log(`[QStash Scheduler] Score sync scheduled: status ${scoreRes.status}`);
          if (!scoreRes.ok) {
            const errText = await scoreRes.text();
            throw new Error(`QStash Score publish failed with status ${scoreRes.status}: ${errText}`);
          }
          try {
            const resJson = await scoreRes.json();
            scoreMsgId = resJson.messageId || null;
            await logChange(db, 'system', m.id, null, 'QStash Message Sent: Scheduled Score Sync', null, `Msg ID: ${scoreMsgId}, Scheduled Time: ${new Date(scoreEpoch * 1000).toISOString()}`);
          } catch (e) {
            console.error('[QStash Scheduler] Failed to parse score response JSON:', e.message);
          }
        }
        
        // Mark match as scheduled in database and store the message IDs
        await db.prepare("UPDATE matches SET qstash_scheduled = 1, qstash_lock_msg_id = ?, qstash_score_msg_id = ? WHERE id = ?")
          .bind(lockMsgId, scoreMsgId, m.id)
          .run();
      } catch (err) {
        console.error(`[QStash Scheduler] Failed to schedule QStash jobs for match ${m.id}:`, err.message);
      }
    } else {
      // Kickoff is already in the past, just mark as scheduled
      await db.prepare("UPDATE matches SET qstash_scheduled = 1 WHERE id = ?").bind(m.id).run();
    }
  }
}

async function cancelQStashMessage(db, messageId, qstashToken, qstashUrl) {
  if (!messageId) return;
  const qstashEndpoint = qstashUrl || "https://qstash-us-east-1.upstash.io";
  try {
    console.log(`[QStash Scheduler] Cancelling message ${messageId}...`);
    const res = await fetch(`${qstashEndpoint}/v2/messages/${messageId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${qstashToken}`
      }
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[QStash Scheduler] Failed to cancel message ${messageId}: status ${res.status} - ${errText}`);
    } else {
      console.log(`[QStash Scheduler] Message ${messageId} successfully cancelled.`);
      await logChange(db, 'system', null, null, 'QStash Message Cancelled', null, `Msg ID: ${messageId}`);
    }
  } catch (err) {
    console.error(`[QStash Scheduler] Error cancelling message ${messageId}:`, err.message);
  }
}
