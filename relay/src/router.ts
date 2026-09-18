/**
 * Relay — Router
 *
 * Clean URL routing for the API.
 */
import type { Env, ApiResponse } from './types';
import { getAllGames, searchGames, getGameBySlug, getCatalogInfo } from './services/catalog';
import { getResolvedUrl } from './services/cache';
import { resolveDownloadUrl } from './scrapers/urlResolver';
import { runIndexScrape } from './scrapers/indexScraper';

/**
 * Create a JSON response with standard wrapper
 */
function jsonResponse<T>(data: T, status = 200): Response {
  const body: ApiResponse<T> = {
    success: status >= 200 && status < 300,
    data,
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    },
  });
}

/**
 * Create an error response
 */
function errorResponse(message: string, status = 400): Response {
  const body: ApiResponse = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Simple path matcher that extracts params
 * e.g., match("/api/resolve/:slug", "/api/resolve/dishonored") → { slug: "dishonored" }
 */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.replace(/\/$/, '').split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return params;
}

/**
 * Optional API key check
 */
function checkAuth(request: Request, env: Env): boolean {
  if (!env.API_KEY) return true; // No key set = open access
  const key = request.headers.get('X-API-Key');
  return key === env.API_KEY;
}

/**
 * Route incoming requests
 */
export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
      },
    });
  }

  // Only allow GET
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  // Auth check
  if (!checkAuth(request, env)) {
    return errorResponse('Unauthorized — invalid or missing API key', 401);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';

  // ─── Health check ───
  if (path === '' || path === '/') {
    return jsonResponse({
      service: 'relay',
      status: 'online',
      version: '1.0.0',
    });
  }

  // ─── GET /api/games — List all games ───
  if (path === '/api/games') {
    const search = url.searchParams.get('search');
    if (search) {
      const results = await searchGames(env, search);
      return jsonResponse({ games: results, count: results.length, query: search });
    }
    const games = await getAllGames(env);
    return jsonResponse({ games, count: games.length });
  }

  // ─── GET /api/catalog — Catalog metadata ───
  if (path === '/api/catalog') {
    const info = await getCatalogInfo(env);
    return jsonResponse(info);
  }

  // ─── GET /api/scrape — Manually trigger index scrape ───
  if (path === '/api/scrape') {
    try {
      const catalog = await runIndexScrape(env);
      return jsonResponse({
        message: 'Index scrape completed',
        totalGames: catalog.totalGames,
        lastScrapedAt: catalog.lastScrapedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(`Scrape failed: ${msg}`, 500);
    }
  }

  // ─── GET /api/resolve/:slug — Resolve download URL ───
  const resolveMatch = matchPath('/api/resolve/:slug', path);
  if (resolveMatch) {
    const { slug } = resolveMatch;

    // Check cache first
    const cached = await getResolvedUrl(env, slug);
    if (cached) {
      if (cached.status === 'pending') {
        return jsonResponse({ ...cached, message: 'Resolution in progress, try again shortly' }, 202);
      }
      return jsonResponse(cached);
    }

    // Find the game in the catalog, or fall back to standard URL pattern
    const game = await getGameBySlug(env, slug);
    const targetUrl = game?.gamePageUrl || `https://steamrip.com/${slug}/`;

    // Resolve in the foreground (blocking)
    // For production, you might want to use ctx.waitUntil() for background processing
    try {
      const result = await resolveDownloadUrl(slug, targetUrl, env);
      return jsonResponse(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResponse(`Resolution failed: ${msg}`, 500);
    }
  }

  // ─── GET /api/status/:slug — Check resolve status ───
  const statusMatch = matchPath('/api/status/:slug', path);
  if (statusMatch) {
    const { slug } = statusMatch;
    const cached = await getResolvedUrl(env, slug);
    if (!cached) {
      return jsonResponse({ slug, status: 'not_resolved', downloadUrl: null });
    }
    return jsonResponse(cached);
  }

  // ─── 404 ───
  return errorResponse('Not found', 404);
}
