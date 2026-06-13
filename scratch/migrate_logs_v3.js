import { execSync } from 'child_process';
import fs from 'fs';

console.log('Fetching logs from remote D1 database...');

// Fetch all logs
const logsOutput = execSync('npx wrangler d1 execute worldcup_predictions --remote --json --command "SELECT * FROM logs WHERE description LIKE \'%O/U Goals%\' OR description LIKE \'%O/U Score First%\'"', { encoding: 'utf-8' });
const logs = JSON.parse(logsOutput)[0]?.results || [];

console.log(`Loaded ${logs.length} over/under logs. Processing...`);

const sqlStatements = [];

function convertOddsStringToPct(oddsStr) {
  // Expected input formats:
  // "Line: 2.5, Over: 2.23, Under: 1.63" or "Line: 3.5, Over: 1.9, Under: 1.9"
  // If ? is present or format doesn't match, we return it as is or handle it
  if (oddsStr.includes('?')) return oddsStr;
  
  const lineMatch = oddsStr.match(/Line:\s*([\d.]+)/);
  const overMatch = oddsStr.match(/Over:\s*([\d.]+)/);
  const underMatch = oddsStr.match(/Under:\s*([\d.]+)/);
  
  if (!lineMatch || !overMatch || !underMatch) return oddsStr;
  
  const line = lineMatch[1];
  const o = parseFloat(overMatch[1]);
  const u = parseFloat(underMatch[1]);
  
  if (isNaN(o) || isNaN(u) || o <= 0 || u <= 0) return oddsStr;
  
  const pOver = 1.0 / o;
  const pUnder = 1.0 / u;
  const sum = pOver + pUnder;
  
  const overPct = Math.round((pOver / sum) * 1000) / 10;
  const underPct = Math.round((pUnder / sum) * 1000) / 10;
  
  return `Line: ${line}, Over: ${overPct}%, Under: ${underPct}%`;
}

for (const log of logs) {
  const newOldValue = convertOddsStringToPct(log.old_value);
  const newNewValue = convertOddsStringToPct(log.new_value);
  
  if (newOldValue !== log.old_value || newNewValue !== log.new_value) {
    const escOld = newOldValue.replace(/'/g, "''");
    const escNew = newNewValue.replace(/'/g, "''");
    sqlStatements.push(`UPDATE logs SET old_value = '${escOld}', new_value = '${escNew}' WHERE id = ${log.id};`);
  }
}

if (sqlStatements.length > 0) {
  console.log(`Generated ${sqlStatements.length} update queries. Executing on D1...`);
  fs.writeFileSync('scratch/migrate_v3.sql', sqlStatements.join('\n'));
  try {
    const runOutput = execSync('npx wrangler d1 execute worldcup_predictions --remote --file=scratch/migrate_v3.sql', { encoding: 'utf-8' });
    console.log(runOutput);
  } catch (err) {
    console.error('SQL Execution failed:', err.message);
  } finally {
    try { fs.unlinkSync('scratch/migrate_v3.sql'); } catch(e){}
  }
} else {
  console.log('No updates required.');
}
