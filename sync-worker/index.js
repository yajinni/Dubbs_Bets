// Cloudflare Worker Cron Trigger: locks odds for today's matches at midnight ET
export default {
  async scheduled(event, env, ctx) {
    const pagesUrl = env.PAGES_URL || "https://dubbs-bets.pages.dev";
    const secret = env.SYNC_SECRET;
    
    const url = `${pagesUrl}/api/sync?midnightLock=true${secret ? `&secret=${secret}` : ''}`;
    
    console.log(`[Midnight Lock] Calling: ${pagesUrl}/api/sync?midnightLock=true...`);
    
    ctx.waitUntil(
      fetch(url)
        .then(async (response) => {
          const text = await response.text();
          console.log(`[Midnight Lock] Response status: ${response.status}`);
          console.log(`[Midnight Lock] Response body: ${text}`);
        })
        .catch((error) => {
          console.error(`[Midnight Lock] Error: ${error.message}`);
        })
    );
  }
};
