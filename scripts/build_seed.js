// Node.js script to fetch World Cup 2026 fixtures and write SQL seeds
import fs from 'fs';
import path from 'path';

const TEAMS_URL = 'https://worldcup26.ir/get/teams';
const GAMES_URL = 'https://worldcup26.ir/get/games';

async function generate() {
  console.log('Fetching teams...');
  try {
    const teamsRes = await fetch(TEAMS_URL);
    const teamsData = await teamsRes.json();
    const teams = teamsData.teams || [];

    let teamsSql = '-- Seed Teams\n';
    for (const t of teams) {
      const id = parseInt(t.id);
      const name = t.name_en.replace(/'/g, "''");
      const flag = t.flag || '';
      const code = t.fifa_code || '';
      const groupName = t.groups || '';
      teamsSql += `INSERT OR REPLACE INTO teams (id, name_en, flag, fifa_code, group_name) VALUES (${id}, '${name}', '${flag}', '${code}', '${groupName}');\n`;
    }

    fs.writeFileSync(path.join('db', 'seed_teams.sql'), teamsSql);
    console.log(`Generated db/seed_teams.sql with ${teams.length} teams.`);

    console.log('Fetching games...');
    const gamesRes = await fetch(GAMES_URL);
    const gamesData = await gamesRes.json();
    const games = gamesData.games || [];

    // Map of team IDs to names for quick label filling
    const teamMap = {};
    for (const t of teams) {
      teamMap[t.id] = t.name_en;
    }

    let gamesSql = '-- Seed Matches\n';
    for (const g of games) {
      const id = parseInt(g.id);
      const homeId = parseInt(g.home_team_id) || null;
      const awayId = parseInt(g.away_team_id) || null;

      // Clean team names, fallback to label if id is 0 (knockouts placeholder)
      const homeName = homeId ? (teamMap[homeId] || '').replace(/'/g, "''") : '';
      const awayName = awayId ? (teamMap[awayId] || '').replace(/'/g, "''") : '';
      const homeLabel = (g.home_team_label || '').replace(/'/g, "''");
      const awayLabel = (g.away_team_label || '').replace(/'/g, "''");

      const groupName = g.group || '';
      const roundName = g.type || 'group'; // e.g. group, r32, r16, qf, sf, third, final
      const matchday = parseInt(g.matchday) || 1;
      const localDate = g.local_date || ''; // Formatted as MM/DD/YYYY HH:MM
      
      // Convert localDate to ISO date standard
      // Input: "06/11/2026 13:00" -> ISO: "2026-06-11T13:00:00"
      let isoDate = localDate;
      if (localDate.includes('/')) {
        const parts = localDate.split(' ');
        const dateParts = parts[0].split('/');
        const timePart = parts[1] || '00:00';
        isoDate = `${dateParts[2]}-${dateParts[0]}-${dateParts[1]}T${timePart}:00`;
      }

      const status = g.time_elapsed === 'notstarted' ? 'scheduled' : (g.finished === 'TRUE' ? 'finished' : 'live');
      const finishedVal = g.finished === 'TRUE' ? 1 : 0;
      const homeScore = parseInt(g.home_score) || 0;
      const awayScore = parseInt(g.away_score) || 0;

      // Assign realistic default win percentages for groups based on home/away status
      // We will seed these as 35% Home, 35% Away, 30% Draw default.
      // For actual execution, these will be synced/overwritten via API-Football or The Odds API
      let homePct = 38.0;
      let awayPct = 34.0;
      let drawPct = 28.0;

      // Simple heuristic based on historical strength for seeder defaults
      // Stronger teams get favored
      const strongTeams = ['Argentina', 'Brazil', 'France', 'England', 'Spain', 'Germany', 'Portugal', 'Netherlands', 'Belgium', 'Uruguay', 'Croatia'];
      if (strongTeams.includes(homeName) && !strongTeams.includes(awayName)) {
        homePct = 58.0; awayPct = 18.0; drawPct = 24.0;
      } else if (!strongTeams.includes(homeName) && strongTeams.includes(awayName)) {
        homePct = 18.0; awayPct = 58.0; drawPct = 24.0;
      }

      gamesSql += `INSERT OR REPLACE INTO matches (id, home_team_id, away_team_id, home_team_name, away_team_name, home_team_label, away_team_label, home_score, away_score, group_name, round_name, matchday, local_date, finished, status, type, home_win_pct, away_win_pct, draw_pct, over_under_line, over_odds, under_odds) VALUES (${id}, ${homeId}, ${awayId}, '${homeName}', '${awayName}', '${homeLabel}', '${awayLabel}', ${homeScore}, ${awayScore}, '${groupName}', '${roundName}', ${matchday}, '${isoDate}', ${finishedVal}, '${status}', '${roundName}', ${homePct}, ${awayPct}, ${drawPct}, 2.5, 1.9, 1.9);\n`;
    }

    fs.writeFileSync(path.join('db', 'seed_matches.sql'), gamesSql);
    console.log(`Generated db/seed_matches.sql with ${games.length} matches.`);

  } catch (error) {
    console.error('Error generating seeds:', error);
  }
}

generate();
