import { describe, expect, it } from "vitest";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { MockGitHub, RATE_LIMIT } from "~tests/mockGitHub";

describe("GitHubClient", () => {
  it("rejects an empty token before making a request", () => {
    expect(() => new GitHubClient("   ")).toThrow(GitHubError);
    expect(() => new GitHubClient("")).toThrowError(
      /personal access token is required/i,
    );
  });

  it("sends the bearer token and required headers on GraphQL calls", async () => {
    const github = new MockGitHub().onGraphQL("Viewer", () => ({
      body: { data: { rateLimit: RATE_LIMIT, viewer: { login: "octocat" } } },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);
    await client.graphql("query Viewer { viewer { login } }");

    const call = (github.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer ghp_token");
    expect(headers["User-Agent"]).toBe("GHManager/1.0");
    expect(headers.Accept).toContain("merge-info-preview");
    expect(init.method).toBe("POST");
  });

  it("accumulates the rate limit cost across calls", async () => {
    const github = new MockGitHub().onGraphQL("Viewer", () => ({
      body: {
        data: {
          rateLimit: { ...RATE_LIMIT, cost: 4, remaining: 4990 },
          viewer: { login: "octocat" },
        },
      },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);
    expect(client.getRateLimit()).toBeNull();

    await client.graphql("query Viewer { viewer { login } }");
    await client.graphql("query Viewer { viewer { login } }");

    const rateLimit = client.getRateLimit();
    expect(rateLimit).not.toBeNull();
    expect(rateLimit?.limit).toBe(5000);
    expect(rateLimit?.remaining).toBe(4990);
    expect(rateLimit?.usedThisRequest).toBe(8);
  });

  it("throws a classified GitHubError for a 401 GraphQL response", async () => {
    const github = new MockGitHub().onGraphQL("Viewer", () => ({
      status: 401,
      body: { message: "Bad credentials", documentation_url: "https://docs.github.com" },
    }));

    const client = new GitHubClient("ghp_bad", github.fetch);

    await expect(client.graphql("query Viewer { viewer { login } }")).rejects.toMatchObject({
      name: "GitHubError",
      status: 401,
      code: "UNAUTHORIZED",
      message: "Bad credentials",
      documentationUrl: "https://docs.github.com",
    });
  });

  it("throws when GraphQL returns errors and no data", async () => {
    const github = new MockGitHub().onGraphQL("Viewer", () => ({
      body: { errors: [{ message: "Something went wrong" }] },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);

    await expect(client.graphql("query Viewer { viewer { login } }")).rejects.toThrowError(
      "Something went wrong",
    );
  });

  it("flags RATE_LIMITED GraphQL errors as 429", async () => {
    const github = new MockGitHub().onGraphQL("Viewer", () => ({
      body: { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);

    await expect(client.graphql("query Viewer { viewer { login } }")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });

  it("returns partial data when GraphQL reports errors alongside data", async () => {
    const github = new MockGitHub().onGraphQL("Viewer", () => ({
      body: {
        data: { rateLimit: RATE_LIMIT, viewer: { login: "octocat" } },
        errors: [{ message: "Could not resolve one field" }],
      },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);
    const { data } = await client.graphql<{ viewer: { login: string } }>(
      "query Viewer { viewer { login } }",
    );

    expect(data.viewer.login).toBe("octocat");
  });

  it("wraps a network failure as a NETWORK error", async () => {
    const failing = (() => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;

    const client = new GitHubClient("ghp_token", failing);

    await expect(client.graphql("query Viewer { viewer { login } }")).rejects.toMatchObject({
      status: 0,
      code: "NETWORK",
      message: "Could not reach GitHub: connection refused",
    });
  });

  it("exposes response headers from REST calls", async () => {
    const github = new MockGitHub().onRest("GET", "/user", () => ({
      body: { login: "octocat" },
      headers: { "x-oauth-scopes": "repo, read:org" },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);
    const { data, response } = await client.rest<{ login: string }>("/user");

    expect(data?.login).toBe("octocat");
    expect(response.headers.get("x-oauth-scopes")).toBe("repo, read:org");
  });

  it("resolves to null for a 404 when allowNotFound is set", async () => {
    const github = new MockGitHub().onRest("GET", "/repos/acme/ghost", () => ({
      status: 404,
      body: { message: "Not Found" },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);
    const { data } = await client.rest("/repos/acme/ghost", { allowNotFound: true });

    expect(data).toBeNull();
  });

  it("joins nested REST validation errors into the message", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 422,
      body: {
        message: "Validation Failed",
        errors: [{ message: "Rebase merges are not allowed on this repository." }],
      },
    }));

    const client = new GitHubClient("ghp_token", github.fetch);

    await expect(
      client.rest("/repos/acme/widgets/pulls/1/merge", { method: "PUT", body: {} }),
    ).rejects.toThrowError(
      "Validation Failed - Rebase merges are not allowed on this repository.",
    );
  });
});
