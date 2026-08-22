/** Endpoint configuration, overridable for GitHub Enterprise Server. */

export const GITHUB_API_BASE_URL =
  process.env.GITHUB_API_BASE_URL?.replace(/\/+$/, "") || "https://api.github.com";

export const GITHUB_GRAPHQL_URL =
  process.env.GITHUB_GRAPHQL_URL || `${GITHUB_API_BASE_URL}/graphql`;

/** User agent sent on every request - GitHub rejects requests without one. */
export const USER_AGENT = "GHManager/1.0";

/**
 * `mergeStateStatus` is still behind a preview media type on some GitHub
 * deployments, so we always request it explicitly.
 */
export const GRAPHQL_ACCEPT =
  "application/vnd.github.merge-info-preview+json, application/json";
