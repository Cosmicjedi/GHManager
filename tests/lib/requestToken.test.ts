import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_COOKIE } from "@/lib/auth";
import { resolveRequestToken } from "@/lib/server/requestToken";
import { clearStoredTokens, upsertStoredToken } from "@/lib/server/tokenStore";

const COOKIE_TOKEN = "ghp_cookie_token_0123456789abc";
const STORED_TOKEN = "ghp_stored_token_0123456789abc";
const ENV_TOKEN = "ghp_env_token_0123456789abcdef";

function requestWith(cookie?: string): Request {
  return new Request("http://localhost:3000/api/pulls", {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  clearStoredTokens();
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearStoredTokens();
});

describe("resolveRequestToken", () => {
  it("resolves to none when nothing is configured", () => {
    expect(resolveRequestToken(requestWith())).toEqual({ token: null, source: "none" });
  });

  it("prefers a cookie token over everything", () => {
    vi.stubEnv("GITHUB_TOKEN", ENV_TOKEN);
    upsertStoredToken({
      token: STORED_TOKEN,
      viewer: { login: "octocat", name: null, avatarUrl: null, url: "" },
    });

    expect(resolveRequestToken(requestWith(`${TOKEN_COOKIE}=${COOKIE_TOKEN}`))).toEqual({
      token: COOKIE_TOKEN,
      source: "cookie",
    });
  });

  it("prefers the active stored token over the environment", () => {
    vi.stubEnv("GITHUB_TOKEN", ENV_TOKEN);
    upsertStoredToken({
      token: STORED_TOKEN,
      viewer: { login: "octocat", name: null, avatarUrl: null, url: "" },
    });

    expect(resolveRequestToken(requestWith())).toEqual({
      token: STORED_TOKEN,
      source: "stored",
    });
  });

  it("falls back to the environment token", () => {
    vi.stubEnv("GITHUB_TOKEN", ENV_TOKEN);
    expect(resolveRequestToken(requestWith())).toEqual({
      token: ENV_TOKEN,
      source: "env",
    });
  });
});
