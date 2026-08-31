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
import type { PullRequest, PullRequestsPayload, PullsStreamLine } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface PullsErrorResponse {
  error: string;
  code: string;
  /** True when the client should send the user back to the token screen. */
  requiresAuth: boolean;
}

/** Shape any scan failure the same way for the JSON and streaming paths. */
function shapeError(error: unknown): PullsErrorResponse & { status: number } {
  if (error instanceof GitHubError) {
    const requiresAuth = error.status === 401;
    return {
      error: requiresAuth
        ? "GitHub rejected the token. Sign in again with a valid personal access token."
        : error.message,
      code: error.code,
      requiresAuth,
      status: error.status >= 400 ? error.status : 502,
    };
  }

  return {
    error:
      error instanceof Error
        ? `Failed to load pull requests: ${error.message}`
        : "Failed to load pull requests.",
    code: "UNKNOWN",
    requiresAuth: false,
    status: 500,
  };
}

export async function GET(request: Request): Promise<Response> {
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
  const streaming = url.searchParams.get("stream") === "1";

  const cached = forceRefresh ? null : readPullRequestCache(token);

  if (streaming) {
    return streamPullRequests(token, cached);
  }

  if (cached) {
    return NextResponse.json<PullRequestsPayload>({ ...cached, cached: true });
  }

  try {
    const client = new GitHubClient(token);
    const payload = await fetchAllOpenPullRequests(client);
    writePullRequestCache(token, payload);
    return NextResponse.json<PullRequestsPayload>({ ...payload, cached: false });
  } catch (error) {
    const shaped = shapeError(error);
    if (shaped.requiresAuth) invalidatePullRequestCache(token);
    return NextResponse.json<PullsErrorResponse>(
      { error: shaped.error, code: shaped.code, requiresAuth: shaped.requiresAuth },
      { status: shaped.status },
    );
  }
}

/**
 * Answer as NDJSON, one `PullsStreamLine` per line, so the dashboard can show
 * pull requests while the scan is still walking the account. The HTTP status
 * is committed before the scan finishes, so failures travel as an `error`
 * line rather than a status code.
 */
function streamPullRequests(
  token: string,
  cached: Omit<PullRequestsPayload, "cached"> | null,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: PullsStreamLine) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));

      try {
        if (cached) {
          send({ kind: "complete", payload: { ...cached, cached: true } });
          return;
        }

        const client = new GitHubClient(token);
        // Progress snapshots are cumulative; only ship what the client has
        // not seen yet so the stream stays proportional to the data.
        const sentIds = new Set<string>();
        const payload = await fetchAllOpenPullRequests(client, {}, (snapshot) => {
          const added: PullRequest[] = [];
          for (const pullRequest of snapshot.pullRequests) {
            if (sentIds.has(pullRequest.id)) continue;
            sentIds.add(pullRequest.id);
            added.push(pullRequest);
          }
          send({
            kind: "progress",
            pullRequests: added,
            repositoriesScanned: snapshot.repositoriesScanned,
            repositoriesWithOpenPullRequests: snapshot.repositoriesWithOpenPullRequests,
            rateLimit: snapshot.rateLimit,
            fetchedAt: snapshot.fetchedAt,
            warnings: snapshot.warnings,
          });
        });

        writePullRequestCache(token, payload);
        send({ kind: "complete", payload: { ...payload, cached: false } });
      } catch (error) {
        const shaped = shapeError(error);
        if (shaped.requiresAuth) invalidatePullRequestCache(token);
        send({
          kind: "error",
          error: shaped.error,
          code: shaped.code,
          status: shaped.status,
          requiresAuth: shaped.requiresAuth,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Some reverse proxies buffer streamed responses unless told not to.
      "x-accel-buffering": "no",
    },
  });
}
