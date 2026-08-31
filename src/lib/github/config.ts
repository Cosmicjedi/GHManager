/** Endpoint configuration, overridable for GitHub Enterprise Server. */

export const GITHUB_API_BASE_URL =
  process.env.GITHUB_API_BASE_URL?.replace(/\/+$/, "") || "https://api.github.com";

export const GITHUB_GRAPHQL_URL =
  process.env.GITHUB_GRAPHQL_URL || `${GITHUB_API_BASE_URL}/graphql`;

/** User agent sent on every request - GitHub rejects requests without one. */
export const USER_AGENT = "GHManager/1.0";

/**
 * Ceiling on a single HTTP round trip to GitHub. A socket that stalls without
 * ever erroring would otherwise hang an API route - and with it the merge
 * dialog or refresh that is waiting on the answer.
 */
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

/**
 * `mergeStateStatus` is still behind a preview media type on some GitHub
 * deployments, so we always request it explicitly.
 */
export const GRAPHQL_ACCEPT =
  "application/vnd.github.merge-info-preview+json, application/json";
