import type { RawPullRequest, RawRepository } from "@/lib/github/raw";
import type {
  ChecksState,
  ChecksSummary,
  MergeMethod,
  MergeStateStatus,
  MergeabilityVerdict,
  MergeableState,
  PullRequest,
  RepositoryPermission,
  RepositorySummary,
  ReviewDecision,
} from "@/lib/types";

const PERMISSIONS: RepositoryPermission[] = [
  "ADMIN",
  "MAINTAIN",
  "WRITE",
  "TRIAGE",
  "READ",
];

/** Permission levels that allow pushing to (and therefore merging into) a repo. */
const WRITE_PERMISSIONS = new Set<RepositoryPermission>(["ADMIN", "MAINTAIN", "WRITE"]);

const MERGE_STATE_STATUSES: MergeStateStatus[] = [
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
];

const CHECK_FAILURE_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
  "STALE",
]);

const CHECK_SKIPPED_CONCLUSIONS = new Set(["SKIPPED", "NEUTRAL"]);

export function toRepositoryPermission(
  value: string | null | undefined,
): RepositoryPermission | null {
  if (!value) return null;
  const upper = value.toUpperCase() as RepositoryPermission;
  return PERMISSIONS.includes(upper) ? upper : null;
}

export function toMergeStateStatus(value: string | null | undefined): MergeStateStatus {
  if (!value) return "UNKNOWN";
  const upper = value.toUpperCase() as MergeStateStatus;
  return MERGE_STATE_STATUSES.includes(upper) ? upper : "UNKNOWN";
}

export function toMergeableState(value: string | null | undefined): MergeableState {
  const upper = (value ?? "UNKNOWN").toUpperCase();
  if (upper === "MERGEABLE" || upper === "CONFLICTING") return upper;
  return "UNKNOWN";
}

export function toReviewDecision(value: string | null | undefined): ReviewDecision | null {
  const upper = (value ?? "").toUpperCase();
  if (
    upper === "APPROVED" ||
    upper === "CHANGES_REQUESTED" ||
    upper === "REVIEW_REQUIRED"
  ) {
    return upper;
  }
  return null;
}

export function allowedMergeMethods(repository: RawRepository): MergeMethod[] {
  const methods: MergeMethod[] = [];
  // A null flag means the field was not requested by this query; assume the
  // method is allowed so the UI does not needlessly disable a valid option.
  if (repository.mergeCommitAllowed !== false) methods.push("merge");
  if (repository.squashMergeAllowed !== false) methods.push("squash");
  if (repository.rebaseMergeAllowed !== false) methods.push("rebase");
  return methods;
}

export function mapRepository(repository: RawRepository): RepositorySummary {
  const [ownerFromPath] = repository.nameWithOwner.split("/");
  return {
    nameWithOwner: repository.nameWithOwner,
    owner: repository.owner?.login ?? ownerFromPath,
    name: repository.name,
    url: repository.url,
    isPrivate: Boolean(repository.isPrivate),
    isFork: Boolean(repository.isFork),
    isArchived: Boolean(repository.isArchived),
    defaultBranch: repository.defaultBranchRef?.name ?? null,
    viewerPermission: toRepositoryPermission(repository.viewerPermission),
    allowedMergeMethods: allowedMergeMethods(repository),
    openPullRequestCount: repository.pullRequests?.totalCount ?? 0,
  };
}

/** Roll the individual check runs and commit statuses up into one summary. */
export function summariseChecks(pullRequest: RawPullRequest): ChecksSummary {
  const commit = pullRequest.commits?.nodes?.[0]?.commit ?? null;
  const rollup = commit?.statusCheckRollup ?? null;

  const summary: ChecksSummary = {
    state: "NONE",
    total: 0,
    success: 0,
    failure: 0,
    pending: 0,
    skipped: 0,
  };

  if (!rollup) return summary;

  const contexts = (rollup.contexts?.nodes ?? []).filter(
    (node): node is NonNullable<typeof node> => Boolean(node),
  );

  summary.total = rollup.contexts?.totalCount ?? contexts.length;

  for (const context of contexts) {
    if (context.__typename === "CheckRun") {
      const conclusion = (context.conclusion ?? "").toUpperCase();
      const status = (context.status ?? "").toUpperCase();
      if (!conclusion) {
        if (status === "COMPLETED") summary.skipped += 1;
        else summary.pending += 1;
      } else if (conclusion === "SUCCESS") {
        summary.success += 1;
      } else if (CHECK_SKIPPED_CONCLUSIONS.has(conclusion)) {
        summary.skipped += 1;
      } else if (CHECK_FAILURE_CONCLUSIONS.has(conclusion)) {
        summary.failure += 1;
      } else {
        summary.pending += 1;
      }
      continue;
    }

    const state = (context.state ?? "").toUpperCase();
    if (state === "SUCCESS") summary.success += 1;
    else if (state === "FAILURE" || state === "ERROR") summary.failure += 1;
    else if (state === "PENDING" || state === "EXPECTED") summary.pending += 1;
    else summary.skipped += 1;
  }

  summary.state = normaliseRollupState(rollup.state, summary);
  return summary;
}

function normaliseRollupState(state: string | null, summary: ChecksSummary): ChecksState {
  const upper = (state ?? "").toUpperCase();
  if (
    upper === "SUCCESS" ||
    upper === "FAILURE" ||
    upper === "ERROR" ||
    upper === "PENDING" ||
    upper === "EXPECTED"
  ) {
    return upper as ChecksState;
  }
  if (summary.failure > 0) return "FAILURE";
  if (summary.pending > 0) return "PENDING";
  if (summary.success > 0) return "SUCCESS";
  return "NONE";
}

/**
 * Decide whether a merge attempt is worth making, and produce the label shown
 * in the Mergeability column. The merge endpoint stays the source of truth;
 * this exists so the dashboard can grey out hopeless rows up front.
 */
export function computeMergeability(input: {
  isDraft: boolean;
  mergeable: MergeableState;
  mergeStateStatus: MergeStateStatus;
  reviewDecision: ReviewDecision | null;
  checks: ChecksSummary;
  viewerCanMerge: boolean;
  isArchived: boolean;
}): MergeabilityVerdict {
  if (input.isArchived) {
    return {
      canMerge: false,
      label: "Archived",
      reason: "The repository is archived and is read-only.",
      tone: "neutral",
    };
  }

  if (!input.viewerCanMerge) {
    return {
      canMerge: false,
      label: "No write access",
      reason:
        "Your token does not grant write access to this repository, so it cannot merge here.",
      tone: "neutral",
    };
  }

  if (input.isDraft || input.mergeStateStatus === "DRAFT") {
    return {
      canMerge: false,
      label: "Draft",
      reason:
        "This pull request is still a draft. Mark it ready for review before merging.",
      tone: "neutral",
    };
  }

  if (input.mergeable === "CONFLICTING" || input.mergeStateStatus === "DIRTY") {
    return {
      canMerge: false,
      label: "Conflicts",
      reason:
        "The head branch conflicts with the base branch. Resolve the conflicts on GitHub first.",
      tone: "negative",
    };
  }

  if (input.mergeStateStatus === "BLOCKED") {
    const reasons: string[] = [];
    if (input.reviewDecision === "CHANGES_REQUESTED") reasons.push("changes were requested");
    if (input.reviewDecision === "REVIEW_REQUIRED") reasons.push("a required review is missing");
    if (input.checks.failure > 0) reasons.push(`${input.checks.failure} check(s) failed`);
    if (input.checks.pending > 0) reasons.push(`${input.checks.pending} check(s) still running`);
    return {
      canMerge: false,
      label: "Blocked",
      reason: reasons.length
        ? `Branch protection is blocking this merge: ${reasons.join(", ")}.`
        : "Branch protection is blocking this merge.",
      tone: "negative",
    };
  }

  if (input.mergeStateStatus === "BEHIND") {
    return {
      canMerge: false,
      label: "Behind base",
      reason:
        "The head branch is out of date with the base branch and this repository requires branches to be up to date. Update the branch before merging.",
      tone: "warning",
    };
  }

  if (input.mergeStateStatus === "UNSTABLE") {
    return {
      canMerge: true,
      label: "Mergeable, checks red",
      reason:
        "Some checks are failing or still running, but branch protection still allows the merge.",
      tone: "warning",
    };
  }

  if (input.mergeStateStatus === "UNKNOWN") {
    if (input.mergeable === "MERGEABLE" && input.checks.state === "PENDING") {
      return {
        canMerge: false,
        label: "Checks running",
        reason: "Checks are still running for the head commit.",
        tone: "warning",
      };
    }
    if (input.mergeable === "MERGEABLE") {
      return {
        canMerge: true,
        label: "Ready",
        reason: "No conflicts reported and nothing is blocking the merge.",
        tone: "positive",
      };
    }
    return {
      canMerge: false,
      label: "Checking",
      reason:
        "GitHub is still computing the merge status for this pull request. Refresh in a moment.",
      tone: "neutral",
    };
  }

  if (input.mergeable === "MERGEABLE") {
    return {
      canMerge: true,
      label: "Ready",
      reason: "No conflicts and nothing is blocking the merge.",
      tone: "positive",
    };
  }

  return {
    canMerge: false,
    label: "Checking",
    reason:
      "GitHub has not reported a definitive merge status yet. Refresh in a moment.",
    tone: "neutral",
  };
}

export function mapPullRequest(
  pullRequest: RawPullRequest,
  repository: RepositorySummary,
): PullRequest {
  const checks = summariseChecks(pullRequest);
  const mergeable = toMergeableState(pullRequest.mergeable);
  const mergeStateStatus = toMergeStateStatus(pullRequest.mergeStateStatus);
  const reviewDecision = toReviewDecision(pullRequest.reviewDecision);
  const viewerCanMerge =
    repository.viewerPermission !== null &&
    WRITE_PERMISSIONS.has(repository.viewerPermission) &&
    !repository.isArchived;

  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    isDraft: Boolean(pullRequest.isDraft),
    createdAt: pullRequest.createdAt,
    updatedAt: pullRequest.updatedAt,
    author: pullRequest.author
      ? {
          login: pullRequest.author.login,
          avatarUrl: pullRequest.author.avatarUrl,
          url: pullRequest.author.url,
        }
      : null,
    repository,
    baseRefName: pullRequest.baseRefName,
    headRefName: pullRequest.headRefName,
    headSha: pullRequest.commits?.nodes?.[0]?.commit?.oid ?? "",
    mergeable,
    mergeStateStatus,
    reviewDecision,
    checks,
    additions: pullRequest.additions ?? 0,
    deletions: pullRequest.deletions ?? 0,
    changedFiles: pullRequest.changedFiles ?? 0,
    labels: (pullRequest.labels?.nodes ?? [])
      .filter((label): label is { name: string; color: string } => Boolean(label))
      .map((label) => ({ name: label.name, color: label.color })),
    viewerCanMerge,
    mergeability: computeMergeability({
      isDraft: Boolean(pullRequest.isDraft),
      mergeable,
      mergeStateStatus,
      reviewDecision,
      checks,
      viewerCanMerge,
      isArchived: repository.isArchived,
    }),
  };
}
