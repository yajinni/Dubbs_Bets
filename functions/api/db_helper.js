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


    // 1. Check if matches table exists
    const checkTable = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='matches'"
    ).first();

    if (checkTable) {
      // Check if table has data to prevent skipping seeding on empty tables
      const countMatches = await db.prepare("SELECT COUNT(*) as count FROM matches").first();
      if (countMatches && countMatches.count > 0) {
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
