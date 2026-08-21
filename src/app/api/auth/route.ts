import { NextResponse } from "next/server";
import {
  buildClearedTokenCookie,
  buildTokenCookie,
  environmentToken,
  isSecureRequest,
  looksLikeToken,
  parseScopes,
  resolveToken,
} from "@/lib/auth";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import type { AuthStatus, TokenSource, Viewer } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RestUser {
  login: string;
  name: string | null;
  avatar_url: string | null;
  html_url: string;
}

export interface AuthResponse extends AuthStatus {
  error: string | null;
}

const SIGNED_OUT: AuthResponse = {
  authenticated: false,
  source: "none",
  viewer: null,
  scopes: [],
  managedByServer: false,
  error: null,
};

/** Verify a token and return the identity behind it. */
async function inspectToken(token: string): Promise<{ viewer: Viewer; scopes: string[] }> {
  const client = new GitHubClient(token);
  const { data, response } = await client.rest<RestUser>("/user");

  if (!data?.login) {
    throw new GitHubError("GitHub did not return an account for this token.", {
      status: 502,
    });
  }

  return {
    viewer: {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      url: data.html_url,
    },
    scopes: parseScopes(response.headers.get("x-oauth-scopes")),
  };
}

function statusFor(
  source: TokenSource,
  viewer: Viewer,
  scopes: string[],
): AuthResponse {
  return {
    authenticated: true,
    source,
    viewer,
    scopes,
    managedByServer: source === "env",
    error: null,
  };
}

function failure(message: string, source: TokenSource, status: number): NextResponse<AuthResponse> {
  return NextResponse.json<AuthResponse>(
    { ...SIGNED_OUT, source, error: message },
    { status },
  );
}

/** Current authentication status for the dashboard. */
export async function GET(request: Request): Promise<NextResponse<AuthResponse>> {
  const { token, source } = resolveToken(request);

  if (!token) {
    return NextResponse.json<AuthResponse>(SIGNED_OUT);
  }

  try {
    const { viewer, scopes } = await inspectToken(token);
    return NextResponse.json<AuthResponse>(statusFor(source, viewer, scopes));
  } catch (error) {
    const message =
      error instanceof GitHubError
        ? error.status === 401
          ? "The stored GitHub token is no longer valid. Sign in again."
          : error.message
        : "Could not verify the GitHub token.";

    const response = failure(message, source, 200);
    // A dead cookie token is cleared so the UI falls back to the token
    // configured on the server, if there is one.
    if (source === "cookie") {
      response.headers.append(
        "Set-Cookie",
        buildClearedTokenCookie({ secure: isSecureRequest(request) }),
      );
    }
    return response;
  }
}

/** Store a token supplied through the UI. */
export async function POST(request: Request): Promise<NextResponse<AuthResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("Send a JSON body containing a token field.", "none", 400);
  }

  const token = (body as { token?: unknown } | null)?.token;

  if (typeof token !== "string" || !token.trim()) {
    return failure("A GitHub personal access token is required.", "none", 400);
  }

  if (!looksLikeToken(token)) {
    return failure(
      "That does not look like a GitHub personal access token. Tokens are at least 20 characters and contain only letters, digits, underscores, dots and hyphens.",
      "none",
      400,
    );
  }

  try {
    const { viewer, scopes } = await inspectToken(token.trim());
    const response = NextResponse.json<AuthResponse>(statusFor("cookie", viewer, scopes));
    response.headers.append(
      "Set-Cookie",
      buildTokenCookie(token.trim(), { secure: isSecureRequest(request) }),
    );
    return response;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      return failure(
        "GitHub rejected that token. Check that it has not expired and that it was copied in full.",
        "none",
        401,
      );
    }
    if (error instanceof GitHubError && error.status === 403) {
      return failure(
        `GitHub refused the token: ${error.message}`,
        "none",
        403,
      );
    }
    return failure(
      error instanceof GitHubError ? error.message : "Could not verify the token with GitHub.",
      "none",
      502,
    );
  }
}

/** Forget the UI-supplied token. */
export async function DELETE(request: Request): Promise<NextResponse<AuthResponse>> {
  const cleared = buildClearedTokenCookie({ secure: isSecureRequest(request) });
  const fallback = environmentToken();

  if (!fallback) {
    const response = NextResponse.json<AuthResponse>(SIGNED_OUT);
    response.headers.append("Set-Cookie", cleared);
    return response;
  }

  try {
    const { viewer, scopes } = await inspectToken(fallback);
    const response = NextResponse.json<AuthResponse>(statusFor("env", viewer, scopes));
    response.headers.append("Set-Cookie", cleared);
    return response;
  } catch {
    const response = NextResponse.json<AuthResponse>({
      ...SIGNED_OUT,
      error: "Signed out. The token configured on the server is not usable.",
    });
    response.headers.append("Set-Cookie", cleared);
    return response;
  }
}
