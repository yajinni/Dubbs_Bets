import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
if (fs.existsSync(dir)) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite'));
  console.log('Found sqlite files:', files);
  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      const db = new DatabaseSync(filePath);
      const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
      const tables = stmt.all().map(row => row.name);
      console.log(`File: ${f} -> Tables:`, tables);
      // DatabaseSync closes automatically or doesn't have close() in some node versions, we don't need to close it manually for sync.
    } catch (err) {
      console.log(`File: ${f} -> Error:`, err.message);
    }
  }
} else {
  console.log('Dir does not exist:', dir);
}
