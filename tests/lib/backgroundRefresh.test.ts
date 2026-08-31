import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BackgroundRefreshHandle,
  clearTrackedTokens,
  isTokenTracked,
  refreshTrackedTokens,
  startBackgroundRefresh,
  trackTokenForBackgroundRefresh,
} from "@/lib/server/backgroundRefresh";
import {
  clearPullRequestCache,
  readPullRequestCache,
  writePullRequestCache,
} from "@/lib/server/pullCache";
import { MockGitHub, RATE_LIMIT } from "~tests/mockGitHub";
import { rawPullRequest, rawRepository, resetFactories } from "~tests/factories";

const ENV_TOKEN = "ghp_env_token_0123456789abcdef";
const COOKIE_TOKEN = "ghp_cookie_token_0123456789abc";

function workingGitHub(): MockGitHub {
  return new MockGitHub()
    .onGraphQL("RepositoryInventory", () => ({
      body: {
        data: {
          rateLimit: RATE_LIMIT,
          viewer: {
            login: "octocat",
            repositories: {
              totalCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                rawRepository({
                  nameWithOwner: "acme/widgets",
                  pullRequests: { totalCount: 1 },
                }),
              ],
            },
          },
        },
      },
    }))
    .onGraphQL("RepositoryPullRequests", () => ({
      body: {
        data: {
          rateLimit: RATE_LIMIT,
          r0: rawRepository({
            nameWithOwner: "acme/widgets",
            pullRequests: {
              totalCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [rawPullRequest({ number: 5 })],
            },
          }),
        },
      },
    }));
}

function runningHandle(): BackgroundRefreshHandle | undefined {
  return (
    globalThis as typeof globalThis & {
      [key: symbol]: BackgroundRefreshHandle | undefined;
    }
  )[Symbol.for("ghmanager.background-refresh")];
}

beforeEach(() => {
  resetFactories();
  clearTrackedTokens();
  clearPullRequestCache();
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "");
});

afterEach(() => {
  runningHandle()?.stop();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearTrackedTokens();
  clearPullRequestCache();
});

describe("refreshTrackedTokens", () => {
  it("warms the cache for a tracked token", async () => {
    vi.stubGlobal("fetch", workingGitHub().fetch);
    trackTokenForBackgroundRefresh(COOKIE_TOKEN);

    expect(readPullRequestCache(COOKIE_TOKEN)).toBeNull();
    await refreshTrackedTokens();

    const cached = readPullRequestCache(COOKIE_TOKEN);
    expect(cached).not.toBeNull();
    expect(cached?.pullRequests).toHaveLength(1);
    expect(cached?.pullRequests[0].number).toBe(5);
  });

  it("always includes the environment token without being asked", async () => {
    vi.stubEnv("GITHUB_TOKEN", ENV_TOKEN);
    vi.stubGlobal("fetch", workingGitHub().fetch);

    await refreshTrackedTokens();

    expect(isTokenTracked(ENV_TOKEN)).toBe(true);
    expect(readPullRequestCache(ENV_TOKEN)).not.toBeNull();
  });

  it("drops a token GitHub rejects and clears its cache", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    trackTokenForBackgroundRefresh(COOKIE_TOKEN);
    writePullRequestCache(COOKIE_TOKEN, {
      pullRequests: [],
      repositoriesScanned: 0,
      repositoriesWithOpenPullRequests: 0,
      rateLimit: null,
      fetchedAt: "2026-08-31T00:00:00Z",
      warnings: [],
    });

    await refreshTrackedTokens();

    expect(isTokenTracked(COOKIE_TOKEN)).toBe(false);
    expect(readPullRequestCache(COOKIE_TOKEN)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rejected token"));
  });

  it("keeps a token whose scan failed for a non-auth reason", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () => ({
      status: 502,
      body: { message: "Server Error" },
    }));
    vi.stubGlobal("fetch", github.fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    trackTokenForBackgroundRefresh(COOKIE_TOKEN);
    await refreshTrackedTokens();

    expect(isTokenTracked(COOKIE_TOKEN)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("background refresh failed"));
  });
});

describe("startBackgroundRefresh", () => {
  it("runs immediately, repeats on the interval, and stops cleanly", async () => {
    vi.stubEnv("GITHUB_TOKEN", ENV_TOKEN);
    const github = workingGitHub();
    vi.stubGlobal("fetch", github.fetch);
    vi.useFakeTimers();

    const handle = startBackgroundRefresh({ intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(github.callsFor("RepositoryInventory")).toHaveLength(1);
    expect(readPullRequestCache(ENV_TOKEN)).not.toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(github.callsFor("RepositoryInventory")).toHaveLength(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(github.callsFor("RepositoryInventory")).toHaveLength(2);
  });

  it("is a singleton - a second start returns the running loop", async () => {
    vi.stubGlobal("fetch", workingGitHub().fetch);
    vi.useFakeTimers();

    const first = startBackgroundRefresh({ intervalMs: 60_000 });
    const second = startBackgroundRefresh({ intervalMs: 1_000 });

    expect(second).toBe(first);
    first.stop();
  });
});
