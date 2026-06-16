// Database self-initialization helper for Cloudflare D1
import { SCHEMA_SQL, TEAMS_SQL, MATCHES_SQL } from './db_init_data.js';

export async function checkAndInitDb(db) {
  try {
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


    // 1. Check if matches table exists
    const checkTable = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='matches'"
    ).first();

    if (checkTable) {
      // Check if table has data to prevent skipping seeding on empty tables
      const countMatches = await db.prepare("SELECT COUNT(*) as count FROM matches").first();
      if (countMatches && countMatches.count > 0) {
        await consolidateExistingLogs(db);
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
    await db.prepare("INSERT INTO events (type, created_at) VALUES (?, ?)")
      .bind(type, new Date().toISOString()).run();
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

export async function consolidateExistingLogs(db) {
  try {
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
}
