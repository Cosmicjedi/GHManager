import type { RawPullRequest, RawRepository } from "@/lib/github/raw";
import type { PullRequest, RepositorySummary } from "@/lib/types";

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_${sequence}`;
}

/** Reset the id counter so ids are deterministic inside a single test. */
export function resetFactories(): void {
  sequence = 0;
}

export function rawRepository(overrides: Partial<RawRepository> = {}): RawRepository {
  const nameWithOwner = overrides.nameWithOwner ?? "acme/widgets";
  const [owner, name] = nameWithOwner.split("/");

  return {
    id: nextId("R"),
    name,
    nameWithOwner,
    url: `https://github.com/${nameWithOwner}`,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    viewerPermission: "WRITE",
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
    owner: { login: owner },
    defaultBranchRef: { name: "main" },
    pullRequests: { totalCount: 1 },
    ...overrides,
  };
}

export function rawPullRequest(overrides: Partial<RawPullRequest> = {}): RawPullRequest {
  const number = overrides.number ?? 1;

  return {
    id: nextId("PR"),
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    isDraft: false,
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-10T09:00:00Z",
    baseRefName: "main",
    headRefName: `feature/${number}`,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    author: {
      login: "octocat",
      url: "https://github.com/octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
    },
    labels: { nodes: [{ name: "enhancement", color: "a2eeef" }] },
    commits: {
      nodes: [
        {
          commit: {
            oid: `sha-${number}`,
            statusCheckRollup: {
              state: "SUCCESS",
              contexts: {
                totalCount: 1,
                nodes: [
                  { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
                ],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

export function repositorySummary(
  overrides: Partial<RepositorySummary> = {},
): RepositorySummary {
  const nameWithOwner = overrides.nameWithOwner ?? "acme/widgets";
  const [owner, name] = nameWithOwner.split("/");

  return {
    nameWithOwner,
    owner,
    name,
    url: `https://github.com/${nameWithOwner}`,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    defaultBranch: "main",
    viewerPermission: "WRITE",
    allowedMergeMethods: ["merge", "squash", "rebase"],
    openPullRequestCount: 1,
    ...overrides,
  };
}

/** A fully-formed domain pull request, ready to hand to a component. */
export function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  const number = overrides.number ?? 1;
  const repository = overrides.repository ?? repositorySummary();

  return {
    id: overrides.id ?? nextId("PR"),
    number,
    title: `Pull request ${number}`,
    url: `${repository.url}/pull/${number}`,
    isDraft: false,
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: "2026-08-10T09:00:00Z",
    author: {
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      url: "https://github.com/octocat",
    },
    repository,
    baseRefName: "main",
    headRefName: `feature/${number}`,
    headSha: `sha-${number}`,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    checks: { state: "SUCCESS", total: 2, success: 2, failure: 0, pending: 0, skipped: 0 },
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    labels: [{ name: "enhancement", color: "a2eeef" }],
    viewerCanMerge: true,
    mergeability: {
      canMerge: true,
      label: "Ready",
      reason: "No conflicts and nothing is blocking the merge.",
      tone: "positive",
    },
    ...overrides,
  };
}

/** A pull request that the dashboard must refuse to select. */
export function conflictingPullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return pullRequest({
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    checks: { state: "FAILURE", total: 2, success: 1, failure: 1, pending: 0, skipped: 0 },
    mergeability: {
      canMerge: false,
      label: "Conflicts",
      reason:
        "The head branch conflicts with the base branch. Resolve the conflicts on GitHub first.",
      tone: "negative",
    },
    ...overrides,
  });
}
