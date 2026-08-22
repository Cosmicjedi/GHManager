import type { TokenSource } from "@/lib/types";

/**
 * Name of the httpOnly cookie holding a UI-supplied personal access token.
 * The cookie is never readable from browser JavaScript, so the token only
 * exists in the browser as an opaque credential attached to same-site
 * requests, and in the Node process that talks to GitHub.
 */
export const TOKEN_COOKIE = "ghmanager_token";

/** One week. Long enough to be convenient, short enough to expire on its own. */
export const TOKEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export interface ResolvedToken {
  token: string | null;
  source: TokenSource;
}

/** Parse a raw `Cookie` header into a map. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

/** Environment shape the token resolvers read from. */
export type TokenEnvironment = Record<string, string | undefined>;

/** Token configured on the server, if any. */
export function environmentToken(env: TokenEnvironment = process.env): string | null {
  const candidate = env.GITHUB_TOKEN || env.GH_TOKEN;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve the token for a request. A token pasted into the UI wins over the
 * server-configured one so a user can temporarily act as somebody else.
 */
export function resolveToken(
  request: Request,
  env: TokenEnvironment = process.env,
): ResolvedToken {
  const cookies = parseCookies(request.headers.get("cookie"));
  const fromCookie = cookies[TOKEN_COOKIE]?.trim();
  if (fromCookie) return { token: fromCookie, source: "cookie" };

  const fromEnv = environmentToken(env);
  if (fromEnv) return { token: fromEnv, source: "env" };

  return { token: null, source: "none" };
}

/**
 * Whether the request reached us over HTTPS.
 *
 * The `Secure` cookie attribute must track the actual scheme, not NODE_ENV: a
 * production build served over plain HTTP - which is exactly what a container
 * on http://localhost:3000 or behind an unterminated proxy looks like - would
 * otherwise set a Secure cookie that the browser silently drops, and sign-in
 * would appear to succeed and then immediately fall back to signed out.
 *
 * `x-forwarded-proto` is honoured so a container behind a TLS-terminating
 * proxy still gets Secure cookies.
 */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    // The header may be a comma-separated chain; the first hop is the client's.
    return forwarded.split(",")[0].trim().toLowerCase() === "https";
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Build the `Set-Cookie` value that stores a token. */
export function buildTokenCookie(
  token: string,
  { secure = false }: { secure?: boolean } = {},
): string {
  const parts = [
    `${TOKEN_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${TOKEN_COOKIE_MAX_AGE}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Build the `Set-Cookie` value that clears a stored token. */
export function buildClearedTokenCookie({
  secure = false,
}: { secure?: boolean } = {}): string {
  const parts = [
    `${TOKEN_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Shape check for a GitHub personal access token. Deliberately permissive -
 * GitHub keeps adding prefixes - but it catches empty strings, whitespace and
 * obviously-pasted-wrong values before a network round trip.
 */
export function looksLikeToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 512) return false;
  return /^[A-Za-z0-9_.-]+$/.test(trimmed);
}

/** Split the `x-oauth-scopes` header into a list. Empty for fine-grained PATs. */
export function parseScopes(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}
