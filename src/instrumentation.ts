/**
 * Next.js server bootstrap hook. Starts the background pull request refresh
 * loop so the server-side cache stays warm for as long as the container runs,
 * and every page load is served fresh data without waiting on a scan.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` also bootstraps server code; only a serving process scans.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startBackgroundRefresh } = await import("@/lib/server/backgroundRefresh");
  startBackgroundRefresh();
}
