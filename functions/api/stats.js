import { checkAndInitDb, recomputeStatsCache } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    // 1. Fetch per-participant stats from cache
    let { results: rawStats } = await env.db.prepare(`
      SELECT * FROM stats_cache ORDER BY total_points DESC
    `).all();

    if (!rawStats || rawStats.length === 0) {
      await recomputeStatsCache(env.db);
      const refetch = await env.db.prepare(`
        SELECT * FROM stats_cache ORDER BY total_points DESC
      `).all();
      rawStats = refetch.results || [];
    }

    // Map snake_case DB columns to camelCase for frontend consistency
    const statsRows = (rawStats || []).map(r => ({
      participant_id: r.participant_id,
      name: r.name,
      totalFinishedPreds: r.total_finished_preds,
      correctWinners: r.correct_winners,
      correctOu: r.correct_ou,
      underdogCorrect: r.underdog_correct,
      underdogAttempts: r.underdog_attempts,
      correctScores: r.correct_scores,
      correctFirstScorers: r.correct_first_scorers,
      correctExactCards: r.correct_exact_cards,
      correctHalf: r.correct_half,
      correctClean: r.correct_clean,
      winnerPct: r.winner_pct,
      ouPct: r.ou_pct,
      underdogPct: r.underdog_pct,
      firstScorerPct: r.first_scorer_pct,
      exactCardsPct: r.exact_cards_pct,
      halfPct: r.half_pct,
      cleanPct: r.clean_pct,
      scorePct: r.score_pct,
      totalPoints: r.total_points,
      medianPerMatch: r.median_per_match,
      maxPerMatch: r.max_per_match,
      medianPerDay: r.median_per_day,
      maxPerDay: r.max_per_day,
    }));

    // 2. Compute "ALL" aggregate row
    const allStats = {
      name: 'ALL',
      medianPerMatch: 0,
      maxPerMatch: 0,
      medianPerDay: 0,
      maxPerDay: 0,
      winnerPct: 0, ouPct: 0, underdogPct: 0,
      firstScorerPct: 0, halfPct: 0, cleanPct: 0, scorePct: 0, exactCardsPct: 0,
    };
    if (statsRows && statsRows.length > 0) {
      let totalPreds = 0, totalWinners = 0, totalOu = 0, totalUnderdogCor = 0, totalUnderdogAtt = 0;
      let totalScores = 0, totalFS = 0, totalEC = 0, totalHalf = 0, totalClean = 0;
      const allPerMatch = [];
      const allDayMap = {};
      const { results: allFP } = await env.db.prepare(`
        SELECT pr.*, m.local_date, m.home_win_pct, m.away_win_pct, m.draw_pct
        FROM predictions pr
        INNER JOIN matches m ON pr.match_id = m.id
        WHERE m.finished = 1
      `).all();
      if (allFP) {
        totalPreds = allFP.length;
        allFP.forEach(p => {
          totalWinners += p.points_winner > 0 ? 1 : 0;
          totalOu += p.points_ou > 0 ? 1 : 0;
          totalScores += p.points_score > 0 ? 1 : 0;
          totalFS += p.points_first_scorer > 0 ? 1 : 0;
          totalEC += p.points_total_cards > 0 ? 1 : 0;
          totalHalf += p.points_highest_scoring_half > 0 ? 1 : 0;
          totalClean += p.points_clean_sheet > 0 ? 1 : 0;
          if (p.points_cards_ou > 0) totalUnderdogCor++;
          if (p.predicted_winner && p.home_win_pct != null && p.away_win_pct != null && p.draw_pct != null) {
            const maxPct = Math.max(p.home_win_pct, p.away_win_pct, p.draw_pct);
            if ((p.predicted_winner === 'home' && p.home_win_pct < maxPct) ||
                (p.predicted_winner === 'away' && p.away_win_pct < maxPct) ||
                (p.predicted_winner === 'draw' && p.draw_pct < maxPct)) {
              totalUnderdogAtt++;
            }
          }
          allPerMatch.push(p.total_points || 0);
          if (p.local_date) {
            try {
              const d = new Date(p.local_date.replace(' ', 'T'));
              const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
              allDayMap[ds] = (allDayMap[ds] || 0) + (p.total_points || 0);
            } catch(_) {}
          }
        });
      }
      const calcMedian = (arr) => {
        if (arr.length === 0) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 !== 0 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
      };
      allStats.medianPerMatch = calcMedian(allPerMatch);
      allStats.maxPerMatch = allPerMatch.length > 0 ? Math.max(...allPerMatch) : 0;
      allStats.medianPerDay = calcMedian(Object.values(allDayMap));
      allStats.maxPerDay = Object.values(allDayMap).length > 0 ? Math.max(...Object.values(allDayMap)) : 0;
      allStats.winnerPct = totalPreds > 0 ? Math.round((totalWinners / totalPreds) * 100) : 0;
      allStats.ouPct = totalPreds > 0 ? Math.round((totalOu / totalPreds) * 100) : 0;
      allStats.underdogPct = totalUnderdogAtt > 0 ? Math.round((totalUnderdogCor / totalUnderdogAtt) * 100) : 0;
      allStats.firstScorerPct = totalPreds > 0 ? Math.round((totalFS / totalPreds) * 100) : 0;
      allStats.halfPct = totalPreds > 0 ? Math.round((totalHalf / totalPreds) * 100) : 0;
      allStats.cleanPct = totalPreds > 0 ? Math.round((totalClean / totalPreds) * 100) : 0;
      allStats.scorePct = totalPreds > 0 ? Math.round((totalScores / totalPreds) * 100) : 0;
      allStats.exactCardsPct = totalPreds > 0 ? Math.round((totalEC / totalPreds) * 100) : 0;
    }

    // 3. Find top single-game performance
    let topSingleGame = null;
    const { results: bestGame } = await env.db.prepare(`
      SELECT pr.*, p.name AS participant_name, m.home_team_name, m.away_team_name, m.home_score, m.away_score, m.local_date
      FROM predictions pr
      INNER JOIN participants p ON pr.participant_id = p.id
      INNER JOIN matches m ON pr.match_id = m.id
      WHERE m.finished = 1
      ORDER BY pr.total_points DESC
      LIMIT 1
    `).all();
    if (bestGame && bestGame.length > 0) {
      topSingleGame = bestGame[0];
    }

    // 4. Find top single-day performance
    let topSingleDay = null;
    const { results: allForDays } = await env.db.prepare(`
      SELECT pr.participant_id, pr.total_points, m.local_date
      FROM predictions pr
      INNER JOIN matches m ON pr.match_id = m.id
      WHERE m.finished = 1
    `).all();
    if (allForDays) {
      const dayMap = {};
      for (const p of allForDays) {
        if (!p.local_date) continue;
        try {
          const d = new Date(p.local_date.replace(' ', 'T'));
          const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
          const key = `${p.participant_id}_${ds}`;
          dayMap[key] = (dayMap[key] || 0) + (p.total_points || 0);
        } catch(_) {}
      }
      const { results: participantNames } = await env.db.prepare('SELECT id, name FROM participants').all();
      const nameMap = {};
      for (const p of participantNames || []) nameMap[p.id] = p.name;
      let maxDayPts = 0;
      for (const [key, pts] of Object.entries(dayMap)) {
        if (pts > maxDayPts) {
          maxDayPts = pts;
          const [pId, dateStr] = key.split('_');
          topSingleDay = { name: nameMap[parseInt(pId)] || `Player ${pId}`, points: pts, date: dateStr };
        }
      }
    }

    // 5. Build chart data (daily points per participant)
    const { results: chartParticipants } = await env.db.prepare('SELECT id, name FROM participants').all();
    const { results: finishedMatches } = await env.db.prepare('SELECT * FROM matches WHERE finished = 1 ORDER BY local_date ASC, id ASC').all();

    const toESTDate = (isoStr) => {
      if (!isoStr) return null;
      try {
        const d = new Date(isoStr.replace(' ', 'T'));
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      } catch(_) { return null; }
    };

    const dateSet = new Set();
    const matchDates = {};
    for (const m of finishedMatches || []) {
      const ds = toESTDate(m.local_date);
      if (ds) {
        dateSet.add(ds);
        if (!matchDates[ds]) matchDates[ds] = [];
        matchDates[ds].push(m.id);
      }
    }
    const dates = [...dateSet].sort();

    const dailyPoints = {};
    for (const p of chartParticipants || []) {
      dailyPoints[p.id] = {};
      for (const date of dates) {
        dailyPoints[p.id][date] = 0;
      }
    }

    const { results: chartPreds } = await env.db.prepare(`
      SELECT pr.participant_id, pr.match_id, pr.total_points, m.local_date
      FROM predictions pr
      INNER JOIN matches m ON pr.match_id = m.id
      WHERE m.finished = 1
    `).all();

    for (const pred of chartPreds || []) {
      const ds = toESTDate(pred.local_date);
      if (ds && dailyPoints[pred.participant_id] !== undefined) {
        dailyPoints[pred.participant_id][ds] = (dailyPoints[pred.participant_id][ds] || 0) + (pred.total_points || 0);
      }
    }

    // 6. Get running points map
    const { results: runningPoints } = await env.db.prepare(`
      SELECT participant_id, match_id, total_points FROM running_points_cache
    `).all();

    const runningPointsMap = {};
    for (const rp of runningPoints || []) {
      runningPointsMap[`${rp.participant_id}_${rp.match_id}`] = rp.total_points;
    }

    // 7. Compute Super Stats (per-participant per-game and per-day metrics)
    const gamePointsMap = {};
    const dayPointsMap = {};
    for (const p of chartPreds || []) {
      if (!p.participant_id) continue;
      if (!gamePointsMap[p.participant_id]) {
        gamePointsMap[p.participant_id] = [];
        dayPointsMap[p.participant_id] = {};
      }
      gamePointsMap[p.participant_id].push(p.total_points || 0);
      if (p.local_date) {
        try {
          const d = new Date(p.local_date.replace(' ', 'T'));
          const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
          dayPointsMap[p.participant_id][ds] = (dayPointsMap[p.participant_id][ds] || 0) + (p.total_points || 0);
        } catch(_) {}
      }
    }

    const calcMean = (arr) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
    const calcStd = (arr) => {
      if (arr.length < 2) return 0;
      const m = calcMean(arr);
      return Math.sqrt(arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (arr.length - 1));
    };
    const calcCV = (arr) => {
      const m = calcMean(arr);
      const s = calcStd(arr);
      if (m === 0) return 0;
      return s / m;
    };
    const calcSkew = (arr) => {
      if (arr.length < 3) return 0;
      const n = arr.length;
      const m = calcMean(arr);
      const s = calcStd(arr);
      if (s === 0) return 0;
      const sumCubed = arr.reduce((sum, v) => sum + Math.pow((v - m) / s, 3), 0);
      return (n / ((n - 1) * (n - 2))) * sumCubed;
    };
    const calcPercentile = (arr, p) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const rank = p * (sorted.length - 1);
      const lower = Math.floor(rank);
      const upper = Math.ceil(rank);
      if (lower === upper) return sorted[lower];
      return sorted[lower] * (upper - rank) + sorted[upper] * (rank - lower);
    };
    const calcSharpe = (arr) => {
      const m = calcMean(arr);
      const s = calcStd(arr);
      if (s === 0) return 0;
      return m / s;
    };
    const r3 = (v) => v === 0 ? 0 : Math.round(v * 1000) / 1000;
    const r1 = (v) => Math.round(v * 10) / 10;

    const superStatsRows = (statsRows || []).map(r => {
      const pid = r.participant_id;
      const gamePoints = gamePointsMap[pid] || [];
      const dayPoints = Object.values(dayPointsMap[pid] || {});
      return {
        participant_id: pid,
        perGame: { cv: r3(calcCV(gamePoints)), skew: r3(calcSkew(gamePoints)), floor: r1(calcPercentile(gamePoints, 0.25)), sharpe: r3(calcSharpe(gamePoints)) },
        perDay: { cv: r3(calcCV(dayPoints)), skew: r3(calcSkew(dayPoints)), floor: r1(calcPercentile(dayPoints, 0.25)), sharpe: r3(calcSharpe(dayPoints)) },
      };
    });

    const allGamePoints = [];
    const allDayPointsSet = {};
    for (const p of chartPreds || []) {
      allGamePoints.push(p.total_points || 0);
      if (p.local_date) {
        try {
          const d = new Date(p.local_date.replace(' ', 'T'));
          const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
          allDayPointsSet[ds] = (allDayPointsSet[ds] || 0) + (p.total_points || 0);
        } catch(_) {}
      }
    }
    const allDayPoints = Object.values(allDayPointsSet);
    const allSuperStats = {
      perGame: { cv: r3(calcCV(allGamePoints)), skew: r3(calcSkew(allGamePoints)), floor: r1(calcPercentile(allGamePoints, 0.25)), sharpe: r3(calcSharpe(allGamePoints)) },
      perDay: { cv: r3(calcCV(allDayPoints)), skew: r3(calcSkew(allDayPoints)), floor: r1(calcPercentile(allDayPoints, 0.25)), sharpe: r3(calcSharpe(allDayPoints)) },
    };

    return new Response(JSON.stringify({
      stats: statsRows || [],
      allRow: allStats,
      chartData: { dates, daily: dailyPoints },
      topSingleGame: topSingleGame ? {
        participant_name: topSingleGame.participant_name,
        total_points: topSingleGame.total_points,
        home_team_name: topSingleGame.home_team_name,
        away_team_name: topSingleGame.away_team_name,
        home_score: topSingleGame.home_score,
        away_score: topSingleGame.away_score,
        match_id: topSingleGame.match_id,
      } : null,
      topSingleDay,
      runningPointsMap,
      superStats: { rows: superStatsRows, allRow: allSuperStats },
    }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}