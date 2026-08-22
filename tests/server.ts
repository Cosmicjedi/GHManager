import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import type { AuthStatus, MergePayload, PullRequest, PullRequestsPayload } from "@/lib/types";

/** MSW server intercepting GHManager's own API routes for component tests. */
export const server = setupServer();

const ORIGIN = "http://localhost:3000";

export const signedOutAuth: AuthStatus & { error: string | null } = {
  authenticated: false,
  source: "none",
  viewer: null,
  scopes: [],
  managedByServer: false,
  error: null,
};

export const signedInAuth: AuthStatus & { error: string | null } = {
  authenticated: true,
  source: "cookie",
  viewer: {
    login: "octocat",
    name: "The Octocat",
    avatarUrl: null,
    url: "https://github.com/octocat",
  },
  scopes: ["repo"],
  managedByServer: false,
  error: null,
};

export function pullsPayload(
  pullRequests: PullRequest[],
  overrides: Partial<PullRequestsPayload> = {},
): PullRequestsPayload {
  return {
    pullRequests,
    repositoriesScanned: 12,
    repositoriesWithOpenPullRequests: new Set(
      pullRequests.map((pullRequest) => pullRequest.repository.nameWithOwner),
    ).size,
    rateLimit: {
      limit: 5000,
      remaining: 4900,
      cost: 3,
      resetAt: "2026-08-21T13:00:00Z",
      usedThisRequest: 3,
    },
    fetchedAt: "2026-08-21T12:00:00Z",
    warnings: [],
    cached: false,
    ...overrides,
  };
}

/** Serve a fixed auth status from GET /api/auth. */
export function useAuthStatus(status: AuthStatus & { error: string | null }): void {
  server.use(http.get(`${ORIGIN}/api/auth`, () => HttpResponse.json(status)));
}

/** Serve a fixed pull request payload from GET /api/pulls. */
export function usePulls(payload: PullRequestsPayload): void {
  server.use(http.get(`${ORIGIN}/api/pulls`, () => HttpResponse.json(payload)));
}

/** Serve an error from GET /api/pulls. */
export function usePullsError(status: number, error: string, requiresAuth = false): void {
  server.use(
    http.get(`${ORIGIN}/api/pulls`, () =>
      HttpResponse.json({ error, code: "UNKNOWN", requiresAuth }, { status }),
    ),
  );
}

/** Capture merge requests and answer with a caller-supplied payload. */
export function useMergeHandler(
  respond: (body: {
    items: Array<{ owner: string; repo: string; number: number; headSha?: string }>;
    mergeMethod: string;
  }) => MergePayload | { status: number; body: unknown },
): { calls: Array<{ items: unknown[]; mergeMethod: string }> } {
  const calls: Array<{ items: unknown[]; mergeMethod: string }> = [];

  server.use(
    http.post(`${ORIGIN}/api/merge`, async ({ request }) => {
      const body = (await request.json()) as {
        items: Array<{ owner: string; repo: string; number: number; headSha?: string }>;
        mergeMethod: string;
      };
      calls.push({ items: body.items, mergeMethod: body.mergeMethod });

      const result = respond(body);
      if (result && typeof result === "object" && "status" in result && "body" in result) {
        return HttpResponse.json(result.body as Record<string, unknown>, {
          status: result.status as number,
        });
      }
      return HttpResponse.json(result);
    }),
  );

  return { calls };
}

/** Build a MergePayload where every item succeeds. */
export function allMerged(
  items: Array<{ owner: string; repo: string; number: number }>,
): MergePayload {
  return {
    results: items.map((item) => ({
      ...item,
      status: "merged" as const,
      message: "Pull request successfully merged.",
      sha: `sha-${item.number}`,
      errorCode: null,
      httpStatus: 200,
    })),
    mergedCount: items.length,
    failedCount: 0,
  };
}
