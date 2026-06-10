// Cloudflare Worker Cron Trigger to fetch the Pages sync API endpoint every 6 hours
export default {
  async scheduled(event, env, ctx) {
    const pagesUrl = env.PAGES_URL || "https://dubbs-bets.pages.dev";
    const secret = env.SYNC_SECRET;
    
    // Construct sync url with force=true and secret if available
    const url = `${pagesUrl}/api/sync?force=true${secret ? `&secret=${secret}` : ''}`;
    
    console.log(`[Cron Trigger] Starting sync fetch to: ${pagesUrl}/api/sync...`);
    
    ctx.waitUntil(
      fetch(url)
        .then(async (response) => {
          const text = await response.text();
          console.log(`[Cron Trigger] Sync response status: ${response.status}`);
          console.log(`[Cron Trigger] Sync response body: ${text}`);
        })
        .catch((error) => {
          console.error(`[Cron Trigger] Sync error encountered: ${error.message}`);
        })
    );
  }
};
