import { environmentToken } from "@/lib/auth";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { fetchAllOpenPullRequests } from "@/lib/github/pulls";
import { tokenFingerprint } from "@/lib/server/cache";
import {
  invalidatePullRequestCache,
  writePullRequestCache,
} from "@/lib/server/pullCache";
import { refreshIntervalMs } from "@/lib/server/refreshConfig";
import { listStoredTokens } from "@/lib/server/tokenStore";

/**
 * Server-side background refresh.
 *
 * Walking every repository takes long enough that doing it on demand makes the
 * first page load crawl. Instead the server re-scans GitHub on an interval for
 * every token it knows about - the `GITHUB_TOKEN` from the environment plus
 * any token recently used against `/api/pulls` - and rewrites the pull request
 * cache, so a page load is always served warm and at most one interval old.
 */

interface TrackedToken {
  token: string;
  lastUsedAt: number;
  /** Guards against a slow scan overlapping the next tick. */
  refreshing: boolean;
}

/** A cookie token that has not been used for this long stops being refreshed. */
const TOKEN_IDLE_EXPIRY_MS = 24 * 60 * 60_000;

/** Hard cap - every tracked token costs a full account scan per cycle. */
const MAX_TRACKED_TOKENS = 20;

/** Keyed by token fingerprint so lookups never compare raw tokens. */
const tracked = new Map<string, TrackedToken>();

/**
 * Remember a token so the background loop keeps its cache warm. Called on
 * every authorised `/api/pulls` request; refreshing an already-tracked token
 * just bumps its last-used time.
 */
export function trackTokenForBackgroundRefresh(token: string): void {
  const fingerprint = tokenFingerprint(token);
  const existing = tracked.get(fingerprint);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return;
  }

  if (tracked.size >= MAX_TRACKED_TOKENS) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of tracked) {
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) tracked.delete(oldestKey);
  }

  tracked.set(fingerprint, { token, lastUsedAt: Date.now(), refreshing: false });
}

export function isTokenTracked(token: string): boolean {
  return tracked.has(tokenFingerprint(token));
}

/**
 * Forget a token by its fingerprint - used when a stored token is removed
 * from the management UI so the loop stops scanning for it.
 */
export function untrackToken(fingerprint: string): void {
  tracked.delete(fingerprint);
}

/** Test helper - forgets every tracked token. */
export function clearTrackedTokens(): void {
  tracked.clear();
}

/** Run one refresh cycle: re-scan GitHub for every live token. */
export async function refreshTrackedTokens(): Promise<void> {
  // The environment token and every token in the managed store are always
  // refreshed while the process runs; their last-used times are bumped every
  // cycle so they can never idle out.
  const envToken = environmentToken();
  if (envToken) trackTokenForBackgroundRefresh(envToken);
  for (const stored of listStoredTokens().tokens) {
    trackTokenForBackgroundRefresh(stored.token);
  }

  const now = Date.now();
  for (const [fingerprint, entry] of tracked) {
    if (now - entry.lastUsedAt > TOKEN_IDLE_EXPIRY_MS) {
      tracked.delete(fingerprint);
      continue;
    }
    if (entry.refreshing) continue;

    entry.refreshing = true;
    try {
      const client = new GitHubClient(entry.token);
      const payload = await fetchAllOpenPullRequests(client);
      writePullRequestCache(entry.token, payload);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) {
        // A dead token will never come back on its own; stop paying for it
        // and make sure nothing stale is served under it.
        invalidatePullRequestCache(entry.token);
        tracked.delete(fingerprint);
        console.warn(
          `[GHManager] background refresh: GitHub rejected token ${fingerprint.slice(0, 8)}; it will no longer be refreshed.`,
        );
      } else {
        console.warn(
          `[GHManager] background refresh failed for token ${fingerprint.slice(0, 8)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } finally {
      entry.refreshing = false;
    }
  }
}

export interface BackgroundRefreshHandle {
  intervalMs: number;
  stop: () => void;
}

/**
 * Stored on `globalThis` so dev-server hot reloads and duplicate imports
 * cannot stack a second interval on top of the first.
 */
const GLOBAL_KEY = Symbol.for("ghmanager.background-refresh");

type GlobalWithHandle = typeof globalThis & {
  [GLOBAL_KEY]?: BackgroundRefreshHandle;
};

/**
 * Start the refresh loop. Runs one cycle immediately - so a container with a
 * `GITHUB_TOKEN` is warm before the first visitor - then repeats on the
 * configured interval. Idempotent: a second call returns the running handle.
 */
export function startBackgroundRefresh(
  options: { intervalMs?: number } = {},
): BackgroundRefreshHandle {
  const holder = globalThis as GlobalWithHandle;
  const existing = holder[GLOBAL_KEY];
  if (existing) return existing;

  const intervalMs = options.intervalMs ?? refreshIntervalMs();

  void refreshTrackedTokens();
  const timer = setInterval(() => {
    void refreshTrackedTokens();
  }, intervalMs);
  // The interval must never be what keeps the process alive on shutdown.
  (timer as { unref?: () => void }).unref?.();

  const handle: BackgroundRefreshHandle = {
    intervalMs,
    stop: () => {
      clearInterval(timer);
      delete holder[GLOBAL_KEY];
    },
  };
  holder[GLOBAL_KEY] = handle;
  return handle;
}
