import {
  TOKEN_COOKIE,
  environmentToken,
  parseCookies,
  type ResolvedToken,
} from "@/lib/auth";
import { getActiveStoredToken } from "@/lib/server/tokenStore";

/**
 * Resolve the token for a request, server-side.
 *
 * A token pasted into the UI (cookie) wins so a user can act as themselves;
 * then the active token from the managed store; then a GITHUB_TOKEN from the
 * environment as the legacy fallback.
 */
export function resolveRequestToken(request: Request): ResolvedToken {
  const cookies = parseCookies(request.headers.get("cookie"));
  const fromCookie = cookies[TOKEN_COOKIE]?.trim();
  if (fromCookie) return { token: fromCookie, source: "cookie" };

  const stored = getActiveStoredToken();
  if (stored) return { token: stored.token, source: "stored" };

  const fromEnv = environmentToken();
  if (fromEnv) return { token: fromEnv, source: "env" };

  return { token: null, source: "none" };
}
