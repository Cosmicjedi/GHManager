import type {
  AuthStatus,
  MergeMethod,
  MergePayload,
  MergeRequestItem,
  PullRequestsPayload,
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

/** Load every open pull request the token can see. */
export function getPullRequests(options: { refresh?: boolean } = {}): Promise<PullRequestsPayload> {
  const query = options.refresh ? "?refresh=1" : "";
  // Walking every repository on a large account is slow, so this one gets a
  // much longer leash than the default.
  return request<PullRequestsPayload>(`/api/pulls${query}`, { timeoutMs: 180_000 });
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
