import { checkAndInitDb } from './db_helper.js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const config = {
      enabled: !!env.GEMINI_API_KEY && env.GEMINI_API_KEY !== '',
      model: env.GEMINI_MODEL || 'gemini-2.5-flash'
    };
    return new Response(JSON.stringify(config), { status: 200, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    if (!env.db) {
      return new Response(JSON.stringify({ error: 'Database binding missing' }), { status: 500, headers });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey || apiKey === '') {
      return new Response(
        JSON.stringify({ 
          error: 'GEMINI_API_KEY environment variable is not configured. Please set it in your Cloudflare dashboard.' 
        }), 
        { status: 400, headers }
      );
    }

    await checkAndInitDb(env.db);

    // 1. Fetch data from DB
    const [leaderboardRes, matchesRes, predictionsRes] = await Promise.all([
      env.db.prepare(`
        SELECT * FROM leaderboard_cache 
        ORDER BY total_points DESC, correct_scores DESC, correct_winners DESC, name ASC
      `).all(),
      env.db.prepare(`
        SELECT m.id, m.home_team_name, m.away_team_name, m.home_score, m.away_score, 
               m.home_ht_score, m.away_ht_score, m.status, m.finished, 
               m.actual_cards, m.actual_first_scorer, m.over_under_line, m.cards_line, m.local_date
        FROM matches m
        ORDER BY m.local_date ASC
      `).all(),
      env.db.prepare(`
        SELECT p.name AS participant_name, m.home_team_name, m.away_team_name, pr.*
        FROM predictions pr
        JOIN participants p ON pr.participant_id = p.id
        JOIN matches m ON pr.match_id = m.id
      `).all()
    ]);

    const leaderboard = leaderboardRes.results || [];
    const matches = matchesRes.results || [];
    const predictions = predictionsRes.results || [];

    // 2. Format context for Gemini
    let systemPrompt = `You are a helpful, smart, and friendly AI assistant for "Dubbs Bets" (our World Cup 2026 Prediction Pool).
Your job is to answer users' questions about our bets, matches, and standings using the live tournament data provided below.
Be concise, accurate, and direct. If a user asks who did the worst on a match, which matches were high scoring, or how a player is performing, calculate it directly from the dataset.

Here is the current state of our prediction tournament:

--- STANDINGS & LEADERBOARD ---
Rank | Name | Total Points | Correct Scores | Correct Winners | Correct Cards O/U | Correct Clean Sheets | Correct First Scorers
`;

    leaderboard.forEach((row, i) => {
      systemPrompt += `${i + 1}. ${row.name} | Points: ${row.total_points} | Exact Scores: ${row.correct_scores} | Winners: ${row.correct_winners} | Cards: ${row.correct_cards_ou} | Clean Sheets: ${row.correct_clean_sheets} | First Scorers: ${row.correct_first_scorers || 0}\n`;
    });

    systemPrompt += `\n--- MATCHES & RESULTS ---\n`;
    matches.forEach(m => {
      const isLive = m.status === 'live';
      const isFinished = m.finished === 1;
      const displayStatus = isFinished ? 'Finished' : (isLive ? 'LIVE' : 'Scheduled');
      
      systemPrompt += `Match ID ${m.id}: ${m.home_team_name} vs ${m.away_team_name}
  Status: ${displayStatus} (Kickoff: ${m.local_date})
  Score: Fulltime: ${m.home_score}-${m.away_score} | Halftime: ${m.home_ht_score !== null ? `${m.home_ht_score}-${m.away_ht_score}` : 'N/A'}
  Line Details: O/U Goals Line: ${m.over_under_line} | Cards Line: ${m.cards_line}
  Actual Stats: Cards: ${m.actual_cards !== null ? m.actual_cards : 'N/A'} | First Scorer: ${m.actual_first_scorer || 'N/A'}\n\n`;
    });

    systemPrompt += `\n--- PLAYERS' PREDICTIONS ---\n`;
    // Group predictions by match ID
    const predictionsByMatch = {};
    predictions.forEach(p => {
      if (!predictionsByMatch[p.match_id]) {
        predictionsByMatch[p.match_id] = [];
      }
      predictionsByMatch[p.match_id].push(p);
    });

    matches.forEach(m => {
      const preds = predictionsByMatch[m.id] || [];
      if (preds.length === 0) return;

      systemPrompt += `Match ${m.id} (${m.home_team_name} vs ${m.away_team_name}):\n`;
      preds.forEach(p => {
        systemPrompt += `  - ${p.participant_name}: Predict Winner: ${p.predicted_winner || 'None'}, Score: ${p.predicted_home_score}-${p.predicted_away_score}, O/U Goals: ${p.predicted_over_under || 'N/A'}, Cards O/U: ${p.predicted_cards_over_under || 'N/A'}, First Scorer: ${p.predicted_first_scorer || 'N/A'}, Clean Sheet: ${p.predicted_clean_sheet || 'N/A'} | Points Earned: ${p.total_points} (Winner: +${p.points_winner}, Score: +${p.points_score}, O/U: +${p.points_ou}, Cards: +${p.points_cards_ou}, Scorer: +${p.points_first_scorer}, Clean Sheet: +${p.points_clean_sheet})\n`;
      });
      systemPrompt += `\n`;
    });

    systemPrompt += `\nUse the above data to answer the user's queries.
- Keep your answers highly relevant to our pool.
- Use bullet points or markdown tables when listing items.
- If a question is about general football trivia not present in the data (e.g. "Who won the 1998 World Cup?"), you can answer it using your general knowledge, but prioritize our pool data.
- If the data requested is missing or the match has not played yet, state it clearly.
- If there are ties or multiple people did the worst on a match, mention all of them.
- Be supportive and wittily tease underperforming players if requested, but keep it friendly!`;

    // 3. Parse request payload
    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Invalid payload: messages array required' }), { status: 400, headers });
    }

    const modelName = env.GEMINI_MODEL || 'gemini-2.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const geminiPayload = {
      contents: messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      })),
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024
      }
    };

    console.log(`Sending request to Gemini API (${modelName})...`);
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiPayload)
    });

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('Gemini API Error:', geminiData);
      return new Response(
        JSON.stringify({ 
          error: `Gemini API returned status ${geminiRes.status}: ${geminiData.error?.message || JSON.stringify(geminiData)}` 
        }), 
        { status: 502, headers }
      );
    }

    const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";

    return new Response(JSON.stringify({ reply }), { status: 200, headers });

  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
