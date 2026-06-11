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

    if (env.SYNC_SECRET && env.SYNC_SECRET !== '' && !isSameOrigin && clientSecret !== env.SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid sync secret' }), { status: 401, headers });
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
    const apiKeyFootball = env.API_FOOTBALL_KEY;
    let syncResults = { source: 'mock', matchesUpdated: 0, oddsUpdated: 0 };

    if (apiKeyOdds && apiKeyOdds !== '') {
      try {
        syncResults = await syncFromTheOddsAPI(env.db, apiKeyOdds);
      } catch (err) {
        console.error('The Odds API sync failed, falling back to mock sync:', err.message);
        syncResults = await runMockSync(env.db);
        syncResults.warning = `The Odds API failed (${err.message}). Gracefully fell back to mock simulation.`;
      }
    } else if (apiKeyFootball && apiKeyFootball !== '') {
      try {
        syncResults = await syncFromAPIFootball(env.db, apiKeyFootball);
      } catch (err) {
        console.error('API-Football sync failed, falling back to mock sync:', err.message);
        syncResults = await runMockSync(env.db);
        syncResults.warning = `API-Football failed (${err.message}). Gracefully fell back to mock simulation.`;
      }
    } else {
      syncResults = await runMockSync(env.db);
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
async function syncFromAPIFootball(db, apiKey) {
  console.log('Syncing from API-Football...');
  const API_HOST = 'v3.football.api-sports.io';
  
  // 1. Fetch World Cup 2026 Fixtures (League ID 1, Season 2026)
  const fixturesRes = await fetch(`https://${API_HOST}/fixtures?league=1&season=2026`, {
    headers: { 'x-apisports-key': apiKey }
  });
  const fixturesData = await fixturesRes.json();

  if (fixturesData.errors && (Array.isArray(fixturesData.errors) ? fixturesData.errors.length > 0 : Object.keys(fixturesData.errors).length > 0)) {
    throw new Error(`API Error details: ${JSON.stringify(fixturesData.errors)}`);
  }

  const apiFixtures = fixturesData.response || [];

  if (apiFixtures.length === 0) {
    throw new Error('API-Football returned no fixtures. Ensure the World Cup 2026 (League ID 1, Season 2026) is available on your plan.');
  }

  // 2. Fetch World Cup 2026 Odds
  // We'll fetch odds for the league/season if available
  const oddsRes = await fetch(`https://${API_HOST}/odds?league=1&season=2026`, {
    headers: { 'x-apisports-key': apiKey }
  });
  const oddsData = await oddsRes.json();
  if (oddsData.errors && (Array.isArray(oddsData.errors) ? oddsData.errors.length > 0 : Object.keys(oddsData.errors).length > 0)) {
    console.warn('API-Football Odds Error:', JSON.stringify(oddsData.errors));
  }
  const apiOddsList = oddsData.response || [];

  // Create an odds map by fixture ID
  const oddsMap = {};
  for (const item of apiOddsList) {
    const fixtureId = item.fixture.id;
    const bookmakers = item.bookmakers || [];
    const mainBookie = bookmakers.find(b => b.name === 'Bet365') || bookmakers[0];
    
    if (mainBookie) {
      const bets = mainBookie.bets || [];
      const matchWinnerBet = bets.find(b => b.name === 'Match Winner');
      const overUnderBet = bets.find(b => b.name === 'Goals Over/Under');

      oddsMap[fixtureId] = {
        winner: matchWinnerBet ? matchWinnerBet.values : null,
        overUnder: overUnderBet ? overUnderBet.values : null
      };
    }
  }

  // Load existing matches to map teams and find slots
  const { results: dbMatches } = await db.prepare('SELECT * FROM matches').all();
  
  let matchesUpdated = 0;
  let oddsUpdated = 0;

  for (const apiFix of apiFixtures) {
    const apiFixId = apiFix.fixture.id;
    const apiHome = apiFix.teams.home;
    const apiAway = apiFix.teams.away;
    const apiStatus = apiFix.fixture.status.short;
    const apiHomeScore = apiFix.goals.home;
    const apiAwayScore = apiFix.goals.away;
    const apiRound = apiFix.league.round; // e.g. "Group Stage - 1", "Round of 16", etc.

    // Determine status
    let status = 'scheduled';
    if (['1H', '2H', 'HT', 'ET', 'P'].includes(apiStatus)) status = 'live';
    else if (['FT', 'AET', 'PEN'].includes(apiStatus)) status = 'finished';

    const finished = status === 'finished' ? 1 : 0;
    const homeScore = apiHomeScore !== null ? apiHomeScore : 0;
    const awayScore = apiAwayScore !== null ? apiAwayScore : 0;

    // Try to find a match in the DB that matches this API fixture
    let dbMatch = dbMatches.find(m => m.home_team_name.toLowerCase() === apiHome.name.toLowerCase() && m.away_team_name.toLowerCase() === apiAway.name.toLowerCase());

    // If it's a knockout match, teams might have just been resolved
    if (!dbMatch && !['group', 'group stage'].includes(apiRound.toLowerCase())) {
      // Find a knockout match of the same type that doesn't have teams filled, or matches by round
      const roundType = getRoundType(apiRound);
      dbMatch = dbMatches.find(m => m.type === roundType && (m.home_team_id === 0 || m.home_team_id === null));
    }

    if (dbMatch) {
      // Fetch odds if we have them in the odds map
      let homePct = dbMatch.home_win_pct;
      let awayPct = dbMatch.away_win_pct;
      let drawPct = dbMatch.draw_pct;
      let ouLine = dbMatch.over_under_line;
      let overOdds = dbMatch.over_odds;
      let underOdds = dbMatch.under_odds;

      const odds = oddsMap[apiFixId];
      if (odds) {
        // Parse match winner odds to percentages
        // value format: [{ value: 'Home', odd: '1.95' }, { value: 'Draw', odd: '3.40' }, { value: 'Away', odd: '4.10' }]
        if (odds.winner) {
          const homeOdd = parseFloat(odds.winner.find(v => v.value === 'Home')?.odd || 0);
          const drawOdd = parseFloat(odds.winner.find(v => v.value === 'Draw')?.odd || 0);
          const awayOdd = parseFloat(odds.winner.find(v => v.value === 'Away')?.odd || 0);

          if (homeOdd && drawOdd && awayOdd) {
            const pHome = 1.0 / homeOdd;
            const pDraw = 1.0 / drawOdd;
            const pAway = 1.0 / awayOdd;
            const sum = pHome + pDraw + pAway;
            homePct = Math.round((pHome / sum) * 1000) / 10;
            drawPct = Math.round((pDraw / sum) * 1000) / 10;
            awayPct = Math.round((pAway / sum) * 1000) / 10;
            oddsUpdated++;
          }
        }

        // Parse Over/Under 2.5 goals
        // value format: [{ value: 'Over 2.5', odd: '1.85' }, { value: 'Under 2.5', odd: '1.95' }]
        if (odds.overUnder) {
          const ouMatch = odds.overUnder.find(v => v.value.startsWith('Over') || v.value.startsWith('Under'));
          if (ouMatch) {
            // Extract the line (e.g. 2.5)
            const lineMatch = ouMatch.value.match(/\d+\.\d+/);
            if (lineMatch) ouLine = parseFloat(lineMatch[0]);

            const overOddVal = odds.overUnder.find(v => v.value.startsWith('Over'))?.odd;
            const underOddVal = odds.overUnder.find(v => v.value.startsWith('Under'))?.odd;

            if (overOddVal) overOdds = parseFloat(overOddVal);
            if (underOddVal) underOdds = parseFloat(underOddVal);
          }
        }
      }

      let actualCards = dbMatch.actual_cards;
      if (finished === 1 && (actualCards === null || actualCards === undefined)) {
        actualCards = Math.floor(Math.random() * 5) + 1;
      }

      // Update match record
      await db.prepare(`
        UPDATE matches 
        SET 
          home_team_id = ?,
          away_team_id = ?,
          home_team_name = ?,
          away_team_name = ?,
          home_score = ?,
          away_score = ?,
          status = ?,
          finished = ?,
          home_win_pct = ?,
          away_win_pct = ?,
          draw_pct = ?,
          over_under_line = ?,
          over_odds = ?,
          under_odds = ?,
          actual_cards = ?,
          local_date = ?
        WHERE id = ?
      `).bind(
        apiHome.id, 
        apiAway.id, 
        apiHome.name, 
        apiAway.name, 
        homeScore, 
        awayScore, 
        status, 
        finished, 
        homePct, 
        awayPct, 
        drawPct,
        ouLine,
        overOdds,
        underOdds,
        actualCards,
        apiFix.fixture.date || dbMatch.local_date,
        dbMatch.id
      ).run();

      // Recalculate predictions if finished
      if (finished === 1) {
        await recalculateMatchPredictionsInSync(db, dbMatch.id, homeScore, awayScore, ouLine, dbMatch.cards_line || 3.5, actualCards);
      }

      matchesUpdated++;
    }
  }

  return { source: 'api-football', matchesUpdated, oddsUpdated };
}

function getRoundType(apiRound) {
  const r = apiRound.toLowerCase();
  if (r.includes('round of 32')) return 'r32';
  if (r.includes('round of 16')) return 'r16';
  if (r.includes('quarter')) return 'qf';
  if (r.includes('semi')) return 'sf';
  if (r.includes('third') || r.includes('3rd')) return 'third';
  if (r.includes('final')) return 'final';
  return 'group';
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
    if (currentTime > matchTime && m.status === 'scheduled') {
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

      const actualCards = Math.floor(Math.random() * 5) + 1; // 1-5 cards
      await db.prepare(`
        UPDATE matches 
        SET 
          home_score = ?,
          away_score = ?,
          status = 'finished',
          finished = 1,
          actual_cards = ?
        WHERE id = ?
      `).bind(homeScore, awayScore, actualCards, m.id).run();

      await recalculateMatchPredictionsInSync(db, m.id, homeScore, awayScore, m.over_under_line, m.cards_line || 3.5, actualCards);
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
async function recalculateMatchPredictionsInSync(db, matchId, homeScore, awayScore, ouLine, cardsLine, actualCards) {
  let winner = 'draw';
  if (homeScore > awayScore) winner = 'home';
  else if (awayScore > homeScore) winner = 'away';

  const totalGoals = homeScore + awayScore;
  const ouResult = totalGoals > ouLine ? 'over' : 'under';

  let cardsResult = null;
  if (actualCards !== null && cardsLine !== null) {
    cardsResult = actualCards > cardsLine ? 'over' : 'under';
  }

  const { results: predictions } = await db.prepare('SELECT * FROM predictions WHERE match_id = ?').bind(matchId).all();

  for (const pred of predictions) {
    const pWinner = pred.predicted_winner === winner ? 1 : 0;
    const pOu = pred.predicted_over_under === ouResult ? 1 : 0;
    const pScore = (pred.predicted_home_score === homeScore && pred.predicted_away_score === awayScore) ? 1 : 0;
    
    let pCards = 0;
    if (cardsResult !== null && pred.predicted_cards_over_under === cardsResult) {
      pCards = 1;
    }

    const totalPoints = pWinner + pOu + pCards + (pScore * 3);

    await db.prepare(`
      UPDATE predictions 
      SET 
        points_winner = ?,
        points_ou = ?,
        points_score = ?,
        points_cards_ou = ?,
        total_points = ?
      WHERE participant_id = ? AND match_id = ?
    `).bind(pWinner, pOu, pScore, pCards, totalPoints, pred.participant_id, matchId).run();
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
          under_odds = ?,
          local_date = ?
        WHERE id = ?
      `).bind(
        homePct,
        awayPct,
        drawPct,
        ouLine,
        overOdds,
        underOdds,
        match.commence_time,
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
    
    if (dbMatch) {
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
      
      // Update D1 database with the latest scores and match status
      await db.prepare(`
        UPDATE matches
        SET
          home_score = ?,
          away_score = ?,
          status = ?,
          finished = ?
        WHERE id = ?
      `).bind(
        homeScore,
        awayScore,
        status,
        finished,
        dbMatch.id
      ).run();
      
      // Recalculate predictions if finished
      if (finished === 1) {
        await recalculateMatchPredictionsInSync(db, dbMatch.id, homeScore, awayScore, dbMatch.over_under_line);
      }
    }
  }
  
  return { source: 'the-odds-api', matchesUpdated, oddsUpdated };
}
