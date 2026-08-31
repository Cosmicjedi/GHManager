import type {
  AuthStatus,
  MergeMethod,
  MergePayload,
  MergeRequestItem,
  PullRequest,
  PullRequestsPayload,
  PullsStreamLine,
  ServerTokensPayload,
} from "@/lib/types";

/** Error raised when a GHManager API route answers with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  readonly requiresAuth: boolean;

  constructor(message: string, status: number, requiresAuth = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requiresAuth = requiresAuth;
  }
}

export interface AuthResponse extends AuthStatus {
  error: string | null;
}

/**
 * Ceiling on how long a single API call may stay in flight. Without it a
 * connection that stalls (a laptop that slept, a proxy that dropped the
 * socket) leaves the UI waiting forever - which is what a "hung" merge dialog
 * looks like from the outside.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

class TimeoutError extends Error {}

/**
 * Reject after `timeoutMs`. The request itself is deliberately left running:
 * a merge that GitHub already accepted must not be cancelled halfway, and the
 * next refresh will show whatever actually happened.
 */
function rejectAfter(timeoutMs: number): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new TimeoutError(
            `The GHManager server did not answer within ${Math.round(timeoutMs / 1000)} seconds. It may still be working - refresh to see the current state.`,
          ),
        ),
      timeoutMs,
    );
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function request<T>(input: string, init?: RequestOptions): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {};
  const timeout = rejectAfter(timeoutMs);

  let response: Response;
  try {
    response = await Promise.race([
      fetch(input, {
        ...fetchInit,
        headers: {
          Accept: "application/json",
          ...(fetchInit.body ? { "Content-Type": "application/json" } : {}),
          ...fetchInit.headers,
        },
        credentials: "same-origin",
      }),
      timeout.promise,
    ]);
  } catch (cause) {
    if (cause instanceof TimeoutError) throw new ApiError(cause.message, 0);
    throw new ApiError(
      `Could not reach the GHManager server: ${(cause as Error).message}`,
      0,
    );
  } finally {
    timeout.cancel();
  }

  return parseJsonResponse<T>(response);
}

/** Parse a non-streaming API response, mapping error bodies to ApiError. */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const record = (body ?? {}) as Record<string, unknown>;
    const message =
      (typeof record.error === "string" && record.error) ||
      (typeof body === "string" && body) ||
      `Request failed with status ${response.status}.`;
    throw new ApiError(message, response.status, record.requiresAuth === true);
  }

  return body as T;
}

/** Read the current authentication status. */
export function getAuthStatus(): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth");
}

/** Store a personal access token in the httpOnly session cookie. */
export function signIn(token: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/** Forget the stored token. */
export function signOut(): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth", { method: "DELETE" });
}

/**
 * How long the pull request stream may go silent before it is declared dead.
 * A healthy scan produces a line every few seconds; the server times out its
 * own GitHub calls at 30 seconds, so a minute of nothing means the connection
 * is gone.
 */
const PULLS_STALL_TIMEOUT_MS = 60_000;

/**
 * Load every open pull request the token can see.
 *
 * The server streams results as it finds them; `onProgress` fires with a
 * growing partial payload so the caller can render rows before the full scan
 * finishes. A plain JSON response (e.g. from the short-lived cache path or a
 * non-streaming server) is handled transparently.
 */
export async function getPullRequests(
  options: {
    refresh?: boolean;
    onProgress?: (partial: PullRequestsPayload) => void;
  } = {},
): Promise<PullRequestsPayload> {
  const params = new URLSearchParams({ stream: "1" });
  if (options.refresh) params.set("refresh", "1");

  let response: Response;
  try {
    response = await fetch(`/api/pulls?${params.toString()}`, {
      headers: { Accept: "application/x-ndjson, application/json" },
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new ApiError(
      `Could not reach the GHManager server: ${(cause as Error).message}`,
      0,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/x-ndjson") || !response.body) {
    return parseJsonResponse<PullRequestsPayload>(response);
  }

  return readPullsStream(response.body, options.onProgress);
}

/** Consume the NDJSON pull request stream, surfacing partials along the way. */
async function readPullsStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (partial: PullRequestsPayload) => void,
): Promise<PullRequestsPayload> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const byId = new Map<string, PullRequest>();
  let buffered = "";

  const handleLine = (line: string): PullRequestsPayload | null => {
    if (!line.trim()) return null;

    let parsed: PullsStreamLine;
    try {
      parsed = JSON.parse(line) as PullsStreamLine;
    } catch {
      throw new ApiError("The GHManager server sent an unreadable response.", 0);
    }

    if (parsed.kind === "complete") return parsed.payload;
    if (parsed.kind === "error") {
      throw new ApiError(parsed.error, parsed.status, parsed.requiresAuth);
    }

    for (const pullRequest of parsed.pullRequests) byId.set(pullRequest.id, pullRequest);
    onProgress?.({
      pullRequests: [...byId.values()].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      ),
      repositoriesScanned: parsed.repositoriesScanned,
      repositoriesWithOpenPullRequests: parsed.repositoriesWithOpenPullRequests,
      rateLimit: parsed.rateLimit,
      fetchedAt: parsed.fetchedAt,
      warnings: parsed.warnings,
      cached: false,
    });
    return null;
  };

  try {
    for (;;) {
      const timeout = rejectAfter(PULLS_STALL_TIMEOUT_MS);
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await Promise.race([reader.read(), timeout.promise]);
      } catch (cause) {
        if (cause instanceof TimeoutError) {
          throw new ApiError(
            "The GHManager server stopped answering while loading pull requests. Refresh to try again.",
            0,
          );
        }
        throw cause instanceof ApiError
          ? cause
          : new ApiError(
              `Could not read the pull request stream: ${(cause as Error).message}`,
              0,
            );
      } finally {
        timeout.cancel();
      }

      buffered += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });

      let newlineIndex: number;
      while ((newlineIndex = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newlineIndex);
        buffered = buffered.slice(newlineIndex + 1);
        const complete = handleLine(line);
        if (complete) return complete;
      }

      if (chunk.done) break;
    }

    // A final line without a trailing newline still counts.
    const complete = handleLine(buffered);
    if (complete) return complete;

    throw new ApiError("The pull request stream ended before it finished.", 0);
  } finally {
    reader.cancel().catch(() => {
      // The stream is already done or errored; nothing to clean up.
    });
  }
}

/** List the tokens stored on the server (metadata only). */
export function getServerTokens(): Promise<ServerTokensPayload> {
  return request<ServerTokensPayload>("/api/tokens");
}

/** Add a server token; the server validates it against GitHub first. */
export function addServerToken(input: {
  token: string;
  label?: string;
  makeActive?: boolean;
}): Promise<ServerTokensPayload> {
  return request<ServerTokensPayload>("/api/tokens", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Make a stored token the one that drives the dashboard. */
export function activateServerToken(id: string): Promise<ServerTokensPayload> {
  return request<ServerTokensPayload>("/api/tokens", {
    method: "PATCH",
    body: JSON.stringify({ id, active: true }),
  });
}

/** Rename a stored token. */
export function relabelServerToken(id: string, label: string): Promise<ServerTokensPayload> {
  return request<ServerTokensPayload>("/api/tokens", {
    method: "PATCH",
    body: JSON.stringify({ id, label }),
  });
}

/** Remove a stored token. */
export function removeServerToken(id: string): Promise<ServerTokensPayload> {
  return request<ServerTokensPayload>(`/api/tokens?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface MergeRequestPayload {
  items: MergeRequestItem[];
  mergeMethod: MergeMethod;
  commitTitle?: string;
  commitMessage?: string;
}

/** Merge one or many pull requests. */
export function mergePullRequests(payload: MergeRequestPayload): Promise<MergePayload> {
  return request<MergePayload>("/api/merge", {
    method: "POST",
    body: JSON.stringify(payload),
    // A bulk merge runs three at a time server side, so allow for a long queue.
    timeoutMs: 180_000,
  });
}
