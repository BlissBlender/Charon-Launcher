/**
 * Relay — Index Scraper
 *
 * Scrapes the main game index page to build a catalog of all games.
 * This is a lightweight scraper that uses fetch() + HTML parsing.
 * No browser needed — just static HTML parsing.
 *
 * Flow:
 *   Index Page HTML → parse all game <a> links → extract title + URL → GameEntry[]
 */
import { parse, HTMLElement } from 'node-html-parser';
import type { Env, GameEntry, GameCatalog } from '../types';
import { setCatalog } from '../services/cache';

/**
 * Generate a URL-friendly slug from a title or URL
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract a slug from a game page URL
 * e.g., "https://example.com/some-game-free-download/" → "some-game-free-download"
 */
function slugFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    // Remove trailing slash and get last segment
    const segments = pathname.replace(/\/$/, '').split('/');
    return segments[segments.length - 1] || slugify(url);
  } catch {
    return slugify(url);
  }
}

/**
 * Fetch and parse the game index page.
 * Returns an array of GameEntry objects.
 *
 * This function looks for common patterns:
 *   - <a> tags linking to individual game pages
 *   - List items (<li>) or table rows containing game titles and links
 *   - Any structured list of links on the page
 *
 * You may need to adjust the selectors based on the actual site structure.
 */
export async function scrapeGameIndex(env: Env): Promise<GameEntry[]> {
  const indexUrl = env.INDEX_URL;
  console.log(`[IndexScraper] Fetching index from: ${indexUrl}`);

  const response = await fetch(indexUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!response.ok) {
    throw new Error(`[IndexScraper] Failed to fetch index: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const root = parse(html);

  const games: GameEntry[] = [];
  const seenSlugs = new Set<string>();

  // --- STRATEGY 1: Look for links inside list items ---
  // Many index pages use <ul><li><a href="...">Game Title</a></li></ul>
  const listLinks = root.querySelectorAll('li a[href]');
  for (const link of listLinks) {
    const entry = extractGameFromLink(link, env.BASE_URL);
    if (entry && !seenSlugs.has(entry.slug)) {
      seenSlugs.add(entry.slug);
      games.push(entry);
    }
  }

  // --- STRATEGY 2: Look for links inside article/post containers ---
  // Some sites use <article> or <div class="post"> with <a> tags
  if (games.length === 0) {
    const articleLinks = root.querySelectorAll('article a[href], .post a[href], .entry a[href]');
    for (const link of articleLinks) {
      const entry = extractGameFromLink(link, env.BASE_URL);
      if (entry && !seenSlugs.has(entry.slug)) {
        seenSlugs.add(entry.slug);
        games.push(entry);
      }
    }
  }

  // --- STRATEGY 3: Fallback — grab ALL internal links that look like game pages ---
  if (games.length === 0) {
    const allLinks = root.querySelectorAll('a[href]');
    for (const link of allLinks) {
      const entry = extractGameFromLink(link, env.BASE_URL);
      if (entry && !seenSlugs.has(entry.slug)) {
        seenSlugs.add(entry.slug);
        games.push(entry);
      }
    }
  }

  console.log(`[IndexScraper] Found ${games.length} games`);
  return games;
}

/**
 * Extract a GameEntry from an <a> element
 */
function extractGameFromLink(link: HTMLElement, baseUrl: string): GameEntry | null {
  const href = link.getAttribute('href');
  if (!href) return null;

  // Build full URL
  let fullUrl: string;
  try {
    fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).toString();
  } catch {
    return null;
  }

  // Skip non-game links (navigation, categories, external sites, etc.)
  if (isNonGameLink(fullUrl, baseUrl)) return null;

  // Get the title from link text
  const title = link.textContent?.trim();
  if (!title || title.length < 2) return null;

  // Skip generic navigation text
  if (isNavigationText(title)) return null;

  // Extract optional thumbnail from child <img>
  const img = link.querySelector('img');
  const thumbnailUrl = img?.getAttribute('src') || img?.getAttribute('data-src') || undefined;

  const slug = slugFromUrl(fullUrl);

  return {
    title,
    slug,
    gamePageUrl: fullUrl,
    thumbnailUrl,
  };
}

/**
 * Filter out links that are clearly not game pages
 */
function isNonGameLink(url: string, baseUrl: string): boolean {
  const lower = url.toLowerCase();

  // Must be on the same domain
  try {
    const linkHost = new URL(url).hostname;
    const baseHost = new URL(baseUrl).hostname;
    if (linkHost !== baseHost) return true;
  } catch {
    return true;
  }

  // Skip common non-game paths
  const skipPatterns = [
    '/tag/', '/category/', '/author/', '/page/',
    '/wp-admin', '/wp-content', '/wp-includes',
    '/login', '/register', '/contact', '/about',
    '/privacy', '/terms', '/dmca', '/faq',
    '#', 'javascript:', 'mailto:',
  ];

  return skipPatterns.some((p) => lower.includes(p));
}

/**
 * Filter out generic navigation link text
 */
function isNavigationText(text: string): boolean {
  const skip = [
    'home', 'about', 'contact', 'login', 'register',
    'next', 'previous', 'older', 'newer', 'page',
    'read more', 'continue', 'click here', 'menu',
    'privacy', 'terms', 'dmca', 'copyright',
  ];
  return skip.includes(text.toLowerCase());
}

/**
 * Run the full index scrape and store results in KV
 */
export async function runIndexScrape(env: Env): Promise<GameCatalog> {
  const games = await scrapeGameIndex(env);

  const catalog: GameCatalog = {
    games,
    lastScrapedAt: new Date().toISOString(),
    totalGames: games.length,
  };

  await setCatalog(env, catalog);
  console.log(`[IndexScraper] Stored ${games.length} games in KV`);

  return catalog;
}
