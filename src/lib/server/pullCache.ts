import { TtlCache, tokenFingerprint } from "@/lib/server/cache";
import { refreshIntervalMs } from "@/lib/server/refreshConfig";
import type { PullRequestsPayload } from "@/lib/types";

/**
 * Entries must outlive one background refresh cycle plus some grace, so a
 * page load between cycles is always served warm; the background refresher
 * rewrites them well before they expire. If the refresher cannot keep up
 * (network trouble, untracked token), the entry still ages out here and the
 * next request falls back to a live scan.
 */
export const PULL_CACHE_TTL_MS = refreshIntervalMs() + 2 * 60_000;

type CachedPayload = Omit<PullRequestsPayload, "cached">;

const cache = new TtlCache<CachedPayload>(PULL_CACHE_TTL_MS);

export function readPullRequestCache(token: string): CachedPayload | null {
  return cache.get(tokenFingerprint(token));
}

export function writePullRequestCache(token: string, payload: CachedPayload): void {
  cache.set(tokenFingerprint(token), payload);
}

/** Drop the cached payload for a token, e.g. immediately after a merge. */
export function invalidatePullRequestCache(token: string): void {
  cache.delete(tokenFingerprint(token));
}

/** Test helper - wipes every cached payload. */
export function clearPullRequestCache(): void {
  cache.clear();
}
