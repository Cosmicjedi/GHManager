import { beforeEach, describe, expect, it } from "vitest";
import {
  allowedMergeMethods,
  computeMergeability,
  mapPullRequest,
  mapRepository,
  summariseChecks,
  toMergeStateStatus,
  toMergeableState,
  toReviewDecision,
} from "@/lib/github/mappers";
import type { ChecksSummary } from "@/lib/types";
import { rawPullRequest, rawRepository, repositorySummary, resetFactories } from "~tests/factories";

const NO_CHECKS: ChecksSummary = {
  state: "NONE",
  total: 0,
  success: 0,
  failure: 0,
  pending: 0,
  skipped: 0,
};

beforeEach(() => {
  resetFactories();
});

describe("enum coercion", () => {
  it("normalises merge state statuses and falls back to UNKNOWN", () => {
    expect(toMergeStateStatus("clean")).toBe("CLEAN");
    expect(toMergeStateStatus("BLOCKED")).toBe("BLOCKED");
    expect(toMergeStateStatus("something-new")).toBe("UNKNOWN");
    expect(toMergeStateStatus(null)).toBe("UNKNOWN");
  });

  it("normalises mergeable states", () => {
    expect(toMergeableState("mergeable")).toBe("MERGEABLE");
    expect(toMergeableState("CONFLICTING")).toBe("CONFLICTING");
    expect(toMergeableState(undefined)).toBe("UNKNOWN");
  });

  it("normalises review decisions", () => {
    expect(toReviewDecision("approved")).toBe("APPROVED");
    expect(toReviewDecision("REVIEW_REQUIRED")).toBe("REVIEW_REQUIRED");
    expect(toReviewDecision("")).toBeNull();
  });
});

describe("mapRepository", () => {
  it("maps repository settings including allowed merge methods", () => {
    const repository = mapRepository(
      rawRepository({
        nameWithOwner: "acme/rockets",
        isPrivate: true,
        squashMergeAllowed: false,
        rebaseMergeAllowed: false,
        pullRequests: { totalCount: 7 },
      }),
    );

    expect(repository).toMatchObject({
      nameWithOwner: "acme/rockets",
      owner: "acme",
      name: "rockets",
      isPrivate: true,
      defaultBranch: "main",
      viewerPermission: "WRITE",
      allowedMergeMethods: ["merge"],
      openPullRequestCount: 7,
    });
  });

  it("falls back to the owner in nameWithOwner when the owner object is missing", () => {
    const repository = mapRepository(
      rawRepository({ nameWithOwner: "someone/thing", owner: null }),
    );
    expect(repository.owner).toBe("someone");
  });

  it("treats an unrequested merge-method flag as allowed", () => {
    expect(
      allowedMergeMethods(
        rawRepository({
          mergeCommitAllowed: null,
          squashMergeAllowed: null,
          rebaseMergeAllowed: null,
        }),
      ),
    ).toEqual(["merge", "squash", "rebase"]);
  });
});

describe("summariseChecks", () => {
  it("returns an empty summary when there is no rollup", () => {
    const summary = summariseChecks(
      rawPullRequest({
        commits: { nodes: [{ commit: { oid: "abc", statusCheckRollup: null } }] },
      }),
    );
    expect(summary).toEqual(NO_CHECKS);
  });

  it("counts check runs and status contexts by outcome", () => {
    const summary = summariseChecks(
      rawPullRequest({
        commits: {
          nodes: [
            {
              commit: {
                oid: "abc",
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: {
                    totalCount: 6,
                    nodes: [
                      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
                      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
                      { __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS", conclusion: null },
                      { __typename: "CheckRun", name: "opt", status: "COMPLETED", conclusion: "SKIPPED" },
                      { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS" },
                      { __typename: "StatusContext", context: "ci/flaky", state: "ERROR" },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    );

    expect(summary).toEqual({
      state: "FAILURE",
      total: 6,
      success: 2,
      failure: 2,
      pending: 1,
      skipped: 1,
    });
  });

  it("derives a state when the rollup state is missing", () => {
    const summary = summariseChecks(
      rawPullRequest({
        commits: {
          nodes: [
            {
              commit: {
                oid: "abc",
                statusCheckRollup: {
                  state: null,
                  contexts: {
                    totalCount: 1,
                    nodes: [
                      { __typename: "CheckRun", name: "build", status: "QUEUED", conclusion: null },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    );

    expect(summary.state).toBe("PENDING");
    expect(summary.pending).toBe(1);
  });
});

describe("computeMergeability", () => {
  const base = {
    isDraft: false,
    mergeable: "MERGEABLE" as const,
    mergeStateStatus: "CLEAN" as const,
    reviewDecision: "APPROVED" as const,
    checks: { ...NO_CHECKS, state: "SUCCESS" as const, total: 1, success: 1 },
    viewerCanMerge: true,
    isArchived: false,
  };

  it("reports a clean pull request as ready", () => {
    expect(computeMergeability(base)).toMatchObject({
      canMerge: true,
      label: "Ready",
      tone: "positive",
    });
  });

  it("blocks archived repositories first", () => {
    expect(computeMergeability({ ...base, isArchived: true })).toMatchObject({
      canMerge: false,
      label: "Archived",
    });
  });

  it("blocks when the viewer has no write access", () => {
    expect(computeMergeability({ ...base, viewerCanMerge: false })).toMatchObject({
      canMerge: false,
      label: "No write access",
    });
  });

  it("blocks drafts", () => {
    expect(computeMergeability({ ...base, isDraft: true })).toMatchObject({
      canMerge: false,
      label: "Draft",
    });
  });

  it("blocks conflicts", () => {
    expect(
      computeMergeability({ ...base, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
    ).toMatchObject({ canMerge: false, label: "Conflicts", tone: "negative" });
  });

  it("explains why branch protection blocks the merge", () => {
    const verdict = computeMergeability({
      ...base,
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      checks: { ...NO_CHECKS, state: "FAILURE", total: 3, success: 1, failure: 2 },
    });

    expect(verdict.canMerge).toBe(false);
    expect(verdict.label).toBe("Blocked");
    expect(verdict.reason).toContain("a required review is missing");
    expect(verdict.reason).toContain("2 check(s) failed");
  });

  it("blocks a branch that is behind its base", () => {
    expect(computeMergeability({ ...base, mergeStateStatus: "BEHIND" })).toMatchObject({
      canMerge: false,
      label: "Behind base",
      tone: "warning",
    });
  });

  it("allows an UNSTABLE pull request but warns about the checks", () => {
    expect(computeMergeability({ ...base, mergeStateStatus: "UNSTABLE" })).toMatchObject({
      canMerge: true,
      label: "Mergeable, checks red",
      tone: "warning",
    });
  });

  it("waits while GitHub is still computing the merge state", () => {
    expect(
      computeMergeability({ ...base, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
    ).toMatchObject({ canMerge: false, label: "Checking" });
  });

  it("holds back a mergeable pull request whose checks are still running", () => {
    expect(
      computeMergeability({
        ...base,
        mergeStateStatus: "UNKNOWN",
        checks: { ...NO_CHECKS, state: "PENDING", total: 1, pending: 1 },
      }),
    ).toMatchObject({ canMerge: false, label: "Checks running" });
  });
});

describe("mapPullRequest", () => {
  it("produces a complete domain pull request", () => {
    const repository = repositorySummary({ nameWithOwner: "acme/widgets" });
    const mapped = mapPullRequest(rawPullRequest({ number: 42 }), repository);

    expect(mapped).toMatchObject({
      number: 42,
      title: "Pull request 42",
      headSha: "sha-42",
      baseRefName: "main",
      headRefName: "feature/42",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      viewerCanMerge: true,
    });
    expect(mapped.author).toEqual({
      login: "octocat",
      url: "https://github.com/octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
    });
    expect(mapped.labels).toEqual([{ name: "enhancement", color: "a2eeef" }]);
    expect(mapped.checks.state).toBe("SUCCESS");
    expect(mapped.mergeability.canMerge).toBe(true);
  });

  it("marks read-only repositories as unmergeable", () => {
    const mapped = mapPullRequest(
      rawPullRequest(),
      repositorySummary({ viewerPermission: "READ" }),
    );

    expect(mapped.viewerCanMerge).toBe(false);
    expect(mapped.mergeability.label).toBe("No write access");
  });

  it("tolerates a pull request with no author and no labels", () => {
    const mapped = mapPullRequest(
      rawPullRequest({ author: null, labels: { nodes: null } }),
      repositorySummary(),
    );

    expect(mapped.author).toBeNull();
    expect(mapped.labels).toEqual([]);
  });
});
