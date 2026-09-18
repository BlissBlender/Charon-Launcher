/**
 * Relay — KV Cache helpers
 */
import type { Env, ResolvedUrl, GameCatalog } from '../types';

const CATALOG_KEY = 'catalog:all';
const RESOLVED_PREFIX = 'resolved:';

/**
 * Get the full game catalog from KV
 */
export async function getCatalog(env: Env): Promise<GameCatalog | null> {
  const raw = await env.RELAY_CACHE.get(CATALOG_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as GameCatalog;
}

/**
 * Store the game catalog in KV
 */
export async function setCatalog(env: Env, catalog: GameCatalog): Promise<void> {
  await env.RELAY_CACHE.put(CATALOG_KEY, JSON.stringify(catalog));
}

/**
 * Get a cached resolved URL for a game slug
 */
export async function getResolvedUrl(env: Env, slug: string): Promise<ResolvedUrl | null> {
  const raw = await env.RELAY_CACHE.get(`${RESOLVED_PREFIX}${slug}`);
  if (!raw) return null;

  const resolved = JSON.parse(raw) as ResolvedUrl;

  // Check if expired
  if (new Date(resolved.expiresAt) < new Date()) {
    // Expired — delete and return null
    await env.RELAY_CACHE.delete(`${RESOLVED_PREFIX}${slug}`);
    return null;
  }

  return resolved;
}

/**
 * Cache a resolved URL with TTL
 */
export async function setResolvedUrl(
  env: Env,
  slug: string,
  resolved: ResolvedUrl
): Promise<void> {
  const ttl = parseInt(env.CACHE_TTL) || 86400;
  await env.RELAY_CACHE.put(
    `${RESOLVED_PREFIX}${slug}`,
    JSON.stringify(resolved),
    { expirationTtl: ttl }
  );
}

/**
 * Mark a slug as "currently resolving" so we don't double-resolve
 */
export async function markPending(env: Env, slug: string): Promise<void> {
  const pending: ResolvedUrl = {
    slug,
    downloadUrl: '',
    resolvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(), // 2 min TTL for pending
    status: 'pending',
  };
  await env.RELAY_CACHE.put(
    `${RESOLVED_PREFIX}${slug}`,
    JSON.stringify(pending),
    { expirationTtl: 120 }
  );
}

/**
 * Delete a cached entry
 */
export async function deleteResolved(env: Env, slug: string): Promise<void> {
  await env.RELAY_CACHE.delete(`${RESOLVED_PREFIX}${slug}`);
}
