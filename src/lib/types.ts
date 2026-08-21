/**
 * Shared domain types for GHManager.
 *
 * These types describe the normalised shape that flows from the GitHub client
 * through the API routes and into the React dashboard. The GraphQL responses
 * from GitHub are deliberately *not* passed through raw - everything is mapped
 * into these structures so the UI has a single stable contract.
 */

/** Aggregated state of the CI/CD check runs + commit statuses on a PR head. */
export type ChecksState =
  | "SUCCESS"
  | "FAILURE"
  | "ERROR"
  | "PENDING"
  | "EXPECTED"
  | "NONE";

/** Whether GitHub thinks the branch can be merged without conflicts. */
export type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

/**
 * GitHub's richer "why can't this merge" enum. Values we care about:
 * CLEAN / HAS_HOOKS -> good to go, BLOCKED -> required review or check missing,
 * BEHIND -> base branch moved on, DIRTY -> conflicts, UNSTABLE -> non-required
 * checks failing (still mergeable), DRAFT -> still a draft.
 */
export type MergeStateStatus =
  | "BEHIND"
  | "BLOCKED"
  | "CLEAN"
  | "DIRTY"
  | "DRAFT"
  | "HAS_HOOKS"
  | "UNKNOWN"
  | "UNSTABLE";

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

/** Repository permission level the authenticated viewer holds. */
export type RepositoryPermission =
  | "ADMIN"
  | "MAINTAIN"
  | "WRITE"
  | "TRIAGE"
  | "READ";

export type MergeMethod = "merge" | "squash" | "rebase";

export interface Actor {
  login: string;
  avatarUrl: string | null;
  url: string | null;
}

export interface RepositorySummary {
  /** e.g. "octocat/hello-world" */
  nameWithOwner: string;
  owner: string;
  name: string;
  url: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  defaultBranch: string | null;
  viewerPermission: RepositoryPermission | null;
  /** Merge methods the repository settings currently allow. */
  allowedMergeMethods: MergeMethod[];
  openPullRequestCount: number;
}

export interface ChecksSummary {
  state: ChecksState;
  total: number;
  success: number;
  failure: number;
  pending: number;
  skipped: number;
}

export interface Label {
  name: string;
  color: string;
}

export interface PullRequest {
  /** GraphQL node id - stable, used as the React key and selection key. */
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  author: Actor | null;
  repository: RepositorySummary;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  mergeable: MergeableState;
  mergeStateStatus: MergeStateStatus;
  reviewDecision: ReviewDecision | null;
  checks: ChecksSummary;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: Label[];
  /** True when the viewer's permission level allows writing to the base repo. */
  viewerCanMerge: boolean;
  /**
   * Best-effort local verdict on whether a merge attempt is worth making.
   * The authoritative answer always comes from the merge API call itself.
   */
  mergeability: MergeabilityVerdict;
}

export interface MergeabilityVerdict {
  /** Ready to merge right now with no expected obstacle. */
  canMerge: boolean;
  /** Short human label, e.g. "Ready", "Conflicts", "Checks failing". */
  label: string;
  /** Longer explanation shown in a tooltip. */
  reason: string;
  tone: "positive" | "negative" | "warning" | "neutral";
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  cost: number;
  /** ISO timestamp for when the current window resets. */
  resetAt: string;
  /** Cumulative point cost of every GraphQL request in this fetch. */
  usedThisRequest: number;
}

export interface Viewer {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  url: string;
}

export type TokenSource = "cookie" | "env" | "none";

export interface AuthStatus {
  authenticated: boolean;
  source: TokenSource;
  viewer: Viewer | null;
  /** OAuth scopes reported by GitHub for a classic PAT (empty for fine-grained). */
  scopes: string[];
  /** True when the token is provided by the server environment and the UI must not offer to sign out. */
  managedByServer: boolean;
}

export interface PullRequestsPayload {
  pullRequests: PullRequest[];
  repositoriesScanned: number;
  repositoriesWithOpenPullRequests: number;
  rateLimit: RateLimitInfo | null;
  fetchedAt: string;
  /** Non-fatal problems, e.g. a single repository that failed to load. */
  warnings: string[];
  /** True when the payload came from the short-lived server cache. */
  cached: boolean;
}

export interface MergeRequestItem {
  owner: string;
  repo: string;
  number: number;
  /**
   * Optional head SHA. When supplied GitHub refuses the merge if the branch
   * moved since the dashboard loaded, which prevents merging something you
   * never actually saw.
   */
  headSha?: string;
}

export interface MergeResult {
  owner: string;
  repo: string;
  number: number;
  status: "merged" | "failed";
  /** Human readable outcome, always populated. */
  message: string;
  /** Commit SHA produced by the merge, when it succeeded. */
  sha: string | null;
  /** Machine readable failure reason, when it failed. */
  errorCode: MergeErrorCode | null;
  httpStatus: number | null;
}

export type MergeErrorCode =
  | "NOT_MERGEABLE"
  | "HEAD_CHANGED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "METHOD_NOT_ALLOWED"
  | "NETWORK"
  | "UNKNOWN";

export interface MergePayload {
  results: MergeResult[];
  mergedCount: number;
  failedCount: number;
}
