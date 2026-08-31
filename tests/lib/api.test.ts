import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getPullRequests } from "@/lib/api";
import type { PullRequest, PullsStreamLine } from "@/lib/types";
import { pullRequest, resetFactories } from "~tests/factories";
import { pullsPayload } from "~tests/server";

function ndjsonResponse(lines: PullsStreamLine[]): Response {
  const body = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

function progressLine(
  pullRequests: PullRequest[],
  repositoriesScanned: number,
): PullsStreamLine {
  return {
    kind: "progress",
    pullRequests,
    repositoriesScanned,
    repositoriesWithOpenPullRequests: pullRequests.length,
    rateLimit: null,
    fetchedAt: "2026-08-31T00:00:00Z",
    warnings: [],
  };
}

beforeEach(() => {
  resetFactories();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPullRequests streaming", () => {
  it("assembles progress lines into a growing partial payload", async () => {
    const older = pullRequest({ id: "pr-1", number: 1, updatedAt: "2026-08-20T00:00:00Z" });
    const newer = pullRequest({ id: "pr-2", number: 2, updatedAt: "2026-08-21T00:00:00Z" });
    const finalPayload = pullsPayload([newer, older]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse([
          progressLine([older], 5),
          progressLine([newer], 10),
          { kind: "complete", payload: finalPayload },
        ]),
      ),
    );

    const partials: Array<{ count: number; scanned: number; first: string }> = [];
    const result = await getPullRequests({
      onProgress: (partial) =>
        partials.push({
          count: partial.pullRequests.length,
          scanned: partial.repositoriesScanned,
          first: partial.pullRequests[0].id,
        }),
    });

    expect(partials).toEqual([
      { count: 1, scanned: 5, first: "pr-1" },
      // Partials accumulate and stay sorted by most recent activity.
      { count: 2, scanned: 10, first: "pr-2" },
    ]);
    expect(result).toEqual(finalPayload);
  });

  it("asks the server to bypass its cache when refreshing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return ndjsonResponse([{ kind: "complete", payload: pullsPayload([]) }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await getPullRequests({ refresh: true });

    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl).toContain("refresh=1");
    expect(requestedUrl).toContain("stream=1");
  });

  it("throws an ApiError carrying the status from a streamed error line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse([
          {
            kind: "error",
            error: "GitHub rejected the token.",
            code: "UNAUTHORIZED",
            status: 401,
            requiresAuth: true,
          },
        ]),
      ),
    );

    const attempt = getPullRequests();
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({
      status: 401,
      requiresAuth: true,
      message: "GitHub rejected the token.",
    });
  });

  it("accepts a plain JSON payload from a non-streaming answer", async () => {
    const payload = pullsPayload([pullRequest({ id: "pr-1", number: 1 })]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(getPullRequests()).resolves.toEqual(payload);
  });

  it("maps a JSON error response to an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Add a token first.", requiresAuth: true }),
            { status: 401, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(getPullRequests()).rejects.toMatchObject({
      status: 401,
      requiresAuth: true,
      message: "Add a token first.",
    });
  });

  it("rejects when the stream ends without a complete line", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjsonResponse([progressLine([], 1)])));

    await expect(getPullRequests()).rejects.toThrow(/ended before it finished/);
  });
});
