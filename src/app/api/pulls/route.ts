import { NextResponse } from "next/server";
import { resolveToken } from "@/lib/auth";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { fetchAllOpenPullRequests } from "@/lib/github/pulls";
import {
  invalidatePullRequestCache,
  readPullRequestCache,
  writePullRequestCache,
} from "@/lib/server/pullCache";
import type { PullRequestsPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface PullsErrorResponse {
  error: string;
  code: string;
  /** True when the client should send the user back to the token screen. */
  requiresAuth: boolean;
}

export async function GET(
  request: Request,
): Promise<NextResponse<PullRequestsPayload | PullsErrorResponse>> {
  const { token } = resolveToken(request);

  if (!token) {
    return NextResponse.json<PullsErrorResponse>(
      {
        error: "Add a GitHub personal access token to load pull requests.",
        code: "UNAUTHORIZED",
        requiresAuth: true,
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const refreshParam = url.searchParams.get("refresh");
  const forceRefresh = refreshParam === "1" || refreshParam === "true";

  if (!forceRefresh) {
    const cached = readPullRequestCache(token);
    if (cached) {
      return NextResponse.json<PullRequestsPayload>({ ...cached, cached: true });
    }
  }

  try {
    const client = new GitHubClient(token);
    const payload = await fetchAllOpenPullRequests(client);
    writePullRequestCache(token, payload);
    return NextResponse.json<PullRequestsPayload>({ ...payload, cached: false });
  } catch (error) {
    if (error instanceof GitHubError) {
      const requiresAuth = error.status === 401;
      if (requiresAuth) invalidatePullRequestCache(token);
      return NextResponse.json<PullsErrorResponse>(
        {
          error: requiresAuth
            ? "GitHub rejected the token. Sign in again with a valid personal access token."
            : error.message,
          code: error.code,
          requiresAuth,
        },
        { status: error.status >= 400 ? error.status : 502 },
      );
    }

    return NextResponse.json<PullsErrorResponse>(
      {
        error:
          error instanceof Error
            ? `Failed to load pull requests: ${error.message}`
            : "Failed to load pull requests.",
        code: "UNKNOWN",
        requiresAuth: false,
      },
      { status: 500 },
    );
  }
}
