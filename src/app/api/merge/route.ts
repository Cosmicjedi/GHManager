import { NextResponse } from "next/server";
import { resolveToken } from "@/lib/auth";
import { GitHubClient } from "@/lib/github/client";
import { MAX_BULK_MERGE_ITEMS } from "@/lib/constants";
import { isMergeMethod, mergePullRequests } from "@/lib/github/merge";
import { invalidatePullRequestCache } from "@/lib/server/pullCache";
import type { MergePayload, MergeRequestItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface MergeErrorResponse {
  error: string;
  requiresAuth: boolean;
}

interface MergeRequestBody {
  items?: unknown;
  mergeMethod?: unknown;
  commitTitle?: unknown;
  commitMessage?: unknown;
}

export async function POST(
  request: Request,
): Promise<NextResponse<MergePayload | MergeErrorResponse>> {
  const { token } = resolveToken(request);

  if (!token) {
    return NextResponse.json<MergeErrorResponse>(
      {
        error: "Add a GitHub personal access token before merging.",
        requiresAuth: true,
      },
      { status: 401 },
    );
  }

  let body: MergeRequestBody;
  try {
    body = (await request.json()) as MergeRequestBody;
  } catch {
    return NextResponse.json<MergeErrorResponse>(
      { error: "Send a JSON body describing the pull requests to merge.", requiresAuth: false },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json<MergeErrorResponse>(
      { error: "Select at least one pull request to merge.", requiresAuth: false },
      { status: 400 },
    );
  }

  if (body.items.length > MAX_BULK_MERGE_ITEMS) {
    return NextResponse.json<MergeErrorResponse>(
      {
        error: `Merge at most ${MAX_BULK_MERGE_ITEMS} pull requests at a time. You selected ${body.items.length}.`,
        requiresAuth: false,
      },
      { status: 400 },
    );
  }

  const items: MergeRequestItem[] = [];
  for (const [index, candidate] of body.items.entries()) {
    const parsed = parseItem(candidate);
    if (!parsed) {
      return NextResponse.json<MergeErrorResponse>(
        {
          error: `Item ${index + 1} is missing an owner, repo or pull request number.`,
          requiresAuth: false,
        },
        { status: 400 },
      );
    }
    items.push(parsed);
  }

  if (body.mergeMethod !== undefined && !isMergeMethod(body.mergeMethod)) {
    return NextResponse.json<MergeErrorResponse>(
      { error: "mergeMethod must be one of merge, squash or rebase.", requiresAuth: false },
      { status: 400 },
    );
  }

  const client = new GitHubClient(token);
  const payload = await mergePullRequests(client, items, {
    mergeMethod: isMergeMethod(body.mergeMethod) ? body.mergeMethod : "merge",
    commitTitle: typeof body.commitTitle === "string" ? body.commitTitle : undefined,
    commitMessage: typeof body.commitMessage === "string" ? body.commitMessage : undefined,
  });

  // Whatever happened, the cached snapshot is now stale.
  invalidatePullRequestCache(token);

  return NextResponse.json<MergePayload>(payload);
}

function parseItem(candidate: unknown): MergeRequestItem | null {
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;

  const owner = typeof record.owner === "string" ? record.owner.trim() : "";
  const repo = typeof record.repo === "string" ? record.repo.trim() : "";
  const numberValue =
    typeof record.number === "number"
      ? record.number
      : typeof record.number === "string"
        ? Number.parseInt(record.number, 10)
        : Number.NaN;

  if (!owner || !repo || !Number.isInteger(numberValue) || numberValue <= 0) {
    return null;
  }

  const headSha = typeof record.headSha === "string" ? record.headSha.trim() : "";

  return {
    owner,
    repo,
    number: numberValue,
    ...(headSha ? { headSha } : {}),
  };
}
