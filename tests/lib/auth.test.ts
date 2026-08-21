import { describe, expect, it } from "vitest";
import {
  TOKEN_COOKIE,
  buildClearedTokenCookie,
  buildTokenCookie,
  environmentToken,
  looksLikeToken,
  parseCookies,
  parseScopes,
  resolveToken,
} from "@/lib/auth";

function requestWithCookie(cookie: string | null): Request {
  return new Request("http://localhost:3000/api/pulls", {
    headers: cookie ? { cookie } : {},
  });
}

describe("parseCookies", () => {
  it("parses multiple cookies and decodes values", () => {
    expect(parseCookies("a=1; b=hello%20world; c=")).toEqual({
      a: "1",
      b: "hello world",
      c: "",
    });
  });

  it("returns an empty map for a missing header", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });

  it("ignores malformed segments", () => {
    expect(parseCookies("novalue; =orphan; good=yes")).toEqual({ good: "yes" });
  });

  it("keeps a value that is not valid percent-encoding", () => {
    expect(parseCookies("token=abc%zz")).toEqual({ token: "abc%zz" });
  });
});

describe("environmentToken", () => {
  it("prefers GITHUB_TOKEN and falls back to GH_TOKEN", () => {
    expect(environmentToken({ GITHUB_TOKEN: "a", GH_TOKEN: "b" })).toBe("a");
    expect(environmentToken({ GH_TOKEN: "b" })).toBe("b");
  });

  it("treats blank values as absent", () => {
    expect(environmentToken({ GITHUB_TOKEN: "   " })).toBeNull();
    expect(environmentToken({})).toBeNull();
  });
});

describe("resolveToken", () => {
  it("prefers the cookie over the environment", () => {
    const resolved = resolveToken(
      requestWithCookie(`${TOKEN_COOKIE}=cookie-token`),
      { GITHUB_TOKEN: "env-token" },
    );

    expect(resolved).toEqual({ token: "cookie-token", source: "cookie" });
  });

  it("falls back to the environment when no cookie is present", () => {
    const resolved = resolveToken(requestWithCookie(null), {
      GITHUB_TOKEN: "env-token",
    });

    expect(resolved).toEqual({ token: "env-token", source: "env" });
  });

  it("reports no token when neither source has one", () => {
    const resolved = resolveToken(requestWithCookie("other=1"), {});
    expect(resolved).toEqual({ token: null, source: "none" });
  });

  it("ignores a blank cookie value", () => {
    const resolved = resolveToken(requestWithCookie(`${TOKEN_COOKIE}=`), {
      GITHUB_TOKEN: "env-token",
    });

    expect(resolved).toEqual({ token: "env-token", source: "env" });
  });
});

describe("cookie construction", () => {
  it("builds an httpOnly, strict, path-scoped cookie", () => {
    const cookie = buildTokenCookie("ghp_abc", { secure: false });

    expect(cookie).toContain(`${TOKEN_COOKIE}=ghp_abc`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when asked", () => {
    expect(buildTokenCookie("ghp_abc", { secure: true })).toContain("Secure");
  });

  it("percent-encodes the token value", () => {
    expect(buildTokenCookie("a b;c", { secure: false })).toContain("a%20b%3Bc");
  });

  it("expires the cookie immediately when cleared", () => {
    const cookie = buildClearedTokenCookie({ secure: false });
    expect(cookie).toContain(`${TOKEN_COOKIE}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });
});

describe("looksLikeToken", () => {
  it("accepts realistic classic and fine-grained tokens", () => {
    expect(looksLikeToken("ghp_1234567890abcdefghijABCDEF")).toBe(true);
    expect(looksLikeToken(`github_pat_${"a".repeat(40)}`)).toBe(true);
  });

  it("rejects empty, short and structurally wrong values", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("too-short")).toBe(false);
    expect(looksLikeToken("has spaces in it and is long enough")).toBe(false);
    expect(looksLikeToken(12345)).toBe(false);
    expect(looksLikeToken(null)).toBe(false);
    expect(looksLikeToken("a".repeat(600))).toBe(false);
  });
});

describe("parseScopes", () => {
  it("splits and trims the scope header", () => {
    expect(parseScopes("repo, read:org , workflow")).toEqual(["repo", "read:org", "workflow"]);
  });

  it("returns an empty list for a fine-grained token", () => {
    expect(parseScopes("")).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
  });
});
