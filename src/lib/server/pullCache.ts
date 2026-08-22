import { TtlCache, tokenFingerprint } from "@/lib/server/cache";
import type { PullRequestsPayload } from "@/lib/types";

/** Short cache so tab-focus refetches do not re-walk every repository. */
export const PULL_CACHE_TTL_MS = 45_000;

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
