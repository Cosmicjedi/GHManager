/** Default cadence of the server-side background pull request scan. */
export const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60_000;

/** Floor so a mistyped override cannot hammer the GitHub API. */
const MIN_REFRESH_INTERVAL_MS = 60_000;

/**
 * How often the background refresher re-walks GitHub, overridable with
 * `GHMANAGER_REFRESH_INTERVAL_MS` (milliseconds).
 */
export function refreshIntervalMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number.parseInt(env.GHMANAGER_REFRESH_INTERVAL_MS ?? "", 10);
  if (!Number.isFinite(raw)) return DEFAULT_REFRESH_INTERVAL_MS;
  return Math.max(MIN_REFRESH_INTERVAL_MS, raw);
}
