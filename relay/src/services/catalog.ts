/**
 * Relay — Catalog service (query helpers)
 */
import type { Env, GameEntry, GameCatalog } from '../types';
import { getCatalog } from './cache';

/**
 * Get all games from the catalog
 */
export async function getAllGames(env: Env): Promise<GameEntry[]> {
  const catalog = await getCatalog(env);
  return catalog?.games ?? [];
}

/**
 * Search games by title (case-insensitive partial match)
 */
export async function searchGames(env: Env, query: string): Promise<GameEntry[]> {
  const games = await getAllGames(env);
  const lowerQuery = query.toLowerCase();
  return games.filter((g) => g.title.toLowerCase().includes(lowerQuery));
}

/**
 * Get a single game by slug
 */
export async function getGameBySlug(env: Env, slug: string): Promise<GameEntry | null> {
  const games = await getAllGames(env);
  return games.find((g) => g.slug === slug) ?? null;
}

/**
 * Get catalog metadata (last scraped time, total count)
 */
export async function getCatalogInfo(env: Env): Promise<{ lastScrapedAt: string | null; totalGames: number }> {
  const catalog = await getCatalog(env);
  return {
    lastScrapedAt: catalog?.lastScrapedAt ?? null,
    totalGames: catalog?.totalGames ?? 0,
  };
}
