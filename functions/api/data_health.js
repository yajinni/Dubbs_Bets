import { checkAndInitDb } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const KNOCKOUT_TYPES = new Set(['r32', 'r16', 'qf', 'sf', 'third', 'final']);

function isPlaceholderLabel(value) {
  return /^(winner|runner-up|3rd|round of|quarterfinal|semifinal|final|loser)\b/i.test((value || '').trim());
}

function describeMatch(m) {
  const home = m.home_team_name || m.home_team_label || 'blank home';
  const away = m.away_team_name || m.away_team_label || 'blank away';
  return `Match ${m.id}: ${home} vs ${away}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequest(context) {
  const { env } = context;

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    const now = Date.now();
    const attentionWindowMs = 24 * 60 * 60 * 1000;
    const { results: matches } = await env.db.prepare(`
      SELECT id, home_team_name, away_team_name, home_team_label, away_team_label,
             local_date, finished, status, espn_event_id, type, round_name
      FROM matches
      ORDER BY local_date ASC
    `).all();

    const issues = [];

    for (const m of matches || []) {
      const matchType = m.type || m.round_name;
      if (!KNOCKOUT_TYPES.has(matchType)) continue;

      const kickoff = new Date(m.local_date).getTime();
      const dueForRealTeams = !Number.isNaN(kickoff) && kickoff <= now + attentionWindowMs;
      const hasBlankTeam = !m.home_team_name || !m.away_team_name;
      const hasMissingEventId = !m.espn_event_id;
      const hasStalePlaceholderLabel =
        ((m.home_team_name && m.home_team_label && m.home_team_label !== m.home_team_name && isPlaceholderLabel(m.home_team_label)) ||
         (m.away_team_name && m.away_team_label && m.away_team_label !== m.away_team_name && isPlaceholderLabel(m.away_team_label)));

      if (dueForRealTeams && hasBlankTeam) {
        issues.push({
          type: 'blank_team_names',
          severity: 'high',
          matchId: m.id,
          message: `${describeMatch(m)} is due but still has blank team names.`,
        });
      }

      if (dueForRealTeams && hasMissingEventId) {
        issues.push({
          type: 'missing_espn_event_id',
          severity: 'medium',
          matchId: m.id,
          message: `${describeMatch(m)} is due but has no ESPN event ID.`,
        });
      }

      if (hasStalePlaceholderLabel) {
        issues.push({
          type: 'stale_placeholder_label',
          severity: 'medium',
          matchId: m.id,
          message: `${describeMatch(m)} has real team names but still has placeholder labels.`,
        });
      }
    }

    return new Response(JSON.stringify({ ok: issues.length === 0, issues }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
