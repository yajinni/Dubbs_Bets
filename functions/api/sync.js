// Cloudflare Pages Functions: API route to sync matches, scores, and odds from API-Football
import { checkAndInitDb } from './db_helper.js';

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

    // Verify secret key if configured in environment (allow same-origin browser requests to bypass)
    const clientSecret = url.searchParams.get('secret');
    const secFetchSite = request.headers.get('sec-fetch-site');
    const isSameOrigin = secFetchSite === 'same-origin' || secFetchSite === 'same-site';
    const isDiagnostic = url.searchParams.get('checkBets') === 'true' || url.searchParams.get('checkOddsFixture') !== null;

    if (!isDiagnostic && env.SYNC_SECRET && env.SYNC_SECRET !== '' && !isSameOrigin && clientSecret !== env.SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid sync secret' }), { status: 401, headers });
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

    // 1. Check time since last sync
    const lastSyncSetting = await env.db.prepare("SELECT value FROM settings WHERE key = 'last_sync'").first();
    const lastSyncTime = lastSyncSetting ? new Date(lastSyncSetting.value).getTime() : 0;
    const currentTime = Date.now();
    const sixHoursInMs = 6 * 60 * 60 * 1000; // 6 hours

    if (!force && (currentTime - lastSyncTime < sixHoursInMs)) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Sync skipped. Updated within the last 6 hours.',
        last_sync: lastSyncSetting ? lastSyncSetting.value : null
      }), { status: 200, headers });
    }

    // 2. Perform Sync
    const apiKeyOdds = env.THE_ODDS_API_KEY;
    let syncResults = { source: 'espn', matchesUpdated: 0, oddsUpdated: 0 };

    try {
      syncResults = await syncFromESPN(env.db);
    } catch (err) {
      console.error('ESPN sync failed:', err.message);
      syncResults = { source: 'fallback', matchesUpdated: 0, oddsUpdated: 0, warning: `ESPN sync failed: ${err.message}` };
    }

    // Always run mock sync as a post-processing step to finish simulated/mock matches in the past
    try {
      const mockResults = await runMockSync(env.db);
      syncResults.matchesUpdated += mockResults.matchesUpdated;
      syncResults.oddsUpdated += mockResults.oddsUpdated;
      if (mockResults.matchesUpdated > 0) {
        syncResults.source += ' + mock_simulation';
      }
    } catch (err) {
      console.error('Mock sync post-processing failed:', err.message);
    }

    if (apiKeyOdds && apiKeyOdds !== '') {
      try {
        const oddsResults = await syncFromTheOddsAPI(env.db, apiKeyOdds);
        syncResults.oddsUpdated = oddsResults.oddsUpdated;
        syncResults.source += ' + the-odds-api';
      } catch (err) {
        console.error('The Odds API sync failed:', err.message);
      }
    }

    // 3. Update last sync time
    const isoString = new Date().toISOString();
    await env.db.prepare("UPDATE settings SET value = ? WHERE key = 'last_sync'").bind(isoString).run();

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
async function syncFromESPN(db) {
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
        if (detail.yellowCard || detail.redCard || (detail.type && (detail.type.text.toLowerCase().includes('card') || detail.type.text.toLowerCase().includes('yellow') || detail.type.text.toLowerCase().includes('red')))) {
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
          actual_first_scorer = ?
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
      }
      
      matchesUpdated++;
    }
  }
  
  return { source: 'espn', matchesUpdated, oddsUpdated: 0 };
}

// --------------------------------------------------------
// FALLBACK/MOCK SYNC: Simulates tournament matches & odds
// --------------------------------------------------------
async function runMockSync(db) {
  console.log('Running Fallback/Mock Sync...');
  const { results: dbMatches } = await db.prepare('SELECT * FROM matches').all();
  
  let matchesUpdated = 0;
  let oddsUpdated = 0;
  
  const currentTime = Date.now();

  for (const m of dbMatches) {
    const matchTime = new Date(m.local_date).getTime();
    
    // 1. Check if the match is in the past (date/time has passed)
    if (currentTime > matchTime && (m.status === 'scheduled' || m.status === 'live')) {
      // Generate simulated scores weighted by home win percentage
      // home_win_pct is stored between 0-100
      let homeScore = 0;
      let awayScore = 0;

      const rand = Math.random() * 100;
      if (rand < m.home_win_pct) {
        // Home team wins
        homeScore = Math.floor(Math.random() * 3) + 1; // 1-3
        awayScore = Math.floor(Math.random() * homeScore);
      } else if (rand < (m.home_win_pct + m.draw_pct)) {
        // Draw
        homeScore = Math.floor(Math.random() * 3); // 0-2
        awayScore = homeScore;
      } else {
        // Away team wins
        awayScore = Math.floor(Math.random() * 3) + 1;
        homeScore = Math.floor(Math.random() * awayScore);
      }

      let actualFirstScorer = 'none';
      if (homeScore > 0 && awayScore > 0) {
        actualFirstScorer = Math.random() < 0.5 ? 'home' : 'away';
      } else if (homeScore > 0) {
        actualFirstScorer = 'home';
      } else if (awayScore > 0) {
        actualFirstScorer = 'away';
      }

      const homeHtScore = Math.floor(Math.random() * (homeScore + 1));
      const awayHtScore = Math.floor(Math.random() * (awayScore + 1));

      const actualCards = Math.floor(Math.random() * 5) + 1; // 1-5 cards
      await db.prepare(`
        UPDATE matches 
        SET 
          home_score = ?,
          away_score = ?,
          home_ht_score = ?,
          away_ht_score = ?,
          status = 'finished',
          finished = 1,
          actual_cards = ?,
          actual_first_scorer = ?
        WHERE id = ?
      `).bind(homeScore, awayScore, homeHtScore, awayHtScore, actualCards, actualFirstScorer, m.id).run();

      await recalculateMatchPredictionsInSync(db, m.id, homeScore, awayScore, m.over_under_line, m.cards_line || 3.5, actualCards, actualFirstScorer, m.home_win_pct, m.away_win_pct, m.draw_pct, homeHtScore, awayHtScore);
      matchesUpdated++;
    }

    // 2. Adjust odds dynamically for upcoming matches (add subtle micro-variations to simulate money movements)
    if (currentTime <= matchTime && m.status === 'scheduled') {
      const variation = (Math.random() - 0.5) * 4; // -2% to +2% variation
      let homePct = Math.max(5, Math.min(90, Math.round((m.home_win_pct + variation) * 10) / 10));
      let awayPct = Math.max(5, Math.min(90, Math.round((m.away_win_pct - variation) * 10) / 10));
      let drawPct = Math.round((100 - homePct - awayPct) * 10) / 10;

      await db.prepare(`
        UPDATE matches 
        SET 
          home_win_pct = ?,
          away_win_pct = ?,
          draw_pct = ?
        WHERE id = ?
      `).bind(homePct, awayPct, drawPct, m.id).run();
      oddsUpdated++;
    }
  }

  return { source: 'mock', matchesUpdated, oddsUpdated };
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
    const pWinner = pred.predicted_winner === winner ? 2 : 0;
    const pOu = pred.predicted_over_under === ouResult ? 1 : 0;
    const pScore = (pred.predicted_home_score === homeScore && pred.predicted_away_score === awayScore) ? 1 : 0;

    // Underdog Bonus: +1 if player picked the option with lowest win/draw% AND that outcome occurred
    let pUnderdog = 0;
    if (pWinner > 0 && homeWinPct != null && awayWinPct != null && drawWinPct != null) {
      const minPct = Math.min(homeWinPct, awayWinPct, drawWinPct);
      if (winner === 'home' && homeWinPct === minPct) pUnderdog = 1;
      else if (winner === 'away' && awayWinPct === minPct) pUnderdog = 1;
      else if (winner === 'draw' && drawWinPct === minPct) pUnderdog = 1;
    }

    let pTotalCardsEarned = 0;
    if (actualCards !== null && pred.predicted_total_cards !== null) {
      pTotalCardsEarned = pred.predicted_total_cards === actualCards ? 2 : 0;
    }

    let pFirstScorerEarned = 0;
    if (actualFirstScorer !== null && pred.predicted_first_scorer !== null) {
      pFirstScorerEarned = pred.predicted_first_scorer === actualFirstScorer ? 1 : 0;
    }

    let pHalf = 0;
    if (pred.predicted_highest_scoring_half !== null) {
      pHalf = pred.predicted_highest_scoring_half === winnerHalf ? 1 : 0;
    }

    let pCleanSheet = 0;
    if (pred.predicted_clean_sheet !== null) {
      pCleanSheet = pred.predicted_clean_sheet === cleanSheetHappened ? 1 : 0;
    }

    const totalPoints = pWinner + pOu + pUnderdog + pTotalCardsEarned + pFirstScorerEarned + (pScore * 3) + pHalf + pCleanSheet;

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
  
  // 2. Fetch Scores
  const scoresRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/scores/?apiKey=${apiKey}&daysFrom=3`);
  const scoresData = await scoresRes.json();
  
  if (scoresRes.status !== 200) {
    throw new Error(`The Odds API scores error: ${JSON.stringify(scoresData)}`);
  }
  
  const { results: dbMatches } = await db.prepare('SELECT * FROM matches').all();
  let matchesUpdated = 0;
  let oddsUpdated = 0;
  
  // 1. Process Odds and Schedules (loop over all matches returned in oddsData)
  for (const match of oddsData) {
    const dbMatch = dbMatches.find(m => 
      m.home_team_name.toLowerCase() === match.home_team.toLowerCase() && 
      m.away_team_name.toLowerCase() === match.away_team.toLowerCase()
    );
    
    if (dbMatch) {
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
      
      // Update D1 database with the latest odds and schedule
      await db.prepare(`
        UPDATE matches
        SET
          home_win_pct = ?,
          away_win_pct = ?,
          draw_pct = ?,
          over_under_line = ?,
          over_odds = ?,
          under_odds = ?
        WHERE id = ?
      `).bind(
        homePct,
        awayPct,
        drawPct,
        ouLine,
        overOdds,
        underOdds,
        dbMatch.id
      ).run();
      
      matchesUpdated++;
    }
  }
  
  // 2. Process Scores and completed statuses (loop over matches in scoresData)
  for (const event of scoresData) {
    const dbMatch = dbMatches.find(m => 
      m.home_team_name.toLowerCase() === event.home_team.toLowerCase() && 
      m.away_team_name.toLowerCase() === event.away_team.toLowerCase()
    );
    
    if (dbMatch && dbMatch.finished === 0) {
      let homeScore = dbMatch.home_score;
      let awayScore = dbMatch.away_score;
      let finished = dbMatch.finished;
      let status = dbMatch.status;
      
      if (event.scores && event.scores.length > 0) {
        const hScoreObj = event.scores.find(s => s.name === event.home_team);
        const aScoreObj = event.scores.find(s => s.name === event.away_team);
        if (hScoreObj && aScoreObj) {
          homeScore = parseInt(hScoreObj.score) || 0;
          awayScore = parseInt(aScoreObj.score) || 0;
        }
      }
      
      if (event.completed === true) {
        status = 'finished';
        finished = 1;
      } else if (event.completed === false) {
        // If commenced in the past but not completed, mark as live
        const startTime = new Date(event.commence_time).getTime();
        if (Date.now() >= startTime) {
          status = 'live';
        } else {
          status = 'scheduled';
        }
        finished = 0;
      }
      
      let inferredFirstScorer = dbMatch.actual_first_scorer;

      // Update D1 database with the latest scores and match status
      await db.prepare(`
        UPDATE matches
        SET
          home_score = ?,
          away_score = ?,
          status = ?,
          finished = ?,
          actual_first_scorer = ?
        WHERE id = ?
      `).bind(
        homeScore,
        awayScore,
        status,
        finished,
        inferredFirstScorer,
        dbMatch.id
      ).run();
      
      // Recalculate predictions if finished
      if (finished === 1) {
        await recalculateMatchPredictionsInSync(
          db, 
          dbMatch.id, 
          homeScore, 
          awayScore, 
          dbMatch.over_under_line,
          dbMatch.cards_line || 3.5,
          dbMatch.actual_cards,
          inferredFirstScorer,
          dbMatch.home_win_pct,
          dbMatch.away_win_pct,
          dbMatch.draw_pct,
          dbMatch.home_ht_score,
          dbMatch.away_ht_score
        );
      }
    }
  }
  
  return { source: 'the-odds-api', matchesUpdated, oddsUpdated };
}
