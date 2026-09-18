/**
 * Relay — Type definitions
 */

/** A single game entry from the index */
export interface GameEntry {
  /** Display title */
  title: string;
  /** URL-friendly slug (derived from title or URL) */
  slug: string;
  /** Full URL to the game's detail page */
  gamePageUrl: string;
  /** Optional thumbnail image URL */
  thumbnailUrl?: string;
}

/** A resolved download result stored in cache */
export interface ResolvedUrl {
  slug: string;
  /** The final download URL that was resolved */
  downloadUrl: string;
  /** Any intermediate/mirror URLs found along the way */
  mirrorUrls?: string[];
  /** ISO timestamp when this was resolved */
  resolvedAt: string;
  /** ISO timestamp when cache expires */
  expiresAt: string;
  /** Resolution status */
  status: 'resolved' | 'failed' | 'pending';
  /** Error message if status is 'failed' */
  error?: string;
}

/** The catalog stored in KV — a collection of all games */
export interface GameCatalog {
  games: GameEntry[];
  lastScrapedAt: string;
  totalGames: number;
}

/** Worker environment bindings */
export interface Env {
  BROWSER: Fetcher;
  RELAY_CACHE: KVNamespace;
  INDEX_URL: string;
  BASE_URL: string;
  CACHE_TTL: string;
  API_KEY?: string;
}

/** Standard API response wrapper */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
