// Database self-initialization helper for Cloudflare D1
import { SCHEMA_SQL, TEAMS_SQL, MATCHES_SQL } from './db_init_data.js';

export async function checkAndInitDb(db) {
  try {
    // 1. Check if matches table exists
    const checkTable = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='matches'"
    ).first();

    if (checkTable) {
      // Database is already initialized
      return;
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
