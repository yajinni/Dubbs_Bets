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

    // Verify secret key if configured in environment
    const clientSecret = url.searchParams.get('secret');
    if (env.SYNC_SECRET && env.SYNC_SECRET !== '' && clientSecret !== env.SYNC_SECRET) {
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
    const apiKey = env.API_FOOTBALL_KEY;
    let syncResults = { source: 'mock', matchesUpdated: 0, oddsUpdated: 0 };

    if (apiKey && apiKey !== '') {
      syncResults = await syncFromAPIFootball(env.db, apiKey);
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
  const apiFixtures = fixturesData.response || [];

  if (apiFixtures.length === 0) {
    throw new Error('API-Football returned no fixtures.');
  }

  // 2. Fetch World Cup 2026 Odds
  // We'll fetch odds for the league/season if available
  const oddsRes = await fetch(`https://${API_HOST}/odds?league=1&season=2026`, {
    headers: { 'x-apisports-key': apiKey }
  });
  const oddsData = await oddsRes.json();
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
          under_odds = ?
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
        dbMatch.id
      ).run();

      // Recalculate predictions if finished
      if (finished === 1) {
        await recalculateMatchPredictionsInSync(db, dbMatch.id, homeScore, awayScore, ouLine);
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

      await db.prepare(`
        UPDATE matches 
        SET 
          home_score = ?,
          away_score = ?,
          status = 'finished',
          finished = 1
        WHERE id = ?
      `).bind(homeScore, awayScore, m.id).run();

      await recalculateMatchPredictionsInSync(db, m.id, homeScore, awayScore, m.over_under_line);
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
async function recalculateMatchPredictionsInSync(db, matchId, homeScore, awayScore, ouLine) {
  let winner = 'draw';
  if (homeScore > awayScore) winner = 'home';
  else if (awayScore > homeScore) winner = 'away';

  const totalGoals = homeScore + awayScore;
  const ouResult = totalGoals > ouLine ? 'over' : 'under';

  const { results: predictions } = await db.prepare('SELECT * FROM predictions WHERE match_id = ?').bind(matchId).all();

  for (const pred of predictions) {
    const pWinner = pred.predicted_winner === winner ? 1 : 0;
    const pOu = pred.predicted_over_under === ouResult ? 1 : 0;
    const pScore = (pred.predicted_home_score === homeScore && pred.predicted_away_score === awayScore) ? 1 : 0;
    const totalPoints = pWinner + pOu + pScore;

    await db.prepare(`
      UPDATE predictions 
      SET 
        points_winner = ?,
        points_ou = ?,
        points_score = ?,
        total_points = ?
      WHERE participant_id = ? AND match_id = ?
    `).bind(pWinner, pOu, pScore, totalPoints, pred.participant_id, matchId).run();
  }
}
