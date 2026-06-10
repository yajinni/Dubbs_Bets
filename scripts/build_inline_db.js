// Script to package SQL seeds into a JS module for serverless self-initialization
import fs from 'fs';
import path from 'path';

function packageSql() {
  console.log('Packaging SQL files into db_init_data.js...');
  
  // 1. Read & Clean Schema
  const schemaContent = fs.readFileSync(path.join('db', 'schema.sql'), 'utf-8');
  // Strip SQL comments: lines starting with --
  const cleanSchema = schemaContent
    .replace(/--.*$/gm, '') // Remove double-dash comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove block comments if any
  
  const schemaCmds = cleanSchema
    .split(';')
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0);

  // 2. Read & Clean Teams
  const teamsContent = fs.readFileSync(path.join('db', 'seed_teams.sql'), 'utf-8');
  const cleanTeams = teamsContent.replace(/--.*$/gm, '');
  const teamsCmds = cleanTeams
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.endsWith(';') ? line : line + ';');

  // 3. Read & Clean Matches
  const matchesContent = fs.readFileSync(path.join('db', 'seed_matches.sql'), 'utf-8');
  const cleanMatches = matchesContent.replace(/--.*$/gm, '');
  const matchesCmds = cleanMatches
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.endsWith(';') ? line : line + ';');

  const outputContent = `// Auto-generated self-seeding D1 SQL statements
export const SCHEMA_SQL = ${JSON.stringify(schemaCmds, null, 2)};
export const TEAMS_SQL = ${JSON.stringify(teamsCmds, null, 2)};
export const MATCHES_SQL = ${JSON.stringify(matchesCmds, null, 2)};
`;

  fs.writeFileSync(path.join('functions', 'api', 'db_init_data.js'), outputContent);
  console.log('Successfully packaged SQL into functions/api/db_init_data.js');
}

packageSql();
