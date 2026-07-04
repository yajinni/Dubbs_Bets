// Cloudflare Worker cron trigger: locks odds for today's matches at 9 AM ET.
export default {
  async scheduled(event, env, ctx) {
    const pagesUrl = env.PAGES_URL || "https://dubbs-bets.pages.dev";
    const secret = env.SYNC_SECRET;
    
    const url = `${pagesUrl}/api/sync?midnightLock=true${secret ? `&secret=${secret}` : ''}`;
    
    console.log(`[Daily Odds Lock] Calling: ${pagesUrl}/api/sync?midnightLock=true...`);
    
    ctx.waitUntil(
      fetch(url)
        .then(async (response) => {
          const text = await response.text();
          console.log(`[Daily Odds Lock] Response status: ${response.status}`);
          console.log(`[Daily Odds Lock] Response body: ${text}`);
        })
        .catch((error) => {
          console.error(`[Daily Odds Lock] Error: ${error.message}`);
        })
    );
  }
};
