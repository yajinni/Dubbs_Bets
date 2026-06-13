import { execSync } from 'child_process';

console.log('Fetching win pct logs from remote D1 database...');
const output = execSync('npx wrangler d1 execute worldcup_predictions --remote --json --command "SELECT * FROM logs WHERE description LIKE \'%win pct%\'"', { encoding: 'utf-8' });

let data;
try {
  // Wrangler returns JSON output wrapped or direct
  const parsed = JSON.parse(output);
  data = parsed[0]?.results || [];
} catch (err) {
  console.error('Failed to parse wrangler output:', err);
  process.exit(1);
}

if (data.length === 0) {
  console.log('No win pct logs found to migrate.');
  process.exit(0);
}

console.log(`Found ${data.length} individual win pct logs. Grouping them...`);

// Group logs by match_id and timestamp proximity (within 10 seconds)
const groups = [];
for (const log of data) {
  const time = new Date(log.timestamp).getTime();
  let foundGroup = false;

  for (const group of groups) {
    if (group.match_id === log.match_id && Math.abs(group.time - time) < 10000) {
      group.logs.push(log);
      foundGroup = true;
      break;
    }
  }

  if (!foundGroup) {
    groups.push({
      match_id: log.match_id,
      time: time,
      timestamp: log.timestamp,
      logs: [log]
    });
  }
}

console.log(`Grouped into ${groups.length} distinct events.`);

const sqlStatements = [];

for (const group of groups) {
  const idsToDelete = group.logs.map(l => l.id);
  
  // Extract match label from one of the logs
  // Description example: "Brazil vs Morocco home win pct (sync)" -> "Brazil vs Morocco"
  const sampleDesc = group.logs[0].description;
  const matchLabel = sampleDesc.split(' home win pct')[0]
                              .split(' away win pct')[0]
                              .split(' draw pct')[0];

  // We need to construct old/new values.
  // We'll read what we have in the logs, and fill in placeholders if some aren't in the group.
  let oldHome = '?', newHome = '?';
  let oldDraw = '?', newDraw = '?';
  let oldAway = '?', newAway = '?';

  // Determine if it was (sync) or (admin)
  const isSync = sampleDesc.includes('(sync)');
  const suffix = isSync ? '(sync)' : '(admin)';

  for (const log of group.logs) {
    if (log.description.includes('home win pct')) {
      oldHome = log.old_value;
      newHome = log.new_value;
    } else if (log.description.includes('draw pct')) {
      oldDraw = log.old_value;
      newDraw = log.new_value;
    } else if (log.description.includes('away win pct')) {
      oldAway = log.old_value;
      newAway = log.new_value;
    }
  }

  const oldVal = `H: ${oldHome}%, D: ${oldDraw}%, A: ${oldAway}%`;
  const newVal = `H: ${newHome}%, D: ${newDraw}%, A: ${newAway}%`;
  const newDesc = `${matchLabel} win probabilities ${suffix}`;

  // 1. Delete old rows
  sqlStatements.push(`DELETE FROM logs WHERE id IN (${idsToDelete.join(',')});`);
  
  // 2. Insert new grouped row
  // We escape single quotes in strings for SQL insertion safety
  const escDesc = newDesc.replace(/'/g, "''");
  const escOld = oldVal.replace(/'/g, "''");
  const escNew = newVal.replace(/'/g, "''");
  sqlStatements.push(`INSERT INTO logs (timestamp, category, match_id, participant_id, description, old_value, new_value) VALUES ('${group.timestamp}', 'odds', ${group.match_id}, NULL, '${escDesc}', '${escOld}', '${escNew}');`);
}

if (sqlStatements.length > 0) {
  console.log(`Generated ${sqlStatements.length} SQL statements. Executing on remote database...`);
  // Write to a temporary SQL file to execute it in one go
  const sqlContent = sqlStatements.join('\n');
  const fs = await import('fs');
  fs.writeFileSync('scratch/migrate.sql', sqlContent);
  
  try {
    const runOutput = execSync('npx wrangler d1 execute worldcup_predictions --remote --file=scratch/migrate.sql', { encoding: 'utf-8' });
    console.log(runOutput);
    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Failed to run SQL migration file:', err.message);
  } finally {
    try {
      fs.unlinkSync('scratch/migrate.sql');
    } catch(e){}
  }
} else {
  console.log('No migration statements needed.');
}
