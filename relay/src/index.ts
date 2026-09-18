/**
 * Relay — Main Worker Entry Point
 *
 * Cloudflare Worker that:
 *   1. Serves the REST API for the Electron app (fetch handler)
 *   2. Periodically scrapes the game index (scheduled handler)
 */
import type { Env } from './types';
import { handleRequest } from './router';
import { runIndexScrape } from './scrapers/indexScraper';

export default {
  /**
   * Handle incoming HTTP requests — the REST API
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error(`[Relay] Unhandled error: ${message}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: message,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  },

  /**
   * Cron trigger — runs on schedule to scrape the index
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[Relay] Cron triggered at ${new Date(event.scheduledTime).toISOString()}`);
    ctx.waitUntil(
      runIndexScrape(env)
        .then((catalog) => {
          console.log(`[Relay] Cron scrape complete: ${catalog.totalGames} games indexed`);
        })
        .catch((err) => {
          console.error(`[Relay] Cron scrape failed: ${err}`);
        }),
    );
  },
};
