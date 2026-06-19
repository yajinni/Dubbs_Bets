// Cloudflare Pages Functions: API route to sync matches, scores, and odds from API-Football
import { checkAndInitDb, logChange, formatOuPct, emitEvent, bumpVersion, recomputeAllCaches, clearMatchesCache, scoreAllPredictionsForMatch, flushLogs } from './db_helper.js';

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
  const startTime = new Date().toISOString();

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
    const isInternal = url.searchParams.get('midnightLock') === 'true' || url.searchParams.get('lockMatchId') || url.searchParams.get('scoreMatchId');

    if (!isDiagnostic && !isInternal && env.SYNC_SECRET && env.SYNC_SECRET !== '' && !isSameOrigin && clientSecret !== env.SYNC_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid sync secret' }), { status: 401, headers });
    }



    // Handle automated task webhooks
    const lockMatchId = url.searchParams.get('lockMatchId');
    if (lockMatchId) {
      const apiKeyOdds = env.THE_ODDS_API_KEY;
      if (!apiKeyOdds) {
        return new Response(JSON.stringify({ error: 'THE_ODDS_API_KEY is missing' }), { status: 400, headers });
      }
      await logChange(env.db, 'system', parseInt(lockMatchId), null, 'Lock Match Odds', null, `Match ID: ${lockMatchId}`);
      await handleLockMatchTask(env.db, parseInt(lockMatchId), apiKeyOdds);
      await flushLogs(env.db);
      return new Response(JSON.stringify({ success: true, message: `Match ${lockMatchId} odds locked.` }), { status: 200, headers });
    }

    const scoreMatchId = url.searchParams.get('scoreMatchId');
    if (scoreMatchId) {
      await logChange(env.db, 'system', parseInt(scoreMatchId), null, 'Score Match & Recalculate Predictions', null, `Match ID: ${scoreMatchId}`);
      await handleScoreMatchTask(env.db, parseInt(scoreMatchId));
      await flushLogs(env.db);
      return new Response(JSON.stringify({ success: true, message: `Match ${scoreMatchId} scores synced and predictions scored.` }), { status: 200, headers });
    }

    const midnightLock = url.searchParams.get('midnightLock') === 'true';
    if (midnightLock) {
      const apiKeyOdds = env.THE_ODDS_API_KEY;
      if (!apiKeyOdds) {
        return new Response(JSON.stringify({ error: 'THE_ODDS_API_KEY is missing' }), { status: 400, headers });
      }
      await checkAndInitDb(env.db);
      const result = await handleMidnightLock(env.db, apiKeyOdds);
      await flushLogs(env.db);
      return new Response(JSON.stringify({ success: true, ...result }), { status: 200, headers });
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

    // 1. Perform Sync
    const apiKeyOdds = env.THE_ODDS_API_KEY;
    const skipOdds = url.searchParams.get('skipOdds') === 'true';
    let syncResults = { source: 'espn', matchesUpdated: 0, oddsUpdated: 0 };

    // Run actual sync from ESPN. If it fails, let the error propagate.
    syncResults = await syncFromESPN(env.db);

    // Only fetch odds if forced (since midnightLock cron task at 12:05 handles standard daily odds update)
    if (force && !skipOdds && apiKeyOdds && apiKeyOdds !== '') {
      try {
        const oddsResults = await syncFromTheOddsAPI(env.db, apiKeyOdds);
        syncResults.oddsUpdated = oddsResults.oddsUpdated;
        syncResults.source += ' + the-odds-api';
      } catch (err) {
        console.error('The Odds API sync failed:', err.message);
        syncResults.oddsError = err.message;
      }
    }

    // 2. Update last sync time
    const isoString = new Date().toISOString();
    await env.db.prepare("UPDATE settings SET value = ? WHERE key = 'last_sync'").bind(isoString).run();

    const logDetails = `Started: ${startTime} | Updated: ${syncResults.matchesUpdated} matches, ${syncResults.oddsUpdated} odds.` + (syncResults.oddsError ? ` Odds Error: ${syncResults.oddsError}` : '');
    await logChange(env.db, 'system', null, null, '✅ ESPN Live MatchPulse', null, logDetails);
    await flushLogs(env.db);

    return new Response(JSON.stringify({
      success: true,
      message: 'Sync completed successfully.',
      sync_time: isoString,
      results: syncResults
    }), { status: 200, headers });

  } catch (error) {
    const logDetails = `Started: ${startTime} | Error: ${error.message}`;
    try {
      await logChange(env.db, 'system', null, null, '❌ ESPN Live MatchPulse', null, logDetails);
      await flushLogs(env.db);
    } catch (logErr) {
      console.error('Failed to log sync error:', logErr);
    }
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
  if (n.includes('united states') || n === 'usa' || n.includes('usmnt')) return 'usa';
  if (n.includes('bosnia')) return 'bosnia';
  if (n.includes('turkey') || n.includes('turkiye')) return 'turkey';
  if (n.includes('congo') || n.includes('drc')) return 'congo';
  if (n.includes('curacao')) return 'curacao';
  if (n.includes('ivory coast') || n.includes('ivoire') || n.includes('cote d')) return 'ivory coast';
  if (n.includes('cape verde') || n.includes('cabo verde')) return 'cape verde';
  if (n.includes('iran') && !n.includes('iraq')) return 'iran';
  if (n.includes('saudi') || n === 'ksa') return 'saudi arabia';
  return n;
}

// --------------------------------------------------------
// ESPN Scoreboard Sync Implementation (Free, Keyless)
// --------------------------------------------------------
async function syncFromESPN(db) {
  console.log('Syncing from ESPN Scoreboard API...');
  
  const { results: dbMatches } = await db.prepare('SELECT * FROM matches').all();
  const matchUpdates = [];
  
  const datesToFetch = new Set();
  const getYYYYMMDD = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  };
  
  const now = new Date();
  datesToFetch.add(getYYYYMMDD(now));
  
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  datesToFetch.add(getYYYYMMDD(yesterday));
  datesToFetch.add(getYYYYMMDD(tomorrow));
  
  for (const m of dbMatches) {
    if (m.finished === 0 && m.local_date) {
      try {
        const matchDate = new Date(m.local_date);
        if (!isNaN(matchDate.getTime())) {
          datesToFetch.add(getYYYYMMDD(matchDate));
        }
      } catch (e) {
        console.error('Failed to parse match date:', m.local_date, e);
      }
    }
  }
  
  let events = [];
  const fetchedEventIds = new Set();
  
  for (const dateStr of datesToFetch) {
    try {
      console.log(`Fetching ESPN scoreboard for date: ${dateStr}`);
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`);
      if (!res.ok) continue;
      const data = await res.json();
      const dayEvents = data.events || [];
      for (const ev of dayEvents) {
        if (!fetchedEventIds.has(ev.id)) {
          fetchedEventIds.add(ev.id);
          events.push(ev);
        }
      }
    } catch (err) {
      console.error(`Failed to fetch ESPN scoreboard for date ${dateStr}:`, err.message);
    }
  }
  
  let matchesUpdated = 0;
  let finishedDuringSync = 0;
  
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
        console.log(`[Sync] Kickoff time changed for match ${dbMatch.id} (${matchLabel}). Old: ${dbMatch.local_date}, New: ${newLocalDate}.`);
        await logChange(db, 'match_time', dbMatch.id, null, `${matchLabel} Kickoff Time Changed`, dbMatch.local_date, newLocalDate);
      }

      // Get display clock from ESPN
      const displayClock = comp.status?.displayClock || null;

       // Update D1 database
      matchUpdates.push(
        db.prepare(`
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
            display_clock = ?
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
          displayClock,
          dbMatch.id
        )
      );
      
      if (finished === 1 && dbMatch.finished !== 1) {
        finishedDuringSync++;
        await scoreAllPredictionsForMatch(db, dbMatch.id, {
          home_score: homeScore,
          away_score: awayScore,
          over_under_line: dbMatch.over_under_line,
          home_win_pct: dbMatch.home_win_pct,
          away_win_pct: dbMatch.away_win_pct,
          draw_pct: dbMatch.draw_pct,
          actual_cards: actualCards,
          actual_first_scorer: actualFirstScorer,
          home_ht_score: homeHtScore,
          away_ht_score: awayHtScore,
        });
      }
      
      matchesUpdated++;
    }
  }

  if (matchUpdates.length > 0) {
    await db.batch(matchUpdates);
  }
  
  if (matchesUpdated > 0) {
    clearMatchesCache();
    await bumpVersion(db, 'matches');
    if (finishedDuringSync > 0) {
      await recomputeAllCaches(db);
    }
    await emitEvent(db, 'matches_updated');
  }
  
  return { source: 'espn', matchesUpdated, oddsUpdated: 0 };
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
  const oddsUpdates = [];
  
  // 1. Process Odds and Schedules (loop over all matches returned in oddsData)
  for (const match of oddsData) {
    const dbMatch = dbMatches.find(m => 
      normalizeTeamName(m.home_team_name) === normalizeTeamName(match.home_team) && 
      normalizeTeamName(m.away_team_name) === normalizeTeamName(match.away_team)
    );
    
    if (dbMatch) {
      if (dbMatch.odds_locked === 1) {
        continue;
      }
      // Date filter: only update odds for matches scheduled for today and the next 2 days
      let isWithinWindow = false;
      if (dbMatch.local_date) {
        try {
          const tzFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
          const matchDateStr = tzFormatter.format(new Date(dbMatch.local_date));
          const todayDateStr = tzFormatter.format(new Date());
          const diffTime = new Date(`${matchDateStr}T00:00:00`) - new Date(`${todayDateStr}T00:00:00`);
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= 2) {
            isWithinWindow = true;
          }
        } catch (_) {}
      }
      if (!isWithinWindow) {
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
          // Update D1 database with the latest odds only if something changed
        if (dbMatch.home_win_pct !== homePct || dbMatch.away_win_pct !== awayPct || dbMatch.draw_pct !== drawPct ||
            dbMatch.over_under_line !== ouLine || dbMatch.over_odds !== overOdds || dbMatch.under_odds !== underOdds) {
          oddsUpdates.push(
            db.prepare(`
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
            )
          );
          matchesUpdated++;
        }
      }
    }
  }
    
  if (oddsUpdates.length > 0) {
    await db.batch(oddsUpdates);
  }
    
  if (matchesUpdated > 0) {
    clearMatchesCache();
    await bumpVersion(db, 'matches');
    await emitEvent(db, 'matches_updated');
  }

  return { source: 'the-odds-api', matchesUpdated, oddsUpdated };
}

// --------------------------------------------------------
// Midnight Lock and Match Task Helpers
// --------------------------------------------------------

async function handleLockMatchTask(db, matchId, apiKey) {
  console.log(`[Lock Task] Locking odds for match ${matchId}...`);
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
          normalizeTeamName(m.home_team) === normalizeTeamName(match.home_team_name) && 
          normalizeTeamName(m.away_team) === normalizeTeamName(match.away_team_name)
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
  
  await bumpVersion(db, 'matches');
  
  console.log(`[Lock Task] Successfully updated and locked odds for match ${matchId}.`);
}

async function handleScoreMatchTask(db, matchId) {
  console.log(`[Score Task] Syncing score and completing predictions for match ${matchId}...`);
  const match = await db.prepare(`
    SELECT m.*, t1.fifa_code AS home_code, t2.fifa_code AS away_code
    FROM matches m
    LEFT JOIN teams t1 ON m.home_team_id = t1.id
    LEFT JOIN teams t2 ON m.away_team_id = t2.id
    WHERE m.id = ?
  `).bind(matchId).first();
  if (!match) {
    throw new Error(`Match ${matchId} not found in database.`);
  }
  
  // Format localDate as YYYYMMDD
  const dateObj = new Date(match.local_date);
  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getUTCDate()).padStart(2, '0');
  const yyyymmdd = `${year}${month}${day}`;
  
  console.log(`[Score Task] Fetching ESPN scoreboard for date: ${yyyymmdd}`);
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${yyyymmdd}`);
  const data = await res.json();
  const events = data.events || [];
  
  let matchFound = false;
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
      
      await bumpVersion(db, 'matches');
      
      if (finished === 1) {
        await scoreAllPredictionsForMatch(db, matchId, {
          home_score: homeScore,
          away_score: awayScore,
          over_under_line: match.over_under_line,
          home_win_pct: match.home_win_pct,
          away_win_pct: match.away_win_pct,
          draw_pct: match.draw_pct,
          actual_cards: actualCards,
          actual_first_scorer: actualFirstScorer,
          home_ht_score: homeHtScore,
          away_ht_score: awayHtScore,
        });
        await recomputeAllCaches(db);
      }
      break;
    }
  }
  
  if (!matchFound) {
    console.log(`[Score Task] Match ${matchId} not found in ESPN scoreboard events.`);
  }
}

async function handleMidnightLock(db, apiKey) {
  const todayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = todayFormatter.format(new Date());

  const { results: matches } = await db.prepare(
    "SELECT * FROM matches WHERE odds_locked = 0 AND finished = 0"
  ).all();

  if (!matches || matches.length === 0) {
    console.log('[Midnight Lock] No unlocked matches found.');
    return { updated: 0, locked: 0 };
  }

  const sportKey = 'soccer_fifa_world_cup';
  const oddsRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${apiKey}&regions=us&markets=h2h,totals&oddsFormat=decimal`);
  const oddsData = await oddsRes.json();

  if (oddsRes.status !== 200) {
    throw new Error(`The Odds API error: ${JSON.stringify(oddsData)}`);
  }

  let updated = 0;
  let locked = 0;
  const midnightUpdates = [];

  for (const match of oddsData) {
    const dbMatch = matches.find(m =>
      normalizeTeamName(m.home_team_name) === normalizeTeamName(match.home_team) &&
      normalizeTeamName(m.away_team_name) === normalizeTeamName(match.away_team)
    );

    if (!dbMatch) continue;

    // Date filter: only update odds for matches scheduled for today and the next 2 days
    let isWithinWindow = false;
    if (dbMatch.local_date) {
      try {
        const tzFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
        const matchDateStr = tzFormatter.format(new Date(dbMatch.local_date));
        const todayDateStr = tzFormatter.format(new Date());
        const diffTime = new Date(`${matchDateStr}T00:00:00`) - new Date(`${todayDateStr}T00:00:00`);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 2) {
          isWithinWindow = true;
        }
      } catch (_) {}
    }
    if (!isWithinWindow) {
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

    let isToday = false;
    if (dbMatch.local_date) {
      try {
        const md = new Date(dbMatch.local_date.replace(' ', 'T'));
        const matchDate = todayFormatter.format(md);
        isToday = matchDate === today;
      } catch (_) {}
    }

    midnightUpdates.push(
      db.prepare(`
        UPDATE matches
        SET
          home_win_pct = ?,
          away_win_pct = ?,
          draw_pct = ?,
          over_under_line = ?,
          over_odds = ?,
          under_odds = ?,
          odds_updated_at = ?,
          odds_locked = CASE WHEN ? = 1 THEN 1 ELSE odds_locked END
        WHERE id = ?
      `).bind(
        homePct, awayPct, drawPct,
        ouLine, overOdds, underOdds,
        new Date().toISOString(),
        isToday ? 1 : 0,
        dbMatch.id
      )
    );

    updated++;
    if (isToday) locked++;
  }

  if (midnightUpdates.length > 0) {
    await db.batch(midnightUpdates);
    await bumpVersion(db, 'matches');
  }

  await logChange(db, 'system', null, null, '🌙 Midnight Odds Lock', null, `Updated: ${updated}, Locked Today: ${locked}`);
  console.log(`[Midnight Lock] Updated ${updated} matches, locked ${locked} today's matches.`);

  return { updated, locked };
}
