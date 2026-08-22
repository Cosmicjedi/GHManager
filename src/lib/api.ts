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

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new ApiError(
      `Could not reach the GHManager server: ${(cause as Error).message}`,
      0,
    );
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
  return request<PullRequestsPayload>(`/api/pulls${query}`);
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
  });
}
