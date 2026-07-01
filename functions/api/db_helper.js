// Database self-initialization helper for Cloudflare D1
import { SCHEMA_SQL, TEAMS_SQL, MATCHES_SQL } from './db_init_data.js';

let _dbInitialized = false;
let _matchesCache = null;
let _matchesCacheTime = 0;
const MATCHES_CACHE_TTL = 30000;
let _versionsCache = null;
let _versionsCacheTime = 0;
const VERSIONS_CACHE_TTL = 2000;

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

export function getVersionsCache() {
  if (_versionsCache && Date.now() - _versionsCacheTime < VERSIONS_CACHE_TTL) {
    return _versionsCache;
  }
  return null;
}

export function setVersionsCache(data) {
  _versionsCache = data;
  _versionsCacheTime = Date.now();
}

export function clearVersionsCache() {
  _versionsCache = null;
  _versionsCacheTime = 0;
}

export async function checkAndInitDb(db) {
  try {
    // Clear any stale log buffer from previous requests
    _logBuffer = [];

    // Fast path 1: Skip entirely if initialized in worker global memory
    if (_dbInitialized) return;

    // Fast path 2: Check settings if fully initialized and migrated
    const CURRENT_SCHEMA_VERSION = '3'; // Increment this if new migrations are added
    try {
      const initSetting = await db.prepare("SELECT value FROM settings WHERE key = 'db_initialized'").first();
      if (initSetting && initSetting.value === '1') {
        const schemaSetting = await db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").first();
        if (schemaSetting && schemaSetting.value === CURRENT_SCHEMA_VERSION) {
          _dbInitialized = true;
          return;
        }
      }
    } catch (e) {
      // settings table might not exist yet during first boot, fall through to full migrations
    }

    // Always run schema migrations (ALTER TABLE) if schema version doesn't match
    const [matchCols, predCols, lbCols, partCols] = await Promise.all([
      db.prepare("PRAGMA table_info(matches)").all(),
      db.prepare("PRAGMA table_info(predictions)").all(),
      db.prepare("PRAGMA table_info(leaderboard_cache)").all(),
      db.prepare("PRAGMA table_info(participants)").all(),
    ]);
    const existingMatchCols = new Set((matchCols.results || []).map(c => c.name));
    const existingPredCols = new Set((predCols.results || []).map(c => c.name));
    const existingLbCols = new Set((lbCols.results || []).map(c => c.name));
    const existingPartCols = new Set((partCols.results || []).map(c => c.name));

    const matchMigrations = [
      ['cards_line', 'REAL DEFAULT 3.5'],
      ['cards_over_odds', 'REAL DEFAULT 1.9'],
      ['cards_under_odds', 'REAL DEFAULT 1.9'],
      ['actual_cards', 'INTEGER DEFAULT NULL'],
      ['actual_first_scorer', 'TEXT DEFAULT NULL'],
      ['home_ht_score', 'INTEGER DEFAULT NULL'],
      ['away_ht_score', 'INTEGER DEFAULT NULL'],
      ['espn_event_id', 'TEXT DEFAULT NULL'],
      ['odds_locked', 'INTEGER DEFAULT 0'],
      ['odds_updated_at', 'TEXT DEFAULT NULL'],
      ['display_clock', 'TEXT DEFAULT NULL'],
      ['actual_penalties', 'TEXT DEFAULT NULL'],
      ['shootout_winner', 'TEXT DEFAULT NULL'],
    ];
    const predMigrations = [
      ['predicted_cards_over_under', 'TEXT DEFAULT NULL'],
      ['points_cards_ou', 'INTEGER DEFAULT 0'],
      ['predicted_total_cards', 'INTEGER DEFAULT NULL'],
      ['points_total_cards', 'INTEGER DEFAULT 0'],
      ['predicted_first_scorer', 'TEXT DEFAULT NULL'],
      ['points_first_scorer', 'INTEGER DEFAULT 0'],
      ['predicted_highest_scoring_half', 'TEXT DEFAULT NULL'],
      ['predicted_clean_sheet', 'TEXT DEFAULT NULL'],
      ['points_highest_scoring_half', 'INTEGER DEFAULT 0'],
      ['points_clean_sheet', 'INTEGER DEFAULT 0'],
      ['predicted_penalties', 'TEXT DEFAULT NULL'],
      ['points_penalties', 'INTEGER DEFAULT 0'],
    ];

    if (existingMatchCols.size > 0) {
      for (const [col, type] of matchMigrations) {
        if (!existingMatchCols.has(col)) {
          await db.prepare(`ALTER TABLE matches ADD COLUMN ${col} ${type}`).run();
        }
      }
    }
    if (existingPredCols.size > 0) {
      for (const [col, type] of predMigrations) {
        if (!existingPredCols.has(col)) {
          await db.prepare(`ALTER TABLE predictions ADD COLUMN ${col} ${type}`).run();
        }
      }
    }

    // Leaderboard cache migrations
    const lbMigrations = [
      ['correct_underdog', 'INTEGER DEFAULT 0'],
      ['correct_penalties', 'INTEGER DEFAULT 0'],
      ['points_winner', 'REAL DEFAULT 0'],
      ['points_ou', 'REAL DEFAULT 0'],
      ['points_score', 'REAL DEFAULT 0'],
      ['points_first_scorer', 'REAL DEFAULT 0'],
      ['points_total_cards', 'REAL DEFAULT 0'],
      ['points_highest_scoring_half', 'REAL DEFAULT 0'],
      ['points_clean_sheet', 'REAL DEFAULT 0'],
      ['points_underdog', 'REAL DEFAULT 0'],
      ['points_penalties', 'REAL DEFAULT 0'],
    ];
    if (existingLbCols.size > 0) {
      for (const [col, type] of lbMigrations) {
        if (!existingLbCols.has(col)) {
          await db.prepare(`ALTER TABLE leaderboard_cache ADD COLUMN ${col} ${type}`).run();
        }
      }

      // Recompute leaderboard cache if migrations were applied
      if (!existingLbCols.has('correct_underdog')) {
        await recomputeLeaderboardCache(db);
      }
    }

    // Migration: add correct_penalties to stats_cache
    try {
      await db.prepare("ALTER TABLE stats_cache ADD COLUMN correct_penalties INTEGER DEFAULT 0").run();
    } catch(e) { /* column may already exist */ }

    // Migration: record penalties_start_at on first v3 run (used to skip backfill of old matches)
    try {
      const existingPenaltyStart = await db.prepare("SELECT value FROM settings WHERE key = 'penalties_start_at'").first();
      if (!existingPenaltyStart) {
        await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('penalties_start_at', ?)").bind(new Date().toISOString()).run();
      }
    } catch(e) {}

    // Participants migrations
    if (existingPartCols.size > 0 && !existingPartCols.has('nav_layout')) {
      try {
        await db.prepare("ALTER TABLE participants ADD COLUMN nav_layout TEXT DEFAULT NULL").run();
      } catch (_) {}
    }

    // Migration: correct score points changed from 1 to 4 (per the scoring rules)
    if (existingPredCols.size > 0) {
      const fixResult = await db.prepare(`SELECT COUNT(*) as cnt FROM predictions WHERE points_score = 1`).first();
      if (fixResult && fixResult.cnt > 0) {
        await db.prepare(`UPDATE predictions SET points_score = 4, total_points = total_points + 3 WHERE points_score = 1`).run();
        await recomputeLeaderboardCache(db);
      }
    }

    // Migration: ensure indexes exist
    try {
      await db.batch([
        db.prepare("CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_predictions_participant_id ON predictions(participant_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches(finished)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_matches_odds_locked ON matches(odds_locked, finished)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_matches_local_date ON matches(local_date)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC, id DESC)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_logs_match_id ON logs(match_id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category)"),
      ]);
    } catch (e) {
      console.error('[Migration] Failed to create indexes:', e.message);
    }

    // Save schema version
    try {
      await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', ?)").bind(CURRENT_SCHEMA_VERSION).run();
    } catch (e) {}

    // Fast path: skip full init/consolidation if already initialized
    if (_dbInitialized) return;
    try {
      const initialized = await db.prepare("SELECT value FROM settings WHERE key = 'db_initialized'").first();
      if (initialized) {
        _dbInitialized = true;
        return;
      }
    } catch(e) {}

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
          correct_penalties INTEGER DEFAULT 0,
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
          correct_penalties INTEGER DEFAULT 0,
          correct_underdog INTEGER DEFAULT 0,
          points_winner REAL DEFAULT 0,
          points_ou REAL DEFAULT 0,
          points_score REAL DEFAULT 0,
          points_first_scorer REAL DEFAULT 0,
          points_total_cards REAL DEFAULT 0,
          points_highest_scoring_half REAL DEFAULT 0,
          points_clean_sheet REAL DEFAULT 0,
          points_penalties REAL DEFAULT 0,
          points_underdog REAL DEFAULT 0,
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
        try { await recomputeLeaderboardCache(db); } catch(e) { console.error('[Init] recomputeLeaderboardCache error:', e.message); }
        try { await recomputeStatsCache(db); } catch(e) { console.error('[Init] recomputeStatsCache error:', e.message); }
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
    // Prime caches after initial seed
    try { await recomputeLeaderboardCache(db); } catch(e) {}
    try { await recomputeStatsCache(db); } catch(e) {}
    _dbInitialized = true;

    console.log('Successfully completed D1 database self-seeding.');
  } catch (error) {
    console.error('Error during D1 database self-initialization:', error.message);
    throw error;
  }
}

let _logBuffer = [];

export async function logChange(db, category, matchId, participantId, description, oldValue, newValue) {
  _logBuffer.push({
    timestamp: new Date().toISOString(),
    category,
    matchId: matchId || null,
    participantId: participantId || null,
    description,
    oldValue: oldValue !== undefined && oldValue !== null ? String(oldValue) : null,
    newValue: newValue !== undefined && newValue !== null ? String(newValue) : null,
  });
  if (_logBuffer.length >= 20) {
    await flushLogs(db);
  }
}

export async function flushLogs(db) {
  if (_logBuffer.length === 0) return;
  const batch = _logBuffer.splice(0);
  try {
    await db.batch(batch.map(entry =>
      db.prepare(`INSERT INTO logs (timestamp, category, match_id, participant_id, description, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(entry.timestamp, entry.category, entry.matchId, entry.participantId, entry.description, entry.oldValue, entry.newValue)
    ));
  } catch (err) {
    console.error('Failed to flush log batch:', err);
  }
}

export async function emitEvent(db, type) {
  // No-op: events table and SSE polling are replaced with client-side version polling
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
  await db.prepare(`
    INSERT OR REPLACE INTO leaderboard_cache
      (id, name, total_points,
       correct_winners, correct_ou, correct_scores,
       correct_first_scorer, correct_total_cards, correct_highest_scoring_half, correct_clean_sheet,
       correct_penalties,
       correct_bets_count, total_bets_count,
       correct_underdog,
       points_winner, points_ou, points_score,
       points_first_scorer, points_total_cards, points_highest_scoring_half, points_clean_sheet,
       points_penalties,
       points_underdog)
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
      COALESCE(SUM(CASE WHEN pred.points_penalties > 0 THEN 1 ELSE 0 END), 0),
      SUM(CASE WHEN m.finished = 1 THEN
        (CASE WHEN pred.points_winner > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_ou > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_score > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_first_scorer > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_total_cards > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_highest_scoring_half > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_clean_sheet > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_cards_ou > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN pred.points_penalties > 0 THEN 1 ELSE 0 END)
      ELSE 0 END),
      SUM(CASE WHEN m.finished = 1 THEN
        (CASE WHEN pred.predicted_winner IS NOT NULL AND pred.predicted_winner != '' THEN 1 ELSE 0 END) +
        (CASE WHEN pred.predicted_over_under IS NOT NULL AND pred.predicted_over_under != '' THEN 1 ELSE 0 END) +
        (CASE WHEN pred.predicted_home_score IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN pred.predicted_first_scorer IS NOT NULL AND pred.predicted_first_scorer != '' THEN 1 ELSE 0 END) +
        (CASE WHEN pred.predicted_total_cards IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN pred.predicted_highest_scoring_half IS NOT NULL AND pred.predicted_highest_scoring_half != '' THEN 1 ELSE 0 END) +
        (CASE WHEN pred.predicted_clean_sheet IS NOT NULL AND pred.predicted_clean_sheet != '' THEN 1 ELSE 0 END) +
        (CASE WHEN pred.predicted_penalties IS NOT NULL AND pred.predicted_penalties != '' THEN 1 ELSE 0 END)
      ELSE 0 END),
      COALESCE(SUM(CASE WHEN pred.points_cards_ou > 0 THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(pred.points_winner), 0),
      COALESCE(SUM(pred.points_ou), 0),
      COALESCE(SUM(pred.points_score), 0),
      COALESCE(SUM(pred.points_first_scorer), 0),
      COALESCE(SUM(pred.points_total_cards), 0),
      COALESCE(SUM(pred.points_highest_scoring_half), 0),
      COALESCE(SUM(pred.points_clean_sheet), 0),
      COALESCE(SUM(pred.points_penalties), 0),
      COALESCE(SUM(pred.points_cards_ou), 0)
    FROM participants p
    LEFT JOIN predictions pred ON p.id = pred.participant_id
    LEFT JOIN matches m ON pred.match_id = m.id
    GROUP BY p.id, p.name
  `).run();
}

export async function recomputeStatsCache(db) {
  try {
    // 1. Calculate running points in memory
    const { results: allPreds } = await db.prepare(`
      SELECT pr.participant_id, pr.match_id, pr.total_points, m.finished, m.local_date, m.id AS match_id
      FROM predictions pr
      INNER JOIN matches m ON pr.match_id = m.id
    `).all();

    const predsByParticipantForRunning = {};
    for (const pr of allPreds || []) {
      if (!predsByParticipantForRunning[pr.participant_id]) {
        predsByParticipantForRunning[pr.participant_id] = [];
      }
      predsByParticipantForRunning[pr.participant_id].push(pr);
    }

    const runningPointsMap = {};
    for (const pid in predsByParticipantForRunning) {
      const list = predsByParticipantForRunning[pid];
      list.sort((a, b) => {
        const dA = new Date(a.local_date).getTime();
        const dB = new Date(b.local_date).getTime();
        if (dA !== dB) return dA - dB;
        return a.match_id - b.match_id;
      });

      let runningSum = 0;
      for (const pr of list) {
        runningPointsMap[`${pr.participant_id}_${pr.match_id}`] = runningSum;
        if (pr.finished === 1) {
          runningSum += (pr.total_points || 0);
        }
      }
    }

    // Save running points map to settings as JSON
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cached_running_points', ?)")
      .bind(JSON.stringify(runningPointsMap))
      .run();

    // 2. Recompute per-participant stats (matching StatsView.jsx logic)
    const { results: participants } = await db.prepare('SELECT id, name FROM participants').all();
    const { results: matches } = await db.prepare('SELECT * FROM matches').all();
    const finishedMatchIds = new Set((matches || []).filter(m => m.finished === 1).map(m => m.id));

    // Get all predictions for finished matches (include home/away names, scores for JS aggregates)
    const { results: finishedPreds } = await db.prepare(`
      SELECT pr.*, m.local_date, m.home_win_pct, m.away_win_pct, m.draw_pct,
             m.home_team_name, m.away_team_name, m.home_score, m.away_score
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
        correct_scores, correct_first_scorers, correct_exact_cards, correct_half, correct_clean, correct_penalties,
        winner_pct, ou_pct, underdog_pct, first_scorer_pct, exact_cards_pct, half_pct, clean_pct, score_pct,
        total_points,
        median_per_match, max_per_match, median_per_day, max_per_day
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Pre-build matches lookup map for O(1) access
    const matchesById = new Map();
    for (const m of (matches || [])) matchesById.set(m.id, m);

    for (const p of participants || []) {
      const pPreds = predsByParticipant[p.id] || [];
      const totalFinishedPreds = pPreds.length;

      const correctWinners = pPreds.filter(pred => pred.points_winner > 0).length;
      const correctOu = pPreds.filter(pred => pred.points_ou > 0).length;
      const underdogCorrect = pPreds.filter(pred => pred.points_cards_ou > 0).length;
      const underdogAttempts = pPreds.filter(pred => {
        if (!pred.predicted_winner) return false;
        const m = matchesById.get(pred.match_id);
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
      const correctPenalties = pPreds.filter(pred => pred.points_penalties > 0).length;

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
        const m = matchesById.get(pred.match_id);
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
        correctScores, correctFirstScorers, correctExactCards, correctHalf, correctClean, correctPenalties,
        winnerPct, ouPct, underdogPct, firstScorerPct, exactCardsPct, halfPct, cleanPct, scorePct,
        totalPoints,
        medianPerMatch, maxPerMatch, medianPerDay, maxPerDay
      ).run();
    }

    // ─── Compile & Cache Full JSON Payload ───
    const { results: rawStats } = await db.prepare("SELECT * FROM stats_cache ORDER BY total_points DESC").all();
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
      correctPenalties: r.correct_penalties,
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
      let totalScores = 0, totalFS = 0, totalEC = 0, totalHalf = 0, totalClean = 0, totalPenalties = 0;
      const allPerMatch = [];
      const allDayMap = {};

      (finishedPreds || []).forEach(p => {
        totalPreds++;
        totalWinners += p.points_winner > 0 ? 1 : 0;
        totalOu += p.points_ou > 0 ? 1 : 0;
        totalScores += p.points_score > 0 ? 1 : 0;
        totalFS += p.points_first_scorer > 0 ? 1 : 0;
        totalEC += p.points_total_cards > 0 ? 1 : 0;
        totalHalf += p.points_highest_scoring_half > 0 ? 1 : 0;
        totalClean += p.points_clean_sheet > 0 ? 1 : 0;
        totalPenalties += p.points_penalties > 0 ? 1 : 0;
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
          const ds = toDateStr(p.local_date);
          allDayMap[ds] = (allDayMap[ds] || 0) + (p.total_points || 0);
        }
      });

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

    // Top Single Game
    let topSingleGame = [];
    let maxGamePoints = -1;
    const nameMap = {};
    for (const p of participants || []) nameMap[p.id] = p.name;

    for (const pred of finishedPreds || []) {
      if (pred.total_points > maxGamePoints) {
        maxGamePoints = pred.total_points;
        topSingleGame = [{
          participant_name: nameMap[pred.participant_id] || `Player ${pred.participant_id}`,
          total_points: pred.total_points,
          home_team_name: pred.home_team_name,
          away_team_name: pred.away_team_name,
          home_score: pred.home_score,
          away_score: pred.away_score,
          match_id: pred.match_id,
        }];
      } else if (pred.total_points === maxGamePoints && maxGamePoints > 0) {
        topSingleGame.push({
          participant_name: nameMap[pred.participant_id] || `Player ${pred.participant_id}`,
          total_points: pred.total_points,
          home_team_name: pred.home_team_name,
          away_team_name: pred.away_team_name,
          home_score: pred.home_score,
          away_score: pred.away_score,
          match_id: pred.match_id,
        });
      }
    }

    // Top Single Day
    let topSingleDay = [];
    let maxDayPts = 0;
    const dayPointsSumMap = {};
    for (const p of finishedPreds || []) {
      if (!p.local_date) continue;
      const ds = toDateStr(p.local_date);
      const key = `${p.participant_id}_${ds}`;
      dayPointsSumMap[key] = (dayPointsSumMap[key] || 0) + (p.total_points || 0);
    }
    for (const [key, pts] of Object.entries(dayPointsSumMap)) {
      if (pts > maxDayPts) {
        maxDayPts = pts;
        const [pId, dateStr] = key.split('_');
        topSingleDay = [{
          name: nameMap[parseInt(pId)] || `Player ${pId}`,
          points: pts,
          date: dateStr
        }];
      } else if (pts === maxDayPts && maxDayPts > 0) {
        const [pId, dateStr] = key.split('_');
        topSingleDay.push({
          name: nameMap[parseInt(pId)] || `Player ${pId}`,
          points: pts,
          date: dateStr
        });
      }
    }

    // Chart Data
    const finishedMatches = (matches || [])
      .filter(m => m.finished === 1)
      .sort((a, b) => new Date(a.local_date.replace(' ', 'T')) - new Date(b.local_date.replace(' ', 'T')));
      
    const dateSet = new Set();
    for (const m of finishedMatches) {
      const ds = toDateStr(m.local_date);
      if (ds) dateSet.add(ds);
    }
    const dates = [...dateSet].sort();

    const dailyPoints = {};
    for (const p of participants || []) {
      dailyPoints[p.id] = {};
      for (const date of dates) {
        dailyPoints[p.id][date] = 0;
      }
    }

    for (const pred of finishedPreds || []) {
      const ds = toDateStr(pred.local_date);
      if (ds && dailyPoints[pred.participant_id] !== undefined) {
        dailyPoints[pred.participant_id][ds] = (dailyPoints[pred.participant_id][ds] || 0) + (pred.total_points || 0);
      }
    }

    // Running points (already calculated in memory at step 1)

    // Super Stats
    const gamePointsMap = {};
    const dayPointsMap = {};
    for (const p of finishedPreds || []) {
      if (!p.participant_id) continue;
      if (!gamePointsMap[p.participant_id]) {
        gamePointsMap[p.participant_id] = [];
        dayPointsMap[p.participant_id] = {};
      }
      gamePointsMap[p.participant_id].push(p.total_points || 0);
      if (p.local_date) {
        const ds = toDateStr(p.local_date);
        dayPointsMap[p.participant_id][ds] = (dayPointsMap[p.participant_id][ds] || 0) + (p.total_points || 0);
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
    for (const p of finishedPreds || []) {
      allGamePoints.push(p.total_points || 0);
      if (p.local_date) {
        const ds = toDateStr(p.local_date);
        allDayPointsSet[ds] = (allDayPointsSet[ds] || 0) + (p.total_points || 0);
      }
    }
    const allDayPoints = Object.values(allDayPointsSet);
    const allSuperStats = {
      perGame: { cv: r3(calcCV(allGamePoints)), skew: r3(calcSkew(allGamePoints)), floor: r1(calcPercentile(allGamePoints, 0.25)), sharpe: r3(calcSharpe(allGamePoints)) },
      perDay: { cv: r3(calcCV(allDayPoints)), skew: r3(calcSkew(allDayPoints)), floor: r1(calcPercentile(allDayPoints, 0.25)), sharpe: r3(calcSharpe(allDayPoints)) },
    };

    const cachedStatsPayload = {
      stats: statsRows || [],
      allRow: allStats,
      chartData: { dates, daily: dailyPoints },
      topSingleGame,
      topSingleDay,
      runningPointsMap,
      superStats: { rows: superStatsRows, allRow: allSuperStats }
    };

    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cached_stats_payload', ?)")
      .bind(JSON.stringify(cachedStatsPayload))
      .run();

  } catch (err) {
    console.error('[StatsCache] Failed to recompute:', err.message);
  }
}

// ── Shared Scoring Engine ────────────────────────────────────────────────────

export function calculatePointsFromPrediction(pred, match) {
  let winner = 'draw';
  if (match.actual_penalties === 'yes' && match.shootout_winner) {
    winner = match.shootout_winner;
  } else {
    if (match.home_score > match.away_score) winner = 'home';
    else if (match.away_score > match.home_score) winner = 'away';
  }

  const totalGoals = match.home_score + match.away_score;
  const ouResult = totalGoals > match.over_under_line ? 'over' : 'under';

  let winnerHalf = null;
  if (match.home_ht_score != null && match.away_ht_score != null) {
    const fh = match.home_ht_score + match.away_ht_score;
    const sh = totalGoals - fh;
    if (fh > sh) winnerHalf = 'first';
    else if (sh > fh) winnerHalf = 'second';
    else winnerHalf = 'equal';
  }

  const cleanSheetHappened = (match.home_score === 0 || match.away_score === 0) ? 'yes' : 'no';

  const points_winner = pred.predicted_winner === winner ? 3 : 0;
  const points_ou = pred.predicted_over_under === ouResult ? 1 : 0;
  const points_score = (pred.predicted_home_score === match.home_score && pred.predicted_away_score === match.away_score) ? 4 : 0;

  let points_cards_ou = 0;
  if (points_winner > 0 && match.home_win_pct != null && match.away_win_pct != null && match.draw_pct != null) {
    const maxPct = Math.max(match.home_win_pct, match.away_win_pct, match.draw_pct);
    if (winner === 'home' && match.home_win_pct < maxPct) points_cards_ou = 1;
    else if (winner === 'away' && match.away_win_pct < maxPct) points_cards_ou = 1;
    else if (winner === 'draw' && match.draw_pct < maxPct) points_cards_ou = 1;
  }

  let points_total_cards = 0;
  if (match.actual_cards != null && pred.predicted_total_cards != null) {
    points_total_cards = pred.predicted_total_cards === match.actual_cards ? 3 : 0;
  }

  let points_first_scorer = 0;
  if (match.actual_first_scorer != null && pred.predicted_first_scorer != null) {
    points_first_scorer = pred.predicted_first_scorer === match.actual_first_scorer ? 2 : 0;
  }

  let points_highest_scoring_half = 0;
  if (pred.predicted_highest_scoring_half != null && winnerHalf != null) {
    points_highest_scoring_half = pred.predicted_highest_scoring_half === winnerHalf ? 2 : 0;
  }

  let points_clean_sheet = 0;
  if (pred.predicted_clean_sheet != null) {
    points_clean_sheet = pred.predicted_clean_sheet === cleanSheetHappened ? 1 : 0;
  }

  let points_penalties = 0;
  if (pred.predicted_penalties != null && match.actual_penalties != null) {
    points_penalties = pred.predicted_penalties === match.actual_penalties ? 2 : 0;
  }

  const total_points = points_winner + points_ou + points_score + points_cards_ou +
    points_total_cards + points_first_scorer + points_highest_scoring_half + points_clean_sheet + points_penalties;

  return { points_winner, points_ou, points_score, points_cards_ou,
    points_total_cards, points_first_scorer, points_highest_scoring_half,
    points_clean_sheet, points_penalties, total_points };
}

export async function scoreAllPredictionsForMatch(db, matchId, match) {
  const { results: predictions } = await db.prepare('SELECT * FROM predictions WHERE match_id = ?').bind(matchId).all();
  if (!predictions || predictions.length === 0) return 0;

  const stmt = db.prepare(`
    UPDATE predictions SET
      points_winner = ?, points_ou = ?, points_score = ?, points_cards_ou = ?,
      points_total_cards = ?, points_first_scorer = ?, points_highest_scoring_half = ?,
      points_clean_sheet = ?, points_penalties = ?, total_points = ?
    WHERE participant_id = ? AND match_id = ?
  `);

  const batch = [];
  for (const pred of predictions) {
    const pts = calculatePointsFromPrediction(pred, match);
    batch.push(
      stmt.bind(
        pts.points_winner, pts.points_ou, pts.points_score, pts.points_cards_ou,
        pts.points_total_cards, pts.points_first_scorer, pts.points_highest_scoring_half,
        pts.points_clean_sheet, pts.points_penalties, pts.total_points,
        pred.participant_id, matchId
      )
    );
  }

  if (batch.length > 0) {
    await db.batch(batch);
  }

  return predictions.length;
}

export async function updateMatchCountsCache(db) {
  try {
    const row = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM matches WHERE status = 'live') AS live,
        (SELECT COUNT(*) FROM matches WHERE finished = 1) AS finished,
        (SELECT COUNT(*) FROM matches WHERE status = 'scheduled' AND finished = 0) AS scheduled
    `).first();
    const payload = JSON.stringify({ live: row?.live || 0, finished: row?.finished || 0, scheduled: row?.scheduled || 0 });
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cached_match_counts', ?)").bind(payload).run();
  } catch (err) {
    console.error('[MatchCounts] Failed to update cache:', err.message);
  }
}

export async function bumpVersion(db, key) {
  const timestamp = new Date().toISOString();
  clearVersionsCache();
  if (key === 'matches') {
    try { await updateMatchCountsCache(db); } catch (_) {}
  }
  try {
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(`version_${key}`, timestamp).run();
  } catch (err) {
    console.error(`Failed to bump version for ${key}:`, err.message);
  }
}

export async function recomputeAllCaches(db) {
  // Recompute leaderboard cache first; if it fails, abort to keep both caches consistent.
  // Without this guard, stats cache could be updated while leaderboard stays stale,
  // causing Running > Total for players.
  try {
    await recomputeLeaderboardCache(db);
  } catch (err) {
    console.error('[AllCaches] Leaderboard cache failed, aborting to prevent inconsistency:', err.message);
    return;
  }
  await recomputeStatsCache(db);
  await bumpVersion(db, 'predictions');
  await bumpVersion(db, 'leaderboard');
  await bumpVersion(db, 'stats');
}
