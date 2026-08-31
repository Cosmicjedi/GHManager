import { parseScopes } from "@/lib/auth";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import type { Viewer } from "@/lib/types";

interface RestUser {
  login: string;
  name: string | null;
  avatar_url: string | null;
  html_url: string;
}

/** Verify a token against GitHub and return the identity behind it. */
export async function inspectToken(
  token: string,
): Promise<{ viewer: Viewer; scopes: string[] }> {
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
