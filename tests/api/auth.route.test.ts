import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/auth/route";
import { TOKEN_COOKIE } from "@/lib/auth";
import { MockGitHub } from "~tests/mockGitHub";

const VALID_TOKEN = "ghp_0123456789abcdefghijklmno";

function authRequest(init: { cookie?: string; body?: unknown } = {}): Request {
  return new Request("http://localhost:3000/api/auth", {
    method: init.body === undefined ? "GET" : "POST",
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function userHandler(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      login: "octocat",
      name: "The Octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/1",
      html_url: "https://github.com/octocat",
      ...overrides,
    },
    headers: { "x-oauth-scopes": "repo, read:org" },
  };
}

beforeEach(() => {
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/auth", () => {
  it("reports signed out when no token is available", async () => {
    const response = await GET(authRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      authenticated: false,
      source: "none",
      viewer: null,
      scopes: [],
      managedByServer: false,
      error: null,
    });
  });

  it("resolves the viewer and scopes from a cookie token", async () => {
    const github = new MockGitHub().onRest("GET", "/user", () => userHandler());
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(authRequest({ cookie: `${TOKEN_COOKIE}=${VALID_TOKEN}` }));
    const body = await response.json();

    expect(body.authenticated).toBe(true);
    expect(body.source).toBe("cookie");
    expect(body.managedByServer).toBe(false);
    expect(body.viewer).toEqual({
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      url: "https://github.com/octocat",
    });
    expect(body.scopes).toEqual(["repo", "read:org"]);
  });

  it("marks an environment token as managed by the server", async () => {
    vi.stubEnv("GITHUB_TOKEN", VALID_TOKEN);
    const github = new MockGitHub().onRest("GET", "/user", () => userHandler());
    vi.stubGlobal("fetch", github.fetch);

    const body = await (await GET(authRequest())).json();

    expect(body.source).toBe("env");
    expect(body.managedByServer).toBe(true);
  });

  it("clears a cookie token that GitHub no longer accepts", async () => {
    const github = new MockGitHub().onRest("GET", "/user", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(authRequest({ cookie: `${TOKEN_COOKIE}=${VALID_TOKEN}` }));
    const body = await response.json();

    expect(body.authenticated).toBe(false);
    expect(body.error).toContain("no longer valid");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not clear anything when a server token fails", async () => {
    vi.stubEnv("GITHUB_TOKEN", VALID_TOKEN);
    const github = new MockGitHub().onRest("GET", "/user", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await GET(authRequest());

    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/auth", () => {
  it("verifies and stores a valid token in an httpOnly cookie", async () => {
    const github = new MockGitHub().onRest("GET", "/user", () => userHandler());
    vi.stubGlobal("fetch", github.fetch);

    const response = await POST(authRequest({ body: { token: VALID_TOKEN } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.viewer.login).toBe("octocat");

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${TOKEN_COOKIE}=${VALID_TOKEN}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    expect(github.restCalls[0].headers.authorization).toBe(`Bearer ${VALID_TOKEN}`);
  });

  it("rejects a missing token", async () => {
    const response = await POST(authRequest({ body: {} }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("required");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a token that cannot possibly be valid without calling GitHub", async () => {
    const github = new MockGitHub();
    vi.stubGlobal("fetch", github.fetch);

    const response = await POST(authRequest({ body: { token: "nope" } }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("does not look like");
    expect(github.restCalls).toHaveLength(0);
  });

  it("rejects a non-JSON body", async () => {
    const request = new Request("http://localhost:3000/api/auth", {
      method: "POST",
      body: "not json",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("surfaces a GitHub rejection as a 401", async () => {
    const github = new MockGitHub().onRest("GET", "/user", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await POST(authRequest({ body: { token: VALID_TOKEN } }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain("GitHub rejected that token");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("surfaces a forbidden token as a 403", async () => {
    const github = new MockGitHub().onRest("GET", "/user", () => ({
      status: 403,
      body: { message: "SAML enforcement required" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const response = await POST(authRequest({ body: { token: VALID_TOKEN } }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("SAML enforcement required");
  });
});

describe("DELETE /api/auth", () => {
  it("clears the cookie and reports signed out", async () => {
    const response = await DELETE();
    const body = await response.json();

    expect(body.authenticated).toBe(false);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("falls back to the server token when one is configured", async () => {
    vi.stubEnv("GITHUB_TOKEN", VALID_TOKEN);
    const github = new MockGitHub().onRest("GET", "/user", () => userHandler());
    vi.stubGlobal("fetch", github.fetch);

    const response = await DELETE();
    const body = await response.json();

    expect(body.authenticated).toBe(true);
    expect(body.source).toBe("env");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("reports a broken server token after clearing the cookie", async () => {
    vi.stubEnv("GITHUB_TOKEN", VALID_TOKEN);
    const github = new MockGitHub().onRest("GET", "/user", () => ({
      status: 401,
      body: { message: "Bad credentials" },
    }));
    vi.stubGlobal("fetch", github.fetch);

    const body = await (await DELETE()).json();

    expect(body.authenticated).toBe(false);
    expect(body.error).toContain("not usable");
  });
});
