import { execSync } from 'child_process';
import fs from 'fs';

console.log('Fetching logs and teams from remote D1 database...');

// Fetch team mappings
const teamsOutput = execSync('npx wrangler d1 execute worldcup_predictions --remote --json --command "SELECT name_en, fifa_code FROM teams"', { encoding: 'utf-8' });
const teams = JSON.parse(teamsOutput)[0]?.results || [];
const teamMap = {};
for (const t of teams) {
  teamMap[t.name_en.toLowerCase()] = t.fifa_code;
}

// Custom manual overrides for known anomalies
teamMap['curaçao'] = 'CUW';
teamMap['curaã§ao'] = 'CUW';
teamMap['united states'] = 'USA';
teamMap['south africa'] = 'RSA';
teamMap['south korea'] = 'KOR';
teamMap['czech republic'] = 'CZE';
teamMap['bosnia and herzegovina'] = 'BIH';

// Fetch all logs
const logsOutput = execSync('npx wrangler d1 execute worldcup_predictions --remote --json --command "SELECT * FROM logs"', { encoding: 'utf-8' });
const logs = JSON.parse(logsOutput)[0]?.results || [];

console.log(`Loaded ${logs.length} logs. Processing...`);

const sqlStatements = [];

// Helper to replace team names with short names
function shortenDescription(desc) {
  let newDesc = desc;
  
  // Try to find team name patterns like "X vs Y"
  const match = newDesc.match(/(.*?)\s+vs\s+(.*?)(?=\s|$)/i);
  if (match) {
    const originalHome = match[1].trim();
    const originalAway = match[2].trim();
    
    // Check if they match team map keys
    const homeCode = teamMap[originalHome.toLowerCase()] || originalHome.substring(0, 3).toUpperCase();
    const awayCode = teamMap[originalAway.toLowerCase()] || originalAway.substring(0, 3).toUpperCase();
    
    const replacement = `${homeCode} vs ${awayCode}`;
    newDesc = newDesc.replace(`${originalHome} vs ${originalAway}`, replacement);
  }
  
  return newDesc;
}

// 1. First, we rewrite Winner log descriptions (e.g. "BRA vs MAR win probabilities (sync)" -> "BRA vs MAR Winner")
// And replace team names with short names across all log descriptions.
for (const log of logs) {
  let updatedDesc = shortenDescription(log.description);
  
  // Replace "win probabilities (sync)" and "win probabilities (admin)" with "Winner"
  if (updatedDesc.includes('win probabilities')) {
    updatedDesc = updatedDesc.replace('win probabilities (sync)', 'Winner')
                             .replace('win probabilities (admin)', 'Winner')
                             .trim();
  }
  
  if (updatedDesc !== log.description) {
    const escDesc = updatedDesc.replace(/'/g, "''");
    sqlStatements.push(`UPDATE logs SET description = '${escDesc}' WHERE id = ${log.id};`);
    // update local reference so grouping works on the new descriptions
    log.description = updatedDesc;
  }
}

// 2. Combine individual Over/Under Goals line and odds updates into "O/U Goals" log entries
// Over/Under Goals properties to group:
// - "X vs Y over/under line (sync)", "X vs Y over odds (sync)", "X vs Y under odds (sync)"
// - "X vs Y over/under line (admin)", "X vs Y over odds (admin)", "X vs Y under odds (admin)"
const ougroups = [];
for (const log of logs) {
  const isGoalOU = log.description.includes('over/under line') || 
                   log.description.includes('over odds') || 
                   log.description.includes('under odds');
  if (!isGoalOU) continue;
  
  const time = new Date(log.timestamp).getTime();
  let foundGroup = false;
  
  // Extract match label from description e.g. "BRA vs MAR over/under line (sync)" -> "BRA vs MAR"
  const matchLabel = log.description.split(' over/under line')[0]
                                     .split(' over odds')[0]
                                     .split(' under odds')[0].trim();

  for (const group of ougroups) {
    if (group.matchLabel === matchLabel && Math.abs(group.time - time) < 10000) {
      group.logs.push(log);
      foundGroup = true;
      break;
    }
  }
  
  if (!foundGroup) {
    ougroups.push({
      matchLabel,
      time,
      timestamp: log.timestamp,
      match_id: log.match_id,
      logs: [log]
    });
  }
}

for (const group of ougroups) {
  const idsToDelete = group.logs.map(l => l.id);
  
  let line = '?', over = '?', under = '?';
  for (const log of group.logs) {
    if (log.description.includes('over/under line')) {
      line = log.new_value;
    } else if (log.description.includes('over odds')) {
      over = log.new_value;
    } else if (log.description.includes('under odds')) {
      under = log.new_value;
    }
  }
  
  // Let's check old values if available
  let oldLine = '?', oldOver = '?', oldUnder = '?';
  for (const log of group.logs) {
    if (log.description.includes('over/under line')) {
      oldLine = log.old_value;
    } else if (log.description.includes('over odds')) {
      oldOver = log.old_value;
    } else if (log.description.includes('under odds')) {
      oldUnder = log.old_value;
    }
  }

  const oldVal = `Line: ${oldLine}, Over: ${oldOver}, Under: ${oldUnder}`;
  const newVal = `Line: ${line}, Over: ${over}, Under: ${under}`;
  const newDesc = `${group.matchLabel} O/U Goals`;

  sqlStatements.push(`DELETE FROM logs WHERE id IN (${idsToDelete.join(',')});`);
  const escDesc = newDesc.replace(/'/g, "''");
  const escOld = oldVal.replace(/'/g, "''");
  const escNew = newVal.replace(/'/g, "''");
  sqlStatements.push(`INSERT INTO logs (timestamp, category, match_id, participant_id, description, old_value, new_value) VALUES ('${group.timestamp}', 'odds', ${group.match_id}, NULL, '${escDesc}', '${escOld}', '${escNew}');`);
}

// 3. Combine individual Cards line changes into O/U Score First logs
// In logs, we might have "X vs Y cards line (admin)" or cards over/under changes.
const cardsGroups = [];
for (const log of logs) {
  const isCards = log.description.includes('cards line') || 
                  log.description.includes('O/U Score First'); // already migrated or partially done
  if (!isCards) continue;
  
  const time = new Date(log.timestamp).getTime();
  let foundGroup = false;
  
  const matchLabel = log.description.split(' cards line')[0]
                                     .split(' O/U Score First')[0].trim();

  for (const group of cardsGroups) {
    if (group.matchLabel === matchLabel && Math.abs(group.time - time) < 10000) {
      group.logs.push(log);
      foundGroup = true;
      break;
    }
  }
  
  if (!foundGroup) {
    cardsGroups.push({
      matchLabel,
      time,
      timestamp: log.timestamp,
      match_id: log.match_id,
      logs: [log]
    });
  }
}

for (const group of cardsGroups) {
  const idsToDelete = group.logs.map(l => l.id);
  
  let line = '?', over = '1.9', under = '1.9';
  let oldLine = '?', oldOver = '1.9', oldUnder = '1.9';
  
  for (const log of group.logs) {
    if (log.description.includes('cards line')) {
      line = log.new_value;
      oldLine = log.old_value;
    }
  }

  const oldVal = `Line: ${oldLine}, Over: ${oldOver}, Under: ${oldUnder}`;
  const newVal = `Line: ${line}, Over: ${over}, Under: ${under}`;
  const newDesc = `${group.matchLabel} O/U Score First`;

  sqlStatements.push(`DELETE FROM logs WHERE id IN (${idsToDelete.join(',')});`);
  const escDesc = newDesc.replace(/'/g, "''");
  const escOld = oldVal.replace(/'/g, "''");
  const escNew = newVal.replace(/'/g, "''");
  sqlStatements.push(`INSERT INTO logs (timestamp, category, match_id, participant_id, description, old_value, new_value) VALUES ('${group.timestamp}', 'odds', ${group.match_id}, NULL, '${escDesc}', '${escOld}', '${escNew}');`);
}

if (sqlStatements.length > 0) {
  console.log(`Generated ${sqlStatements.length} update queries. Executing on D1...`);
  fs.writeFileSync('scratch/migrate_v2.sql', sqlStatements.join('\n'));
  try {
    const runOutput = execSync('npx wrangler d1 execute worldcup_predictions --remote --file=scratch/migrate_v2.sql', { encoding: 'utf-8' });
    console.log(runOutput);
  } catch (err) {
    console.error('SQL Execution failed:', err.message);
  } finally {
    try { fs.unlinkSync('scratch/migrate_v2.sql'); } catch(e){}
  }
} else {
  console.log('No updates required.');
}
