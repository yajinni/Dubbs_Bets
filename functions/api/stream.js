// Cloudflare Pages Functions: API route to resolve match streams (GET)
import { checkAndInitDb } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  try {
    if (method !== 'GET') {
      return new Response(JSON.stringify({ error: `Method ${method} not allowed` }), { status: 405, headers });
    }

    const url = new URL(request.url);
    const matchId = url.searchParams.get('matchId');
    if (!matchId) {
      return new Response(JSON.stringify({ error: 'matchId query parameter is required' }), { status: 400, headers });
    }

    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    await checkAndInitDb(env.db);

    // Fetch the match details to get team names
    const match = await env.db.prepare(
      `SELECT home_team_name, home_team_label, away_team_name, away_team_label FROM matches WHERE id = ?`
    ).bind(parseInt(matchId)).first();

    if (!match) {
      return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers });
    }

    const home = (match.home_team_name || match.home_team_label || '').toLowerCase();
    const away = (match.away_team_name || match.away_team_label || '').toLowerCase();

    // Helper function to normalize name (remove accents, punctuation)
    const normalize = (str) => {
      return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip accents
        .replace(/[^a-z0-9\s]/g, '') // remove punctuation
        .trim();
    };

    const normHome = normalize(home);
    const normAway = normalize(away);

    // Fetch StreamEast live content
    const targetUrl = 'https://istreameast.app/v52';
    const fetchResponse = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });

    if (!fetchResponse.ok) {
      return new Response(JSON.stringify({ streamUrl: targetUrl }), { status: 200, headers });
    }

    const html = await fetchResponse.text();

    // Extract all anchor links
    const itemRegex = /<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let matchGroup;
    let bestMatchUrl = null;

    while ((matchGroup = itemRegex.exec(html)) !== null) {
      const href = matchGroup[1];
      const innerText = matchGroup[2].replace(/<[^>]*>/g, '').toLowerCase();
      const normText = normalize(innerText);

      // Split names into individual words (filtering out common short words like "vs", "the", "and")
      const getKeywords = (name) => {
        return name.split(/\s+/).filter(w => w.length > 2 && w !== 'und' && w !== 'the' && w !== 'and');
      };

      const homeKeywords = getKeywords(normHome);
      const awayKeywords = getKeywords(normAway);

      const matchesHome = homeKeywords.length > 0 
        ? homeKeywords.every(w => normText.includes(w) || href.toLowerCase().includes(w)) 
        : normText.includes(normHome) || href.toLowerCase().includes(normHome);

      const matchesAway = awayKeywords.length > 0 
        ? awayKeywords.every(w => normText.includes(w) || href.toLowerCase().includes(w)) 
        : normText.includes(normAway) || href.toLowerCase().includes(normAway);

      if (matchesHome && matchesAway) {
        bestMatchUrl = href;
        break;
      }
    }

    // Fallback search: if no exact match, try matching either home OR away
    if (!bestMatchUrl) {
      itemRegex.lastIndex = 0;
      while ((matchGroup = itemRegex.exec(html)) !== null) {
        const href = matchGroup[1];
        const innerText = matchGroup[2].replace(/<[^>]*>/g, '').toLowerCase();
        const normText = normalize(innerText);

        const containsHome = normText.includes(normHome) || href.toLowerCase().includes(normHome);
        const containsAway = normText.includes(normAway) || href.toLowerCase().includes(normAway);

        if (containsHome || containsAway) {
          bestMatchUrl = href;
          break;
        }
      }
    }

    return new Response(JSON.stringify({ streamUrl: bestMatchUrl || targetUrl }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, streamUrl: 'https://istreameast.app/v52' }), { status: 500, headers });
  }
}
