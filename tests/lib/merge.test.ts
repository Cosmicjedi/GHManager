import { describe, expect, it } from "vitest";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { explain, isMergeMethod, mergePullRequest, mergePullRequests } from "@/lib/github/merge";
import { MockGitHub } from "~tests/mockGitHub";

const ITEM = { owner: "acme", repo: "widgets", number: 12 };

describe("isMergeMethod", () => {
  it("accepts the three GitHub merge methods and nothing else", () => {
    expect(isMergeMethod("merge")).toBe(true);
    expect(isMergeMethod("squash")).toBe(true);
    expect(isMergeMethod("rebase")).toBe(true);
    expect(isMergeMethod("fast-forward")).toBe(false);
    expect(isMergeMethod(undefined)).toBe(false);
  });
});

describe("mergePullRequest", () => {
  it("merges and returns the resulting commit sha", async () => {
    const github = new MockGitHub().onRest("PUT", "/repos/acme/widgets/pulls/12/merge", () => ({
      body: { sha: "abc123def456", merged: true, message: "Pull Request successfully merged" },
    }));

    const result = await mergePullRequest(
      new GitHubClient("ghp_token", github.fetch),
      { ...ITEM, headSha: "head-sha" },
      { mergeMethod: "squash", commitTitle: "Ship it" },
    );

    expect(result).toMatchObject({
      owner: "acme",
      repo: "widgets",
      number: 12,
      status: "merged",
      sha: "abc123def456",
      errorCode: null,
      httpStatus: 200,
    });

    expect(github.restCalls[0].body).toEqual({
      merge_method: "squash",
      sha: "head-sha",
      commit_title: "Ship it",
    });
  });

  it("defaults to a merge commit and omits the sha when none is supplied", async () => {
    const github = new MockGitHub().onRest("PUT", "/repos/acme/widgets/pulls/12/merge", () => ({
      body: { sha: "abc", merged: true },
    }));

    await mergePullRequest(new GitHubClient("ghp_token", github.fetch), ITEM);

    expect(github.restCalls[0].body).toEqual({ merge_method: "merge" });
  });

  it("reports a 405 as a not-mergeable failure with GitHub's explanation", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 405,
      body: { message: "Pull Request is not mergeable" },
    }));

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), ITEM);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("NOT_MERGEABLE");
    expect(result.httpStatus).toBe(405);
    expect(result.message).toContain("Pull Request is not mergeable");
    expect(result.message).toContain("required reviews or status checks");
  });

  it("distinguishes a moved head branch from a merge conflict", async () => {
    const moved = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 409,
      body: { message: "Head branch was modified. Review and try the merge again." },
    }));

    const movedResult = await mergePullRequest(
      new GitHubClient("ghp_token", moved.fetch),
      ITEM,
    );
    expect(movedResult.errorCode).toBe("HEAD_CHANGED");
    expect(movedResult.message).toContain("Refresh and try again");

    const conflicted = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 409,
      body: { message: "Merge conflict between base and head" },
    }));

    const conflictResult = await mergePullRequest(
      new GitHubClient("ghp_token", conflicted.fetch),
      ITEM,
    );
    expect(conflictResult.errorCode).toBe("CONFLICT");
    expect(conflictResult.message).toContain("Merge conflict");
  });

  it("reports a rejected merge method as a validation failure", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 422,
      body: {
        message: "Validation Failed",
        errors: [{ message: "Rebase merges are not allowed on this repository." }],
      },
    }));

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), ITEM, {
      mergeMethod: "rebase",
    });

    expect(result.errorCode).toBe("VALIDATION");
    expect(result.message).toContain("Rebase merges are not allowed");
  });

  it("reports a missing pull request clearly", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 404,
      body: { message: "Not Found" },
    }));

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), ITEM);

    expect(result.errorCode).toBe("NOT_FOUND");
    expect(result.message).toContain("already be merged or closed");
  });

  it("reports a forbidden merge", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 403,
      body: { message: "Resource not accessible by personal access token" },
    }));

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), ITEM);

    expect(result.errorCode).toBe("FORBIDDEN");
    expect(result.message).toContain("not allowed to merge");
  });

  it("reports a rate limited merge", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      status: 403,
      body: { message: "API rate limit exceeded for user" },
    }));

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), ITEM);

    expect(result.errorCode).toBe("RATE_LIMITED");
  });

  it("handles a 200 response that says merged=false", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, () => ({
      body: { merged: false, message: "Base branch was modified" },
    }));

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), ITEM);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("NOT_MERGEABLE");
    expect(result.message).toBe("Base branch was modified");
  });

  it("surfaces a network failure without throwing", async () => {
    const failing = (() => {
      throw new TypeError("socket hang up");
    }) as unknown as typeof fetch;

    const result = await mergePullRequest(new GitHubClient("ghp_token", failing), ITEM);

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("NETWORK");
    expect(result.message).toContain("socket hang up");
  });

  it("validates the item before calling GitHub", async () => {
    const github = new MockGitHub();

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), {
      owner: "acme",
      repo: "",
      number: 3,
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("VALIDATION");
    expect(result.message).toBe("A repository name is required.");
    expect(github.restCalls).toHaveLength(0);
  });

  it("rejects a non-positive pull request number", async () => {
    const github = new MockGitHub();

    const result = await mergePullRequest(new GitHubClient("ghp_token", github.fetch), {
      owner: "acme",
      repo: "widgets",
      number: 0,
    });

    expect(result.errorCode).toBe("VALIDATION");
    expect(result.message).toBe("A positive pull request number is required.");
  });
});

describe("mergePullRequests", () => {
  it("returns a result for every item, preserving input order", async () => {
    const github = new MockGitHub().onRest("PUT", /\/pulls\/(\d+)\/merge$/, (call) => {
      const number = Number(/\/pulls\/(\d+)\/merge$/.exec(call.path)?.[1]);
      if (number === 2) {
        return { status: 405, body: { message: "Pull Request is not mergeable" } };
      }
      return { body: { sha: `sha-${number}`, merged: true } };
    });

    const payload = await mergePullRequests(
      new GitHubClient("ghp_token", github.fetch),
      [
        { owner: "acme", repo: "widgets", number: 1 },
        { owner: "acme", repo: "widgets", number: 2 },
        { owner: "acme", repo: "widgets", number: 3 },
      ],
      { concurrency: 2 },
    );

    expect(payload.results.map((result) => result.number)).toEqual([1, 2, 3]);
    expect(payload.results.map((result) => result.status)).toEqual([
      "merged",
      "failed",
      "merged",
    ]);
    expect(payload.mergedCount).toBe(2);
    expect(payload.failedCount).toBe(1);
  });

  it("returns an empty payload for an empty selection", async () => {
    const github = new MockGitHub();
    const payload = await mergePullRequests(new GitHubClient("ghp_token", github.fetch), []);

    expect(payload).toEqual({ results: [], mergedCount: 0, failedCount: 0 });
    expect(github.restCalls).toHaveLength(0);
  });

  it("keeps merging after one repository refuses", async () => {
    const github = new MockGitHub().onRest("PUT", /\/merge$/, (call) => {
      if (call.path.includes("/locked/")) {
        return { status: 403, body: { message: "Resource not accessible" } };
      }
      return { body: { sha: "ok", merged: true } };
    });

    const payload = await mergePullRequests(new GitHubClient("ghp_token", github.fetch), [
      { owner: "acme", repo: "locked", number: 1 },
      { owner: "acme", repo: "open", number: 2 },
    ]);

    expect(payload.mergedCount).toBe(1);
    expect(payload.failedCount).toBe(1);
    expect(payload.results[0].errorCode).toBe("FORBIDDEN");
    expect(payload.results[1].status).toBe("merged");
  });
});

describe("explain", () => {
  it("maps an expired token to an actionable message", () => {
    expect(explain(new GitHubError("Bad credentials", { status: 401 }))).toEqual({
      code: "UNAUTHORIZED",
      message: "Your GitHub token was rejected. Sign in again with a valid token.",
    });
  });

  it("falls back to the raw message for an unmapped status", () => {
    expect(explain(new GitHubError("Bad gateway", { status: 502 }))).toMatchObject({
      message: "Bad gateway",
    });
  });

  it("describes an empty message by status", () => {
    expect(explain(new GitHubError("", { status: 503 })).message).toBe(
      "GitHub responded with status 503.",
    );
  });
});
