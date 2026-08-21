import { mapWithConcurrency } from "@/lib/concurrency";
import type { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import type {
  MergeErrorCode,
  MergeMethod,
  MergePayload,
  MergeRequestItem,
  MergeResult,
} from "@/lib/types";

export interface MergeOptions {
  mergeMethod?: MergeMethod;
  commitTitle?: string;
  commitMessage?: string;
  /** How many merges may run at once during a bulk operation. */
  concurrency?: number;
}

interface RestMergeResponse {
  sha?: string;
  merged?: boolean;
  message?: string;
}

export const MERGE_METHODS: MergeMethod[] = ["merge", "squash", "rebase"];

export function isMergeMethod(value: unknown): value is MergeMethod {
  return typeof value === "string" && (MERGE_METHODS as string[]).includes(value);
}

/**
 * Merge a single pull request.
 *
 * Never throws for an expected GitHub refusal - the failure is returned as a
 * result so a bulk run can continue and report every outcome together.
 */
export async function mergePullRequest(
  client: GitHubClient,
  item: MergeRequestItem,
  options: MergeOptions = {},
): Promise<MergeResult> {
  const base: Omit<MergeResult, "status" | "message" | "sha" | "errorCode" | "httpStatus"> = {
    owner: item.owner,
    repo: item.repo,
    number: item.number,
  };

  const validationError = validateItem(item);
  if (validationError) {
    return {
      ...base,
      status: "failed",
      message: validationError,
      sha: null,
      errorCode: "VALIDATION",
      httpStatus: null,
    };
  }

  const body: Record<string, unknown> = {
    merge_method: options.mergeMethod ?? "merge",
  };
  if (item.headSha) body.sha = item.headSha;
  if (options.commitTitle) body.commit_title = options.commitTitle;
  if (options.commitMessage) body.commit_message = options.commitMessage;

  try {
    const { data } = await client.rest<RestMergeResponse>(
      `/repos/${encodeURIComponent(item.owner)}/${encodeURIComponent(item.repo)}/pulls/${item.number}/merge`,
      { method: "PUT", body },
    );

    if (data?.merged === false) {
      return {
        ...base,
        status: "failed",
        message: data.message?.trim() || "GitHub reported the pull request was not merged.",
        sha: null,
        errorCode: "NOT_MERGEABLE",
        httpStatus: 200,
      };
    }

    return {
      ...base,
      status: "merged",
      message: data?.message?.trim() || "Pull request successfully merged.",
      sha: data?.sha ?? null,
      errorCode: null,
      httpStatus: 200,
    };
  } catch (error) {
    return toFailure(base, error);
  }
}

/** Merge many pull requests, reporting a result for every input in order. */
export async function mergePullRequests(
  client: GitHubClient,
  items: readonly MergeRequestItem[],
  options: MergeOptions = {},
): Promise<MergePayload> {
  const results = await mapWithConcurrency(items, options.concurrency ?? 3, (item) =>
    mergePullRequest(client, item, options),
  );

  return {
    results,
    mergedCount: results.filter((result) => result.status === "merged").length,
    failedCount: results.filter((result) => result.status === "failed").length,
  };
}

function validateItem(item: MergeRequestItem): string | null {
  if (!item.owner || typeof item.owner !== "string") {
    return "A repository owner is required.";
  }
  if (!item.repo || typeof item.repo !== "string") {
    return "A repository name is required.";
  }
  if (!Number.isInteger(item.number) || item.number <= 0) {
    return "A positive pull request number is required.";
  }
  return null;
}

function toFailure(
  base: { owner: string; repo: string; number: number },
  error: unknown,
): MergeResult {
  if (!(error instanceof GitHubError)) {
    return {
      ...base,
      status: "failed",
      message:
        error instanceof Error
          ? `Unexpected error: ${error.message}`
          : "An unexpected error occurred while merging.",
      sha: null,
      errorCode: "UNKNOWN",
      httpStatus: null,
    };
  }

  const { code, message } = explain(error);
  return {
    ...base,
    status: "failed",
    message,
    sha: null,
    errorCode: code,
    httpStatus: error.status,
  };
}

/** Translate a GitHub refusal into something a human can act on. */
export function explain(error: GitHubError): { code: MergeErrorCode; message: string } {
  const raw = error.message.trim();
  const lower = raw.toLowerCase();

  switch (error.status) {
    case 401:
      return {
        code: "UNAUTHORIZED",
        message: "Your GitHub token was rejected. Sign in again with a valid token.",
      };
    case 403:
      if (lower.includes("rate limit")) {
        return {
          code: "RATE_LIMITED",
          message: "GitHub rate limit reached. Wait for the limit to reset and try again.",
        };
      }
      return {
        code: "FORBIDDEN",
        message: `You are not allowed to merge this pull request: ${raw}`,
      };
    case 404:
      return {
        code: "NOT_FOUND",
        message:
          "Pull request not found. It may already be merged or closed, or your token may not have access to the repository.",
      };
    case 405:
      return {
        code: "NOT_MERGEABLE",
        message: `GitHub refused the merge: ${raw} This usually means required reviews or status checks have not passed.`,
      };
    case 409:
      if (lower.includes("head branch was modified")) {
        return {
          code: "HEAD_CHANGED",
          message:
            "The head branch changed after the dashboard loaded, so the merge was cancelled. Refresh and try again.",
        };
      }
      return {
        code: "CONFLICT",
        message: `Merge conflict: ${raw}`,
      };
    case 422:
      return {
        code: "VALIDATION",
        message: `GitHub rejected the merge request: ${raw}${
          lower.includes("merge method")
            ? " Choose a merge method this repository allows."
            : ""
        }`,
      };
    case 429:
      return {
        code: "RATE_LIMITED",
        message: "GitHub rate limit reached. Wait for the limit to reset and try again.",
      };
    case 0:
      return {
        code: "NETWORK",
        message: `Could not reach GitHub: ${raw}`,
      };
    default:
      return {
        code: error.code,
        message: raw || `GitHub responded with status ${error.status}.`,
      };
  }
}
