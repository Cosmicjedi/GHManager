import { NextResponse } from "next/server";
import { environmentToken, looksLikeToken } from "@/lib/auth";
import { GitHubError } from "@/lib/github/errors";
import { inspectToken } from "@/lib/github/identity";
import {
  refreshTrackedTokens,
  trackTokenForBackgroundRefresh,
  untrackToken,
} from "@/lib/server/backgroundRefresh";
import { invalidatePullRequestCache } from "@/lib/server/pullCache";
import {
  listStoredTokens,
  maskToken,
  relabelStoredToken,
  removeStoredToken,
  setActiveStoredToken,
  upsertStoredToken,
} from "@/lib/server/tokenStore";
import type { ServerTokenSummary, ServerTokensPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface TokensErrorResponse {
  error: string;
}

function payload(): ServerTokensPayload {
  const { tokens, activeId } = listStoredTokens();
  const summaries: ServerTokenSummary[] = tokens.map((entry) => ({
    id: entry.id,
    label: entry.label,
    login: entry.login,
    name: entry.name,
    avatarUrl: entry.avatarUrl,
    url: entry.url,
    maskedToken: maskToken(entry.token),
    addedAt: entry.addedAt,
    active: entry.id === activeId,
  }));
  return { tokens: summaries, envTokenConfigured: Boolean(environmentToken()) };
}

function badRequest(message: string): NextResponse<TokensErrorResponse> {
  return NextResponse.json<TokensErrorResponse>({ error: message }, { status: 400 });
}

/** List the stored server tokens - metadata only, never the tokens. */
export async function GET(): Promise<NextResponse<ServerTokensPayload>> {
  return NextResponse.json<ServerTokensPayload>(payload());
}

/** Add (or re-add, to update its metadata) a server token. */
export async function POST(
  request: Request,
): Promise<NextResponse<ServerTokensPayload | TokensErrorResponse>> {
  let body: { token?: unknown; label?: unknown; makeActive?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Send a JSON body containing a token field.");
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return badRequest("A GitHub personal access token is required.");
  }
  if (!looksLikeToken(token)) {
    return badRequest(
      "That does not look like a GitHub personal access token. Tokens are at least 20 characters and contain only letters, digits, underscores, dots and hyphens.",
    );
  }
  if (body.label !== undefined && typeof body.label !== "string") {
    return badRequest("label must be a string.");
  }

  try {
    const { viewer } = await inspectToken(token);
    upsertStoredToken({
      token,
      viewer,
      label: typeof body.label === "string" ? body.label : undefined,
      makeActive: body.makeActive === true,
    });

    // Warm this token's cache straight away instead of waiting for the next
    // background cycle - the dashboard should be fast the moment it is added.
    trackTokenForBackgroundRefresh(token);
    void refreshTrackedTokens();

    return NextResponse.json<ServerTokensPayload>(payload(), { status: 201 });
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      return NextResponse.json<TokensErrorResponse>(
        {
          error:
            "GitHub rejected that token. Check that it has not expired and that it was copied in full.",
        },
        { status: 401 },
      );
    }
    return NextResponse.json<TokensErrorResponse>(
      {
        error:
          error instanceof GitHubError
            ? error.message
            : "Could not verify the token with GitHub.",
      },
      { status: 502 },
    );
  }
}

/** Rename a token or make it the active one. */
export async function PATCH(
  request: Request,
): Promise<NextResponse<ServerTokensPayload | TokensErrorResponse>> {
  let body: { id?: unknown; active?: unknown; label?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Send a JSON body with the id of the token to change.");
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return badRequest("A token id is required.");
  if (body.active === undefined && body.label === undefined) {
    return badRequest("Nothing to change - send active and/or label.");
  }

  if (body.active !== undefined) {
    if (body.active !== true) {
      return badRequest("active can only be set to true - activate another token instead.");
    }
    if (!setActiveStoredToken(id)) {
      return NextResponse.json<TokensErrorResponse>(
        { error: "No stored token with that id." },
        { status: 404 },
      );
    }
  }

  if (body.label !== undefined) {
    if (typeof body.label !== "string") return badRequest("label must be a string.");
    if (!relabelStoredToken(id, body.label)) {
      return NextResponse.json<TokensErrorResponse>(
        { error: "No stored token with that id." },
        { status: 404 },
      );
    }
  }

  return NextResponse.json<ServerTokensPayload>(payload());
}

/** Remove a stored token. */
export async function DELETE(
  request: Request,
): Promise<NextResponse<ServerTokensPayload | TokensErrorResponse>> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return badRequest("Pass the id of the token to remove.");

  const removed = removeStoredToken(id);
  if (!removed) {
    return NextResponse.json<TokensErrorResponse>(
      { error: "No stored token with that id." },
      { status: 404 },
    );
  }

  // Stop scanning for it and drop anything cached under it.
  untrackToken(removed.id);
  invalidatePullRequestCache(removed.token);

  return NextResponse.json<ServerTokensPayload>(payload());
}
