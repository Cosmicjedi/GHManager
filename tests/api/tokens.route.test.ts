import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/tokens/route";
import { clearTrackedTokens, isTokenTracked } from "@/lib/server/backgroundRefresh";
import { clearPullRequestCache, readPullRequestCache } from "@/lib/server/pullCache";
import { clearStoredTokens, getActiveStoredToken, listStoredTokens } from "@/lib/server/tokenStore";
import { MockGitHub, RATE_LIMIT } from "~tests/mockGitHub";
import { rawRepository, resetFactories } from "~tests/factories";
import type { ServerTokensPayload } from "@/lib/types";

const TOKEN = "ghp_stored_token_0123456789abc";

function githubWithUser(login = "octocat"): MockGitHub {
  return new MockGitHub()
    .onRest("GET", "/user", () => ({
      body: {
        login,
        name: "The Octocat",
        avatar_url: null,
        html_url: `https://github.com/${login}`,
      },
      headers: { "x-oauth-scopes": "repo" },
    }))
    .onGraphQL("RepositoryInventory", () => ({
      body: {
        data: {
          rateLimit: RATE_LIMIT,
          viewer: {
            login,
            repositories: {
              totalCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                rawRepository({
                  nameWithOwner: "acme/widgets",
                  pullRequests: { totalCount: 0 },
                }),
              ],
            },
          },
        },
      },
    }));
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/tokens", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function addToken(token = TOKEN, extra: Record<string, unknown> = {}) {
  return POST(postRequest({ token, ...extra }));
}

beforeEach(() => {
  resetFactories();
  clearStoredTokens();
  clearTrackedTokens();
  clearPullRequestCache();
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearStoredTokens();
  clearTrackedTokens();
  clearPullRequestCache();
});

describe("/api/tokens", () => {
  it("lists nothing at first and reports whether an env token exists", async () => {
    const empty = (await (await GET()).json()) as ServerTokensPayload;
    expect(empty).toEqual({ tokens: [], envTokenConfigured: false });

    vi.stubEnv("GITHUB_TOKEN", "ghp_env_token_0123456789abcde");
    const withEnv = (await (await GET()).json()) as ServerTokensPayload;
    expect(withEnv.envTokenConfigured).toBe(true);
  });

  it("validates and stores a token, returning metadata but never the token", async () => {
    vi.stubGlobal("fetch", githubWithUser().fetch);

    const response = await addToken(TOKEN, { label: "bot" });
    expect(response.status).toBe(201);

    const body = (await response.json()) as ServerTokensPayload;
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      label: "bot",
      login: "octocat",
      active: true,
      maskedToken: "ghp_...9abc",
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    expect(getActiveStoredToken()?.token).toBe(TOKEN);
    expect(isTokenTracked(TOKEN)).toBe(true);
  });

  it("rejects a token GitHub does not accept and stores nothing", async () => {
    const github = new MockGitHub().onRest("GET", "/user", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await addToken();
    expect(response.status).toBe(401);
    expect(listStoredTokens().tokens).toHaveLength(0);
  });

  it("rejects a value that does not look like a token without calling GitHub", async () => {
    const github = githubWithUser();
    vi.stubGlobal("fetch", github.fetch);

    const response = await addToken("nope");
    expect(response.status).toBe(400);
    expect(github.restCalls).toHaveLength(0);
  });

  it("activates and relabels a stored token via PATCH", async () => {
    vi.stubGlobal("fetch", githubWithUser().fetch);
    await addToken(TOKEN);
    const other = "ghp_other_token_0123456789abcd";
    await addToken(other);

    const otherId = listStoredTokens().tokens.find(
      (entry) => entry.token === other,
    )?.id as string;

    const response = await PATCH(
      new Request("http://localhost:3000/api/tokens", {
        method: "PATCH",
        body: JSON.stringify({ id: otherId, active: true, label: "backup" }),
      }),
    );
    const body = (await response.json()) as ServerTokensPayload;

    expect(response.status).toBe(200);
    expect(body.tokens.find((entry) => entry.id === otherId)).toMatchObject({
      active: true,
      label: "backup",
    });
    expect(getActiveStoredToken()?.token).toBe(other);
  });

  it("removes a token, untracks it and drops its cache", async () => {
    vi.stubGlobal("fetch", githubWithUser().fetch);
    await addToken(TOKEN);
    const id = listStoredTokens().tokens[0].id;

    // Adding a token kicks off a background warm-up; wait for it to land so
    // it cannot re-populate the cache after the delete below clears it.
    await vi.waitFor(() => expect(readPullRequestCache(TOKEN)).not.toBeNull());

    const response = await DELETE(
      new Request(`http://localhost:3000/api/tokens?id=${id}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(listStoredTokens().tokens).toHaveLength(0);
    expect(isTokenTracked(TOKEN)).toBe(false);
    expect(readPullRequestCache(TOKEN)).toBeNull();
  });

  it("answers 404 for an unknown id", async () => {
    const response = await DELETE(
      new Request("http://localhost:3000/api/tokens?id=unknown", { method: "DELETE" }),
    );
    expect(response.status).toBe(404);
  });
});
