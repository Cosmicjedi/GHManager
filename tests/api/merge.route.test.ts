import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/merge/route";
import { TOKEN_COOKIE } from "@/lib/auth";
import { MAX_BULK_MERGE_ITEMS } from "@/lib/constants";
import { clearPullRequestCache, readPullRequestCache, writePullRequestCache } from "@/lib/server/pullCache";
import { MockGitHub } from "~tests/mockGitHub";

const TOKEN = "ghp_0123456789abcdefghijklmno";

function mergeRequest(body: unknown, options: { cookie?: string | null } = {}): Request {
  const cookie = options.cookie === undefined ? `${TOKEN_COOKIE}=${TOKEN}` : options.cookie;
  return new Request("http://localhost:3000/api/merge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function successfulGitHub(): MockGitHub {
  return new MockGitHub().onRest("PUT", /\/pulls\/(\d+)\/merge$/, (call) => {
    const number = /\/pulls\/(\d+)\/merge$/.exec(call.path)?.[1];
    return { body: { sha: `sha-${number}`, merged: true } };
  });
}

beforeEach(() => {
  clearPullRequestCache();
  vi.stubEnv("GITHUB_TOKEN", "");
  vi.stubEnv("GH_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearPullRequestCache();
});

describe("POST /api/merge", () => {
  it("returns 401 when no token is available", async () => {
    const response = await POST(
      mergeRequest({ items: [{ owner: "acme", repo: "widgets", number: 1 }] }, { cookie: null }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.requiresAuth).toBe(true);
  });

  it("merges a single pull request", async () => {
    const github = successfulGitHub();
    vi.stubGlobal("fetch", github.fetch);

    const response = await POST(
      mergeRequest({
        items: [{ owner: "acme", repo: "widgets", number: 7, headSha: "head-7" }],
        mergeMethod: "squash",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mergedCount).toBe(1);
    expect(body.failedCount).toBe(0);
    expect(body.results[0]).toMatchObject({
      owner: "acme",
      repo: "widgets",
      number: 7,
      status: "merged",
      sha: "sha-7",
    });

    expect(github.restCalls[0].path).toBe("/repos/acme/widgets/pulls/7/merge");
    expect(github.restCalls[0].body).toEqual({ merge_method: "squash", sha: "head-7" });
  });

  it("merges several pull requests and reports partial failure", async () => {
    const github = new MockGitHub().onRest("PUT", /\/pulls\/(\d+)\/merge$/, (call) => {
      if (call.path.includes("/pulls/2/")) {
        return { status: 405, body: { message: "Pull Request is not mergeable" } };
      }
      return { body: { sha: "ok", merged: true } };
    });
    vi.stubGlobal("fetch", github.fetch);

    const response = await POST(
      mergeRequest({
        items: [
          { owner: "acme", repo: "widgets", number: 1 },
          { owner: "acme", repo: "widgets", number: 2 },
          { owner: "acme", repo: "gadgets", number: 3 },
        ],
      }),
    );
    const body = await response.json();

    expect(body.mergedCount).toBe(2);
    expect(body.failedCount).toBe(1);
    expect(body.results.map((result: { status: string }) => result.status)).toEqual([
      "merged",
      "failed",
      "merged",
    ]);
    expect(body.results[1].errorCode).toBe("NOT_MERGEABLE");
    expect(body.results[1].message).toContain("not mergeable");
  });

  it("invalidates the cached pull request payload after merging", async () => {
    vi.stubGlobal("fetch", successfulGitHub().fetch);

    writePullRequestCache(TOKEN, {
      pullRequests: [],
      repositoriesScanned: 1,
      repositoriesWithOpenPullRequests: 1,
      rateLimit: null,
      fetchedAt: "2026-08-21T10:00:00Z",
      warnings: [],
    });
    expect(readPullRequestCache(TOKEN)).not.toBeNull();

    await POST(mergeRequest({ items: [{ owner: "acme", repo: "widgets", number: 1 }] }));

    expect(readPullRequestCache(TOKEN)).toBeNull();
  });

  it("rejects an empty selection", async () => {
    const response = await POST(mergeRequest({ items: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("at least one");
  });

  it("rejects a missing items array", async () => {
    const response = await POST(mergeRequest({}));
    expect(response.status).toBe(400);
  });

  it("rejects a non-JSON body", async () => {
    const response = await POST(mergeRequest("not json"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("JSON body");
  });

  it("rejects an item that is missing fields, naming its position", async () => {
    const response = await POST(
      mergeRequest({
        items: [
          { owner: "acme", repo: "widgets", number: 1 },
          { owner: "acme", number: 2 },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Item 2");
  });

  it("rejects a non-positive pull request number", async () => {
    const response = await POST(
      mergeRequest({ items: [{ owner: "acme", repo: "widgets", number: -3 }] }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts a numeric string pull request number", async () => {
    vi.stubGlobal("fetch", successfulGitHub().fetch);

    const response = await POST(
      mergeRequest({ items: [{ owner: "acme", repo: "widgets", number: "9" }] }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].number).toBe(9);
  });

  it("rejects an unknown merge method", async () => {
    const response = await POST(
      mergeRequest({
        items: [{ owner: "acme", repo: "widgets", number: 1 }],
        mergeMethod: "fast-forward",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("merge, squash or rebase");
  });

  it("defaults to a merge commit when no method is given", async () => {
    const github = successfulGitHub();
    vi.stubGlobal("fetch", github.fetch);

    await POST(mergeRequest({ items: [{ owner: "acme", repo: "widgets", number: 1 }] }));

    expect(github.restCalls[0].body).toEqual({ merge_method: "merge" });
  });

  it("refuses more than the bulk limit", async () => {
    const items = Array.from({ length: MAX_BULK_MERGE_ITEMS + 1 }, (_, index) => ({
      owner: "acme",
      repo: "widgets",
      number: index + 1,
    }));

    const response = await POST(mergeRequest({ items }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain(`at most ${MAX_BULK_MERGE_ITEMS}`);
  });

  it("forwards a commit title and message", async () => {
    const github = successfulGitHub();
    vi.stubGlobal("fetch", github.fetch);

    await POST(
      mergeRequest({
        items: [{ owner: "acme", repo: "widgets", number: 1 }],
        mergeMethod: "squash",
        commitTitle: "Release 2.0",
        commitMessage: "Bundled changes",
      }),
    );

    expect(github.restCalls[0].body).toEqual({
      merge_method: "squash",
      commit_title: "Release 2.0",
      commit_message: "Bundled changes",
    });
  });
});
