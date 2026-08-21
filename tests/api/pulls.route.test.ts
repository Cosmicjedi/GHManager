import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/pulls/route";
import { TOKEN_COOKIE } from "@/lib/auth";
import { clearPullRequestCache } from "@/lib/server/pullCache";
import { MockGitHub, RATE_LIMIT } from "~tests/mockGitHub";
import { rawPullRequest, rawRepository, resetFactories } from "~tests/factories";

const TOKEN = "ghp_0123456789abcdefghijklmno";

function pullsRequest(options: { refresh?: boolean; cookie?: string | null } = {}): Request {
  const cookie = options.cookie === undefined ? `${TOKEN_COOKIE}=${TOKEN}` : options.cookie;
  return new Request(
    `http://localhost:3000/api/pulls${options.refresh ? "?refresh=1" : ""}`,
    { headers: cookie ? { cookie } : {} },
  );
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
