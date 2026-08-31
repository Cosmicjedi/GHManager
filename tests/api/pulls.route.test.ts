import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/pulls/route";
import { TOKEN_COOKIE } from "@/lib/auth";
import { clearTrackedTokens, isTokenTracked } from "@/lib/server/backgroundRefresh";
import { clearPullRequestCache } from "@/lib/server/pullCache";
import { MockGitHub, RATE_LIMIT } from "~tests/mockGitHub";
import { rawPullRequest, rawRepository, resetFactories } from "~tests/factories";

const TOKEN = "ghp_0123456789abcdefghijklmno";

function pullsRequest(
  options: { refresh?: boolean; stream?: boolean; cookie?: string | null } = {},
): Request {
  const cookie = options.cookie === undefined ? `${TOKEN_COOKIE}=${TOKEN}` : options.cookie;
  const params = new URLSearchParams();
  if (options.stream) params.set("stream", "1");
  if (options.refresh) params.set("refresh", "1");
  const query = params.toString();
  return new Request(`http://localhost:3000/api/pulls${query ? `?${query}` : ""}`, {
    headers: cookie ? { cookie } : {},
  });
}

async function readStreamLines(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

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
              nodes: [rawRepository({ nameWithOwner: "acme/widgets", pullRequests: { totalCount: 1 } })],
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

beforeEach(() => {
  resetFactories();
  clearPullRequestCache();
  clearTrackedTokens();
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearPullRequestCache();
});

describe("GET /api/pulls", () => {
  it("returns 401 with requiresAuth when there is no token", async () => {
    const response = await GET(pullsRequest({ cookie: null }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "UNAUTHORIZED", requiresAuth: true });
  });

  it("returns the normalised pull request payload", async () => {
    vi.stubGlobal("fetch", workingGitHub().fetch);

    const response = await GET(pullsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pullRequests).toHaveLength(1);
    expect(body.pullRequests[0]).toMatchObject({
      number: 5,
      title: "Pull request 5",
      viewerCanMerge: true,
    });
    expect(body.pullRequests[0].repository.nameWithOwner).toBe("acme/widgets");
    expect(body.repositoriesScanned).toBe(1);
    expect(body.repositoriesWithOpenPullRequests).toBe(1);
    expect(body.cached).toBe(false);
    expect(body.rateLimit).toMatchObject({ limit: 5000 });
  });

  it("tracks the token so the background refresher keeps its cache warm", async () => {
    vi.stubGlobal("fetch", workingGitHub().fetch);

    expect(isTokenTracked(TOKEN)).toBe(false);
    await GET(pullsRequest());

    expect(isTokenTracked(TOKEN)).toBe(true);
  });

  it("serves the second identical request from the cache", async () => {
    const github = workingGitHub();
    vi.stubGlobal("fetch", github.fetch);

    await GET(pullsRequest());
    const graphqlCallsAfterFirst = github.graphqlCalls.length;

    const second = await GET(pullsRequest());
    const body = await second.json();

    expect(body.cached).toBe(true);
    expect(github.graphqlCalls.length).toBe(graphqlCallsAfterFirst);
  });

  it("bypasses the cache when refresh=1", async () => {
    const github = workingGitHub();
    vi.stubGlobal("fetch", github.fetch);

    await GET(pullsRequest());
    const callsAfterFirst = github.graphqlCalls.length;

    const refreshed = await GET(pullsRequest({ refresh: true }));
    const body = await refreshed.json();

    expect(body.cached).toBe(false);
    expect(github.graphqlCalls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("keys the cache by token so a different token refetches", async () => {
    const github = workingGitHub();
    vi.stubGlobal("fetch", github.fetch);

    await GET(pullsRequest());
    const callsAfterFirst = github.graphqlCalls.length;

    const other = await GET(pullsRequest({ cookie: `${TOKEN_COOKIE}=ghp_someone_else_token_xx` }));
    const body = await other.json();

    expect(body.cached).toBe(false);
    expect(github.graphqlCalls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("uses the server token when no cookie is present", async () => {
    vi.stubEnv("GITHUB_TOKEN", TOKEN);
    const github = workingGitHub();
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(pullsRequest({ cookie: null }));

    expect(response.status).toBe(200);
    expect(github.graphqlCalls.length).toBeGreaterThan(0);
  });

  it("maps a rejected token to 401 requiresAuth", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(pullsRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.requiresAuth).toBe(true);
    expect(body.error).toContain("Sign in again");
  });

  it("passes a non-auth GitHub failure through with its status", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () => ({
      status: 502,
      body: { message: "Server Error" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(pullsRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.requiresAuth).toBe(false);
    expect(body.error).toBe("Server Error");
  });

  it("streams progress lines and a final complete payload when stream=1", async () => {
    vi.stubGlobal("fetch", workingGitHub().fetch);

    const response = await GET(pullsRequest({ stream: true }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const lines = await readStreamLines(response);
    expect(lines.some((line) => line.kind === "progress")).toBe(true);

    const last = lines.at(-1) as {
      kind: string;
      payload: { pullRequests: unknown[]; cached: boolean };
    };
    expect(last.kind).toBe("complete");
    expect(last.payload.pullRequests).toHaveLength(1);
    expect(last.payload.cached).toBe(false);

    // Each pull request travels at most once across all progress lines.
    const progressIds = lines
      .filter((line) => line.kind === "progress")
      .flatMap((line) =>
        (line.pullRequests as Array<{ id: string }>).map((pullRequest) => pullRequest.id),
      );
    expect(new Set(progressIds).size).toBe(progressIds.length);
  });

  it("streams a cached payload as a single complete line without hitting GitHub", async () => {
    const github = workingGitHub();
    vi.stubGlobal("fetch", github.fetch);

    await GET(pullsRequest());
    const callsAfterFirst = github.graphqlCalls.length;

    const response = await GET(pullsRequest({ stream: true }));
    const lines = await readStreamLines(response);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "complete" });
    expect((lines[0].payload as { cached: boolean }).cached).toBe(true);
    expect(github.graphqlCalls.length).toBe(callsAfterFirst);
  });

  it("streams a GitHub failure as an error line with the real status", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(pullsRequest({ stream: true }));

    // Headers are already committed when the scan fails, so HTTP stays 200.
    expect(response.status).toBe(200);
    const lines = await readStreamLines(response);
    expect(lines.at(-1)).toMatchObject({
      kind: "error",
      status: 401,
      requiresAuth: true,
    });
  });

  it("reports repository level warnings without failing the request", async () => {
    const github = new MockGitHub()
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
                  rawRepository({ nameWithOwner: "acme/broken", pullRequests: { totalCount: 2 } }),
                ],
              },
            },
          },
        },
      }))
      .onGraphQL("RepositoryPullRequests", () => ({
        status: 500,
        body: { message: "Server Error" },
      }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(pullsRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pullRequests).toEqual([]);
    expect(body.warnings[0]).toContain("acme/broken");
  });
});
