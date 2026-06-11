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
      
      // Convert localDate to ISO standard UTC date using stadium timezone offsets
      let isoDate = localDate;
      if (localDate.includes('/')) {
        const parts = localDate.split(' ');
        const dateParts = parts[0].split('/');
        const timePart = parts[1] || '00:00';
        
        const year = parseInt(dateParts[2]);
        const month = parseInt(dateParts[0]);
        const day = parseInt(dateParts[1]);
        const [hourStr, minStr] = timePart.split(':');
        const hour = parseInt(hourStr);
        const minute = parseInt(minStr);

        // Map stadium_id to its UTC offset during June/July (DST in effect)
        let offset = 0;
        const sId = parseInt(g.stadium_id);
        if ([1, 2, 3].includes(sId)) {
          offset = -6; // CST (Mexico: Mexico City, Guadalajara, Monterrey)
        } else if ([4, 5, 6].includes(sId)) {
          offset = -5; // CDT (US Central: Dallas, Houston, Kansas City)
        } else if ([7, 8, 9, 10, 11, 12].includes(sId)) {
          offset = -4; // EDT (US/Canada Eastern: Atlanta, Miami, Boston, Philadelphia, NY/NJ, Toronto)
        } else if ([13, 14, 15, 16].includes(sId)) {
          offset = -7; // PDT (US/Canada Western: Vancouver, Seattle, San Francisco, Los Angeles)
        } else {
          offset = -4; // Fallback default to Eastern Time
        }

        // Subtract the offset to convert venue local time to UTC
        const utcDate = new Date(Date.UTC(year, month - 1, day, hour - offset, minute));
        isoDate = utcDate.toISOString();
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
