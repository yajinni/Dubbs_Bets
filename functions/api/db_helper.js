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
