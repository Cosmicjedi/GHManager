import {
  GITHUB_API_BASE_URL,
  GITHUB_GRAPHQL_URL,
  GITHUB_REQUEST_TIMEOUT_MS,
  GRAPHQL_ACCEPT,
  USER_AGENT,
} from "@/lib/github/config";
import {
  GitHubError,
  classifyStatus,
  extractErrorDetails,
  extractErrorMessage,
} from "@/lib/github/errors";
import type { RateLimitInfo } from "@/lib/types";

export interface GraphQLResult<T> {
  data: T;
  rateLimit: RateLimitInfo | null;
}

interface GraphQLEnvelope<T> {
  data?: T;
  errors?: Array<{
    type?: string;
    message: string;
    path?: Array<string | number>;
  }>;
}

interface RawRateLimit {
  limit?: number;
  cost?: number;
  remaining?: number;
  resetAt?: string;
}

/**
 * Thin, dependency-free GitHub client. One instance is created per request
 * with the caller's token so tokens are never shared between users.
 */
export class GitHubClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  /** Points consumed by every GraphQL call made through this instance. */
  private pointsUsed = 0;
  private lastRateLimit: RateLimitInfo | null = null;

  constructor(token: string, fetchImpl: typeof fetch = fetch) {
    if (!token || !token.trim()) {
      throw new GitHubError("A GitHub personal access token is required.", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
    this.token = token.trim();
    this.fetchImpl = fetchImpl;
  }

  /** Most recent rate limit snapshot seen on a GraphQL response. */
  getRateLimit(): RateLimitInfo | null {
    if (!this.lastRateLimit) return null;
    return { ...this.lastRateLimit, usedThisRequest: this.pointsUsed };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
      ...extra,
    };
  }

  /** Execute a GraphQL document and return typed data. */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<GraphQLResult<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(GITHUB_GRAPHQL_URL, {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          Accept: GRAPHQL_ACCEPT,
        }),
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        signal: requestTimeoutSignal(),
      });
    } catch (cause) {
      throw toNetworkError(cause);
    }

    const body = await readBody(response);

    if (!response.ok) {
      throw new GitHubError(
        extractErrorMessage(body, `GitHub responded with ${response.status}.`),
        {
          status: response.status,
          code: classifyStatus(response.status),
          documentationUrl: documentationUrl(body),
          details: extractErrorDetails(body),
        },
      );
    }

    const envelope = (body ?? {}) as GraphQLEnvelope<T>;

    if (envelope.errors?.length) {
      // A GraphQL response can be partially successful. Only treat it as fatal
      // when there is no usable data at all; otherwise the caller decides.
      const messages = envelope.errors.map((error) => error.message);
      if (!envelope.data) {
        const rateLimited = envelope.errors.some(
          (error) => error.type === "RATE_LIMITED",
        );
        throw new GitHubError(messages.join(" - "), {
          status: rateLimited ? 429 : 502,
          code: rateLimited ? "RATE_LIMITED" : "UNKNOWN",
          details: messages,
        });
      }
    }

    if (!envelope.data) {
      throw new GitHubError("GitHub returned an empty GraphQL response.", {
        status: 502,
      });
    }

    this.recordRateLimit(envelope.data as { rateLimit?: RawRateLimit });

    return { data: envelope.data, rateLimit: this.getRateLimit() };
  }

  /**
   * Execute a REST request. Returns the parsed body plus the raw response so
   * callers can read headers such as `x-oauth-scopes`.
   */
  async rest<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      accept?: string;
      /** When true a 404 resolves to `null` instead of throwing. */
      allowNotFound?: boolean;
    } = {},
  ): Promise<{ data: T | null; response: Response }> {
    const url = path.startsWith("http")
      ? path
      : `${GITHUB_API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers: this.headers({
          Accept: init.accept ?? "application/vnd.github+json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        }),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        signal: requestTimeoutSignal(),
      });
    } catch (cause) {
      throw toNetworkError(cause);
    }

    const body = await readBody(response);

    if (response.status === 404 && init.allowNotFound) {
      return { data: null, response };
    }

    if (!response.ok) {
      throw new GitHubError(
        extractErrorMessage(body, `GitHub responded with ${response.status}.`),
        {
          status: response.status,
          code: classifyStatus(response.status),
          documentationUrl: documentationUrl(body),
          details: extractErrorDetails(body),
        },
      );
    }

    return { data: body as T, response };
  }

  private recordRateLimit(data: { rateLimit?: RawRateLimit }): void {
    const raw = data?.rateLimit;
    if (!raw) return;
    this.pointsUsed += raw.cost ?? 0;
    this.lastRateLimit = {
      limit: raw.limit ?? 0,
      remaining: raw.remaining ?? 0,
      cost: raw.cost ?? 0,
      resetAt: raw.resetAt ?? new Date().toISOString(),
      usedThisRequest: this.pointsUsed,
    };
  }
}

function requestTimeoutSignal(): AbortSignal | undefined {
  // Guarded because some test environments polyfill fetch without AbortSignal.timeout.
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)
    : undefined;
}

function toNetworkError(cause: unknown): GitHubError {
  const error = cause as Error;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return new GitHubError(
      `GitHub did not answer within ${Math.round(GITHUB_REQUEST_TIMEOUT_MS / 1000)} seconds.`,
      { status: 0, code: "NETWORK" },
    );
  }
  return new GitHubError(`Could not reach GitHub: ${error.message}`, {
    status: 0,
    code: "NETWORK",
  });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function documentationUrl(body: unknown): string | null {
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>).documentation_url;
    if (typeof value === "string") return value;
  }
  return null;
}
