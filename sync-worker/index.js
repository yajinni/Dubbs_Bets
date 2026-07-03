// Cloudflare Worker Cron Trigger: locks odds for today's matches at 9 AM ET.
// The Pages route param is kept as `midnightLock=true` for backwards compatibility
// with existing route wiring, but this scheduled task runs at 9 AM ET, not midnight.
export default {
  async scheduled(event, env, ctx) {
    const pagesUrl = env.PAGES_URL || "https://dubbs-bets.pages.dev";
    const secret = env.SYNC_SECRET;

    const url = `${pagesUrl}/api/sync?midnightLock=true${secret ? `&secret=${secret}` : ''}`;

    console.log(`[9 AM Odds Lock] Calling: ${pagesUrl}/api/sync?midnightLock=true...`);

    ctx.waitUntil(
      fetch(url)
        .then(async (response) => {
          const text = await response.text();
          console.log(`[9 AM Odds Lock] Response status: ${response.status}`);
          console.log(`[9 AM Odds Lock] Response body: ${text}`);
        })
        .catch((error) => {
          console.error(`[9 AM Odds Lock] Error: ${error.message}`);
        })
    );
  }
};