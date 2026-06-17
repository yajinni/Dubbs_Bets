// Database self-initialization helper for Cloudflare D1
import { SCHEMA_SQL, TEAMS_SQL, MATCHES_SQL } from './db_init_data.js';

let _dbInitialized = false;
let _matchesCache = null;
let _matchesCacheTime = 0;
const MATCHES_CACHE_TTL = 30000;

export function getMatchesCache() {
  if (_matchesCache && Date.now() - _matchesCacheTime < MATCHES_CACHE_TTL) {
    return _matchesCache;
  }
  return null;
}

export function setMatchesCache(data) {
  _matchesCache = data;
  _matchesCacheTime = Date.now();
}

export function clearMatchesCache() {
  _matchesCache = null;
  _matchesCacheTime = 0;
}

export async function checkAndInitDb(db) {
  try {
    // Fast path: skip migrations/consolidation if already initialized
    if (_dbInitialized) return;
    try {
      const initialized = await db.prepare("SELECT value FROM settings WHERE key = 'db_initialized'").first();
      if (initialized) {
        _dbInitialized = true;
        return;
      }
    } catch(e) {}

    // Dynamic Schema Migrations for Cards Prop Bets
    try { await db.prepare("ALTER TABLE matches ADD COLUMN cards_line REAL DEFAULT 3.5").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN cards_over_odds REAL DEFAULT 1.9").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN cards_under_odds REAL DEFAULT 1.9").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN actual_cards INTEGER DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN actual_first_scorer TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN predicted_cards_over_under TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN points_cards_ou INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN predicted_total_cards INTEGER DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN points_total_cards INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN predicted_first_scorer TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN points_first_scorer INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN home_ht_score INTEGER DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN away_ht_score INTEGER DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN predicted_highest_scoring_half TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN predicted_clean_sheet TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN points_highest_scoring_half INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE predictions ADD COLUMN points_clean_sheet INTEGER DEFAULT 0").run(); } catch(e){}
    // ESPN event ID for live feed
    try { await db.prepare("ALTER TABLE matches ADD COLUMN espn_event_id TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN odds_locked INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN qstash_scheduled INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN qstash_lock_msg_id TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN qstash_score_msg_id TEXT DEFAULT NULL").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE matches ADD COLUMN odds_updated_at TEXT DEFAULT NULL").run(); } catch(e){}

    // Logs table for changes
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
          category TEXT NOT NULL,
          match_id INTEGER,
          participant_id INTEGER,
          description TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT
        )
      `).run();
    } catch(e){}


    // Events table for SSE real-time notifications
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();
    } catch(e){}


    // Stats cache table
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS stats_cache (
          participant_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          total_finished_preds INTEGER DEFAULT 0,
          correct_winners INTEGER DEFAULT 0,
          correct_ou INTEGER DEFAULT 0,
          underdog_correct INTEGER DEFAULT 0,
          underdog_attempts INTEGER DEFAULT 0,
          correct_scores INTEGER DEFAULT 0,
          correct_first_scorers INTEGER DEFAULT 0,
          correct_exact_cards INTEGER DEFAULT 0,
          correct_half INTEGER DEFAULT 0,
          correct_clean INTEGER DEFAULT 0,
          winner_pct REAL DEFAULT 0,
          ou_pct REAL DEFAULT 0,
          underdog_pct REAL DEFAULT 0,
          first_scorer_pct REAL DEFAULT 0,
          exact_cards_pct REAL DEFAULT 0,
          half_pct REAL DEFAULT 0,
          clean_pct REAL DEFAULT 0,
          score_pct REAL DEFAULT 0,
          total_points REAL DEFAULT 0,
          median_per_match REAL DEFAULT 0,
          max_per_match REAL DEFAULT 0,
          median_per_day REAL DEFAULT 0,
          max_per_day REAL DEFAULT 0
        )
      `).run();
    } catch(e){}

    // Running points cache table (cumulative total per participant per match)
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS running_points_cache (
          participant_id INTEGER,
          match_id INTEGER,
          total_points REAL DEFAULT 0,
          PRIMARY KEY (participant_id, match_id)
        )
      `).run();
    } catch(e){}

    // Leaderboard cache table
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS leaderboard_cache (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          total_points REAL DEFAULT 0,
          correct_winners INTEGER DEFAULT 0,
          correct_ou INTEGER DEFAULT 0,
          correct_scores INTEGER DEFAULT 0,
          correct_first_scorer INTEGER DEFAULT 0,
          correct_total_cards INTEGER DEFAULT 0,
          correct_highest_scoring_half INTEGER DEFAULT 0,
          correct_clean_sheet INTEGER DEFAULT 0,
          correct_bets_count INTEGER DEFAULT 0,
          total_bets_count INTEGER DEFAULT 0
        )
      `).run();
    } catch(e){}


    // 1. Check if matches table exists
    const checkTable = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='matches'"
    ).first();

    if (checkTable) {
      // Check if table has data to prevent skipping seeding on empty tables
      const countMatches = await db.prepare("SELECT COUNT(*) as count FROM matches").first();
      if (countMatches && countMatches.count > 0) {
        await consolidateExistingLogs(db);
        try {
          await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_initialized', '1')").run();
        } catch(e) {}
        _dbInitialized = true;
        return;
      }
    }

    console.log('Database empty! Starting self-seeding...');

    // 2. Execute SCHEMA sql commands
    for (const sql of SCHEMA_SQL) {
      if (sql.trim()) {
        await db.prepare(sql).run();
      }
    }

    // 3. Execute TEAMS sql commands
    for (const sql of TEAMS_SQL) {
      if (sql.trim()) {
        await db.prepare(sql).run();
      }
    }

    // 4. Execute MATCHES sql commands
    for (const sql of MATCHES_SQL) {
      if (sql.trim()) {
        await db.prepare(sql).run();
      }
    }

    try {
      await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('db_initialized', '1')").run();
    } catch(e) {}
    _dbInitialized = true;

    console.log('Successfully completed D1 database self-seeding.');
  } catch (error) {
    console.error('Error during D1 database self-initialization:', error.message);
    throw error;
  }
}

export async function logChange(db, category, matchId, participantId, description, oldValue, newValue) {
  try {
    const isoString = new Date().toISOString();
    await db.prepare(`
      INSERT INTO logs (timestamp, category, match_id, participant_id, description, old_value, new_value)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      isoString,
      category,
      matchId || null,
      participantId || null,
      description,
      oldValue !== undefined && oldValue !== null ? String(oldValue) : null,
      newValue !== undefined && newValue !== null ? String(newValue) : null
    ).run();
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

export async function emitEvent(db, type) {
  try {
    await db.prepare("INSERT INTO events (type) VALUES (?)").bind(type).run();
  } catch (err) {
    console.error('Failed to emit event:', err);
  }
}

export function formatOuPct(overOdds, underOdds) {
  const o = parseFloat(overOdds);
  const u = parseFloat(underOdds);
  if (isNaN(o) || isNaN(u) || o <= 0 || u <= 0) return 'Over: ?%, Under: ?%';
  const pOver = 1.0 / o;
  const pUnder = 1.0 / u;
  const sum = pOver + pUnder;
  const overPct = Math.round((pOver / sum) * 1000) / 10;
  const underPct = Math.round((pUnder / sum) * 1000) / 10;
  return `Over: ${overPct}%, Under: ${underPct}%`;
}

let _logsConsolidated = false;

export async function consolidateExistingLogs(db) {
  try {
    if (_logsConsolidated) return;
    try {
      const done = await db.prepare("SELECT value FROM settings WHERE key = 'logs_consolidated'").first();
      if (done) {
        _logsConsolidated = true;
        return;
      }
    } catch(e) {}

    const { results: predLogs } = await db.prepare("SELECT * FROM logs WHERE category = 'prediction'").all();
    if (!predLogs || predLogs.length === 0) return;

    const oldStyleLogs = predLogs.filter(log => {
      const desc = log.description || '';
      return desc.includes(' winner prediction for ') ||
             desc.includes(' over/under prediction for ') ||
             desc.includes(' score prediction for ') ||
             desc.includes(' total cards prediction for ') ||
             desc.includes(' first scorer prediction for ') ||
             desc.includes(' highest scoring half prediction for ') ||
             desc.includes(' clean sheet prediction for ');
    });

    if (oldStyleLogs.length === 0) return;

    console.log(`[Migration] Found ${oldStyleLogs.length} old-style prediction log entries to consolidate.`);

    oldStyleLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const groups = [];
    for (const log of oldStyleLogs) {
      const logTime = new Date(log.timestamp).getTime();
      let matchedGroup = groups.find(g => 
        g.participant_id === log.participant_id &&
        g.match_id === log.match_id &&
        Math.abs(new Date(g.timestamp).getTime() - logTime) <= 5000
      );

      if (matchedGroup) {
        matchedGroup.logs.push(log);
      } else {
        groups.push({
          participant_id: log.participant_id,
          match_id: log.match_id,
          timestamp: log.timestamp,
          logs: [log]
        });
      }
    }

    for (const g of groups) {
      const oldIds = g.logs.map(l => l.id);
      let participantName = 'Player';
      let matchLabel = 'Match';
      const changes = [];
      let isNewPrediction = true;

      for (const log of g.logs) {
        const desc = log.description || '';
        const types = [
          ' winner prediction for ',
          ' over/under prediction for ',
          ' score prediction for ',
          ' total cards prediction for ',
          ' first scorer prediction for ',
          ' highest scoring half prediction for ',
          ' clean sheet prediction for '
        ];
        
        for (const t of types) {
          if (desc.includes(t)) {
            const parts = desc.split(t);
            if (parts.length === 2) {
              participantName = parts[0];
              matchLabel = parts[1];
              break;
            }
          }
        }
        
        if (log.old_value !== null && log.old_value !== 'null' && log.old_value !== '') {
          isNewPrediction = false;
        }

        let fieldName = 'Unknown';
        if (desc.includes(' winner prediction for ')) fieldName = 'Winner';
        else if (desc.includes(' over/under prediction for ')) fieldName = 'O/U';
        else if (desc.includes(' score prediction for ')) fieldName = 'Score';
        else if (desc.includes(' total cards prediction for ')) fieldName = 'Cards';
        else if (desc.includes(' first scorer prediction for ')) fieldName = 'First Scorer';
        else if (desc.includes(' highest scoring half prediction for ')) fieldName = 'Highest Scoring Half';
        else if (desc.includes(' clean sheet prediction for ')) fieldName = 'Clean Sheet';

        changes.push(`${fieldName}: ${log.old_value || 'None'} -> ${log.new_value || 'None'}`);
      }

      const actionType = isNewPrediction ? 'submitted' : 'updated';
      const description = `${participantName} ${actionType} prediction for ${matchLabel}`;
      const oldValue = isNewPrediction ? 'None' : 'Existing prediction';
      const newValue = changes.join(', ');

      await db.prepare(`
        INSERT INTO logs (timestamp, category, match_id, participant_id, description, old_value, new_value)
        VALUES (?, 'prediction', ?, ?, ?, ?, ?)
      `).bind(g.timestamp, g.match_id, g.participant_id, description, oldValue, newValue).run();

      const deletePlaceholders = oldIds.map(() => '?').join(',');
      await db.prepare(`DELETE FROM logs WHERE id IN (${deletePlaceholders})`).bind(...oldIds).run();
    }

    console.log(`[Migration] Successfully consolidated ${oldStyleLogs.length} entries into ${groups.length} consolidated entries.`);
  } catch (err) {
    console.error('[Migration] Failed to consolidate existing prediction logs:', err.message);
  }
  _logsConsolidated = true;
  try {
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('logs_consolidated', '1')").run();
  } catch(e) {}
}

export async function recomputeLeaderboardCache(db) {
  try {
    await db.prepare(`
      INSERT OR REPLACE INTO leaderboard_cache
      SELECT
        p.id,
        p.name,
        COALESCE(SUM(pred.total_points), 0),
        COALESCE(SUM(CASE WHEN pred.points_winner > 0 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pred.points_ou > 0 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pred.points_score > 0 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pred.points_first_scorer > 0 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pred.points_total_cards > 0 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pred.points_highest_scoring_half > 0 THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pred.points_clean_sheet > 0 THEN 1 ELSE 0 END), 0),
        SUM(CASE WHEN m.finished = 1 THEN
          (CASE WHEN pred.points_winner > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN pred.points_ou > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN pred.points_score > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN pred.points_first_scorer > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN pred.points_total_cards > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN pred.points_highest_scoring_half > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN pred.points_clean_sheet > 0 THEN 1 ELSE 0 END)
        ELSE 0 END),
        SUM(CASE WHEN m.finished = 1 THEN
          (CASE WHEN pred.predicted_winner IS NOT NULL AND pred.predicted_winner != '' THEN 1 ELSE 0 END) +
          (CASE WHEN pred.predicted_over_under IS NOT NULL AND pred.predicted_over_under != '' THEN 1 ELSE 0 END) +
          (CASE WHEN pred.predicted_home_score IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN pred.predicted_first_scorer IS NOT NULL AND pred.predicted_first_scorer != '' THEN 1 ELSE 0 END) +
          (CASE WHEN pred.predicted_total_cards IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN pred.predicted_highest_scoring_half IS NOT NULL AND pred.predicted_highest_scoring_half != '' THEN 1 ELSE 0 END) +
          (CASE WHEN pred.predicted_clean_sheet IS NOT NULL AND pred.predicted_clean_sheet != '' THEN 1 ELSE 0 END)
        ELSE 0 END)
      FROM participants p
      LEFT JOIN predictions pred ON p.id = pred.participant_id
      LEFT JOIN matches m ON pred.match_id = m.id
      GROUP BY p.id, p.name
    `).run();
  } catch (err) {
    console.error('[LeaderboardCache] Failed to recompute:', err.message);
  }
}

export async function recomputeStatsCache(db) {
  try {
    // 1. Recompute running_points_cache: cumulative total before each match for each participant
    await db.prepare(`DELETE FROM running_points_cache`).run();
    const { results: allPredictionsForRP } = await db.prepare(`
      SELECT pr.participant_id, pr.match_id, pr.total_points, m.local_date, m.finished
      FROM predictions pr
      INNER JOIN matches m ON pr.match_id = m.id
      WHERE m.finished = 1
      ORDER BY m.local_date ASC, m.id ASC
    `).all();

    if (allPredictionsForRP && allPredictionsForRP.length > 0) {
      const runningTotals = {};
      for (const pred of allPredictionsForRP) {
        const key = `${pred.participant_id}_${pred.match_id}`;
        const prev = runningTotals[`${pred.participant_id}_prev`] || 0;
        // running_total = points from all previous finished matches (excludes current)
        runningTotals[key] = prev;
        runningTotals[`${pred.participant_id}_prev`] = prev + (pred.total_points || 0);
      }

      const insertRP = db.prepare(`
        INSERT OR REPLACE INTO running_points_cache (participant_id, match_id, total_points)
        VALUES (?, ?, ?)
      `);
      for (const [key, total_points] of Object.entries(runningTotals)) {
        if (key.includes('_prev')) continue;
        const [pId, mId] = key.split('_');
        await insertRP.bind(parseInt(pId), parseInt(mId), total_points).run();
      }
    }

    // 2. Recompute per-participant stats (matching StatsView.jsx logic)
    const { results: participants } = await db.prepare('SELECT id, name FROM participants').all();
    const { results: matches } = await db.prepare('SELECT * FROM matches').all();
    const finishedMatchIds = new Set((matches || []).filter(m => m.finished === 1).map(m => m.id));

    // Get all predictions for finished matches
    const { results: finishedPreds } = await db.prepare(`
      SELECT pr.*, m.local_date, m.home_win_pct, m.away_win_pct, m.draw_pct
      FROM predictions pr
      INNER JOIN matches m ON pr.match_id = m.id
      WHERE m.finished = 1
    `).all();

    const predsByParticipant = {};
    for (const pred of finishedPreds || []) {
      if (!predsByParticipant[pred.participant_id]) predsByParticipant[pred.participant_id] = [];
      predsByParticipant[pred.participant_id].push(pred);
    }

    const calcMedian = (arr) => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 !== 0 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
    };

    const toDateStr = (isoStr) => {
      try {
        const d = new Date(isoStr.replace(' ', 'T'));
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      } catch (_) {
        return (isoStr || '').split('T')[0];
      }
    };

    const insertStats = db.prepare(`
      INSERT OR REPLACE INTO stats_cache (
        participant_id, name,
        total_finished_preds,
        correct_winners, correct_ou, underdog_correct, underdog_attempts,
        correct_scores, correct_first_scorers, correct_exact_cards, correct_half, correct_clean,
        winner_pct, ou_pct, underdog_pct, first_scorer_pct, exact_cards_pct, half_pct, clean_pct, score_pct,
        total_points,
        median_per_match, max_per_match, median_per_day, max_per_day
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of participants || []) {
      const pPreds = predsByParticipant[p.id] || [];
      const totalFinishedPreds = pPreds.length;

      const correctWinners = pPreds.filter(pred => pred.points_winner > 0).length;
      const correctOu = pPreds.filter(pred => pred.points_ou > 0).length;
      const underdogCorrect = pPreds.filter(pred => pred.points_cards_ou > 0).length;
      const underdogAttempts = pPreds.filter(pred => {
        if (!pred.predicted_winner) return false;
        const m = (matches || []).find(mt => mt.id === pred.match_id);
        if (!m || m.home_win_pct == null || m.away_win_pct == null || m.draw_pct == null) return false;
        const maxPct = Math.max(m.home_win_pct, m.away_win_pct, m.draw_pct);
        if (pred.predicted_winner === 'home' && m.home_win_pct < maxPct) return true;
        if (pred.predicted_winner === 'away' && m.away_win_pct < maxPct) return true;
        if (pred.predicted_winner === 'draw' && m.draw_pct < maxPct) return true;
        return false;
      }).length;
      const correctScores = pPreds.filter(pred => pred.points_score > 0).length;
      const correctFirstScorers = pPreds.filter(pred => pred.points_first_scorer > 0).length;
      const correctExactCards = pPreds.filter(pred => pred.points_total_cards > 0).length;
      const correctHalf = pPreds.filter(pred => pred.points_highest_scoring_half > 0).length;
      const correctClean = pPreds.filter(pred => pred.points_clean_sheet > 0).length;

      const totalPoints = pPreds.reduce((sum, pred) => sum + (pred.total_points || 0), 0);
      const winnerPct = totalFinishedPreds > 0 ? Math.round((correctWinners / totalFinishedPreds) * 100) : 0;
      const ouPct = totalFinishedPreds > 0 ? Math.round((correctOu / totalFinishedPreds) * 100) : 0;
      const scorePct = totalFinishedPreds > 0 ? Math.round((correctScores / totalFinishedPreds) * 100) : 0;
      const firstScorerPct = totalFinishedPreds > 0 ? Math.round((correctFirstScorers / totalFinishedPreds) * 100) : 0;
      const exactCardsPct = totalFinishedPreds > 0 ? Math.round((correctExactCards / totalFinishedPreds) * 100) : 0;
      const halfPct = totalFinishedPreds > 0 ? Math.round((correctHalf / totalFinishedPreds) * 100) : 0;
      const cleanPct = totalFinishedPreds > 0 ? Math.round((correctClean / totalFinishedPreds) * 100) : 0;
      const underdogPct = underdogAttempts > 0 ? Math.round((underdogCorrect / underdogAttempts) * 100) : 0;

      const perMatch = pPreds.map(pred => pred.total_points || 0);
      const dayMap = {};
      pPreds.forEach(pred => {
        const m = (matches || []).find(mt => mt.id === pred.match_id);
        if (m && m.local_date) {
          const ds = toDateStr(m.local_date);
          dayMap[ds] = (dayMap[ds] || 0) + (pred.total_points || 0);
        }
      });
      const medianPerMatch = calcMedian(perMatch);
      const maxPerMatch = perMatch.length > 0 ? Math.max(...perMatch) : 0;
      const medianPerDay = calcMedian(Object.values(dayMap));
      const maxPerDay = Object.values(dayMap).length > 0 ? Math.max(...Object.values(dayMap)) : 0;

      await insertStats.bind(
        p.id, p.name,
        totalFinishedPreds,
        correctWinners, correctOu, underdogCorrect, underdogAttempts,
        correctScores, correctFirstScorers, correctExactCards, correctHalf, correctClean,
        winnerPct, ouPct, underdogPct, firstScorerPct, exactCardsPct, halfPct, cleanPct, scorePct,
        totalPoints,
        medianPerMatch, maxPerMatch, medianPerDay, maxPerDay
      ).run();
    }
  } catch (err) {
    console.error('[StatsCache] Failed to recompute:', err.message);
  }
}
