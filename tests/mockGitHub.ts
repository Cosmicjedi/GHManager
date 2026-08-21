import { vi } from "vitest";

export interface GraphQLCall {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

export interface RestCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type GraphQLHandler = (call: GraphQLCall) => MockResponse | unknown;
type RestHandler = (call: RestCall) => MockResponse | unknown;

function isMockResponse(value: unknown): value is MockResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    ("status" in value || "body" in value || "headers" in value)
  );
}

function toResponse(result: MockResponse | unknown): Response {
  const shaped: MockResponse = isMockResponse(result) ? result : { body: result };
  const status = shaped.status ?? 200;
  const body = shaped.body === undefined ? "" : JSON.stringify(shaped.body);

  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      ...shaped.headers,
    },
  });
}

/**
 * A stand-in for `fetch` that understands GitHub's GraphQL and REST endpoints.
 *
 * Handlers are registered by GraphQL operation name or by REST
 * `METHOD /path` pattern, and every call is recorded so tests can assert on
 * pagination, batching and request bodies.
 */
export class MockGitHub {
  readonly graphqlCalls: GraphQLCall[] = [];
  readonly restCalls: RestCall[] = [];

  private readonly graphqlHandlers = new Map<string, GraphQLHandler>();
  private readonly restHandlers: Array<{ pattern: RegExp; method: string; handler: RestHandler }> =
    [];

  /** Register a handler for a named GraphQL operation. */
  onGraphQL(operationName: string, handler: GraphQLHandler): this {
    this.graphqlHandlers.set(operationName, handler);
    return this;
  }

  /**
   * Register a REST handler. `pattern` is matched against the pathname, so
   * `/repos/acme/widgets/pulls/1/merge` or a RegExp both work.
   */
  onRest(method: string, pattern: string | RegExp, handler: RestHandler): this {
    this.restHandlers.push({
      method: method.toUpperCase(),
      pattern:
        typeof pattern === "string"
          ? new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
          : pattern,
      handler,
    });
    return this;
  }

  /** The `fetch` implementation to hand to `new GitHubClient(token, fetch)`. */
  readonly fetch: typeof fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const rawBody = typeof init?.body === "string" ? init.body : null;
    const headers = normaliseHeaders(init?.headers);

    if (url.pathname.endsWith("/graphql")) {
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const query: string = parsed.query ?? "";
      const operationName = extractOperationName(query);
      const call: GraphQLCall = {
        operationName,
        query,
        variables: parsed.variables ?? {},
      };
      this.graphqlCalls.push(call);

      const handler = this.graphqlHandlers.get(operationName);
      if (!handler) {
        throw new Error(`No GraphQL handler registered for operation "${operationName}".`);
      }
      return toResponse(handler(call));
    }

    const call: RestCall = {
      method,
      path: url.pathname,
      body: rawBody ? JSON.parse(rawBody) : null,
      headers,
    };
    this.restCalls.push(call);

    const entry = this.restHandlers.find(
      (candidate) => candidate.method === method && candidate.pattern.test(url.pathname),
    );
    if (!entry) {
      throw new Error(`No REST handler registered for ${method} ${url.pathname}.`);
    }
    return toResponse(entry.handler(call));
  }) as unknown as typeof fetch;

  /** GraphQL calls recorded for a single operation name. */
  callsFor(operationName: string): GraphQLCall[] {
    return this.graphqlCalls.filter((call) => call.operationName === operationName);
  }
}

function extractOperationName(query: string): string {
  const match = /(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query);
  return match?.[1] ?? "anonymous";
}

function normaliseHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[key.toLowerCase()] = value;
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = String(value);
  }
  return result;
}

/** Standard GraphQL rate limit block, so `client.getRateLimit()` is populated. */
export const RATE_LIMIT = {
  limit: 5000,
  cost: 1,
  remaining: 4987,
  resetAt: "2026-08-21T12:00:00Z",
};
