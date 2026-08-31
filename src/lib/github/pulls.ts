import { createLimiter } from "@/lib/concurrency";
import type { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { mapPullRequest, mapRepository } from "@/lib/github/mappers";
import {
  REPOSITORY_INVENTORY_QUERY,
  REPOSITORY_PULL_REQUESTS_PAGE_QUERY,
  buildRepositoryPullRequestsQuery,
} from "@/lib/github/queries";
import type {
  RawInventoryResponse,
  RawPullRequest,
  RawRepository,
  RawViewerResponse,
} from "@/lib/github/raw";
import { VIEWER_QUERY } from "@/lib/github/queries";
import type { PullRequest, PullRequestsPayload, RepositorySummary, Viewer } from "@/lib/types";

export interface FetchOptions {
  /** Repositories requested per inventory page. GitHub caps this at 100. */
  repositoryPageSize?: number;
  /** Repositories aliased into a single detail query. */
  repositoryBatchSize?: number;
  /** Open pull requests requested per repository, per page. */
  pullRequestPageSize?: number;
  /** How many detail queries may be in flight at once. */
  concurrency?: number;
  /** Hard ceiling on repositories inspected, as a runaway guard. */
  maxRepositories?: number;
}

const DEFAULTS: Required<FetchOptions> = {
  repositoryPageSize: 100,
  repositoryBatchSize: 8,
  pullRequestPageSize: 25,
  concurrency: 3,
  maxRepositories: 2000,
};

/** Resolve the identity behind the token. Doubles as a token validity check. */
export async function fetchViewer(client: GitHubClient): Promise<Viewer> {
  const { data } = await client.graphql<RawViewerResponse>(VIEWER_QUERY);
  return {
    login: data.viewer.login,
    name: data.viewer.name,
    avatarUrl: data.viewer.avatarUrl,
    url: data.viewer.url,
  };
}

/**
 * Walk the repository inventory page by page, handing each page's new
 * repositories to the caller as soon as GitHub returns them.
 */
async function walkInventoryPages(
  client: GitHubClient,
  settings: Required<FetchOptions>,
  onPage: (added: RepositorySummary[]) => void,
): Promise<void> {
  const seen = new Set<string>();
  let total = 0;
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage && total < settings.maxRepositories) {
    const result = await client.graphql<RawInventoryResponse>(REPOSITORY_INVENTORY_QUERY, {
      cursor,
      pageSize: Math.min(settings.repositoryPageSize, 100),
    });

    const connection: RawInventoryResponse["viewer"]["repositories"] =
      result.data.viewer.repositories;
    const nodes = (connection.nodes ?? []).filter(
      (node): node is RawRepository => Boolean(node),
    );

    const added: RepositorySummary[] = [];
    for (const node of nodes) {
      if (seen.has(node.nameWithOwner)) continue;
      seen.add(node.nameWithOwner);
      added.push(mapRepository(node));
    }
    total += added.length;
    onPage(added);

    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    cursor = connection.pageInfo?.endCursor ?? null;
    if (!cursor) break;
  }
}

/**
 * Pass 1 - walk every repository the viewer can reach and keep only the ones
 * that actually have open pull requests. This keeps the expensive detail
 * queries proportional to the work, not to the size of the account.
 */
export async function fetchRepositoryInventory(
  client: GitHubClient,
  options: FetchOptions = {},
): Promise<{ all: RepositorySummary[]; withOpenPullRequests: RepositorySummary[] }> {
  const settings = { ...DEFAULTS, ...options };
  const all: RepositorySummary[] = [];

  await walkInventoryPages(client, settings, (added) => {
    all.push(...added);
  });

  const withOpenPullRequests = all.filter(
    (repository) => repository.openPullRequestCount > 0 && !repository.isArchived,
  );

  return { all, withOpenPullRequests };
}

interface BatchResponse {
  [alias: string]: RawRepository | null | unknown;
}

interface RepositoryPageResponse {
  repository: RawRepository | null;
}

/**
 * Pass 2 - fetch full pull request detail for a batch of repositories in one
 * round trip, then follow up on any repository whose open PR list spilled past
 * the first page.
 */
async function fetchBatch(
  client: GitHubClient,
  repositories: RepositorySummary[],
  settings: Required<FetchOptions>,
  warnings: string[],
): Promise<PullRequest[]> {
  const query = buildRepositoryPullRequestsQuery(repositories.length);
  const variables: Record<string, unknown> = {
    prPageSize: settings.pullRequestPageSize,
  };

  repositories.forEach((repository, index) => {
    variables[`owner${index}`] = repository.owner;
    variables[`name${index}`] = repository.name;
  });

  let data: BatchResponse;
  try {
    ({ data } = await client.graphql<BatchResponse>(query, variables));
  } catch (error) {
    const message = error instanceof GitHubError ? error.message : String(error);
    warnings.push(
      `Could not load pull requests for ${repositories
        .map((repository) => repository.nameWithOwner)
        .join(", ")}: ${message}`,
    );
    return [];
  }

  const collected: PullRequest[] = [];

  for (let index = 0; index < repositories.length; index += 1) {
    const raw = data[`r${index}`] as RawRepository | null | undefined;
    if (!raw) {
      warnings.push(
        `${repositories[index].nameWithOwner} could not be read - it may have been deleted or your token lost access.`,
      );
      continue;
    }

    const repository = mapRepository(raw);
    const nodes = (raw.pullRequests?.nodes ?? []).filter(
      (node): node is RawPullRequest => Boolean(node),
    );

    for (const node of nodes) {
      collected.push(mapPullRequest(node, repository));
    }

    if (raw.pullRequests?.pageInfo?.hasNextPage) {
      const extra = await fetchRemainingPullRequests(
        client,
        repository,
        raw.pullRequests.pageInfo.endCursor,
        settings,
        warnings,
      );
      collected.push(...extra);
    }
  }

  return collected;
}

/** Drain the remaining pages of open PRs for a single repository. */
async function fetchRemainingPullRequests(
  client: GitHubClient,
  repository: RepositorySummary,
  startCursor: string | null,
  settings: Required<FetchOptions>,
  warnings: string[],
): Promise<PullRequest[]> {
  const collected: PullRequest[] = [];
  let cursor = startCursor;
  let guard = 0;

  while (cursor && guard < 50) {
    guard += 1;
    let data: RepositoryPageResponse;
    try {
      ({ data } = await client.graphql<RepositoryPageResponse>(
        REPOSITORY_PULL_REQUESTS_PAGE_QUERY,
        {
          owner: repository.owner,
          name: repository.name,
          cursor,
          prPageSize: settings.pullRequestPageSize,
        },
      ));
    } catch (error) {
      const message = error instanceof GitHubError ? error.message : String(error);
      warnings.push(
        `Only part of ${repository.nameWithOwner} could be loaded: ${message}`,
      );
      break;
    }

    const raw = data.repository;
    if (!raw) break;

    const mapped = mapRepository(raw);
    const nodes = (raw.pullRequests?.nodes ?? []).filter(
      (node): node is RawPullRequest => Boolean(node),
    );
    for (const node of nodes) {
      collected.push(mapPullRequest(node, mapped));
    }

    cursor = raw.pullRequests?.pageInfo?.hasNextPage
      ? (raw.pullRequests.pageInfo.endCursor ?? null)
      : null;
  }

  return collected;
}

/** Everything a pulls payload carries except the cache marker. */
export type PullsSnapshot = Omit<PullRequestsPayload, "cached">;

/**
 * Fetch every open pull request across every repository the token can reach,
 * newest activity first.
 *
 * Detail batches start as soon as enough repositories are known instead of
 * waiting for the full inventory walk, and `onProgress` fires with a cumulative
 * snapshot after every inventory page and every completed batch - so a caller
 * can show results while the scan is still running.
 */
export async function fetchAllOpenPullRequests(
  client: GitHubClient,
  options: FetchOptions = {},
  onProgress?: (snapshot: PullsSnapshot) => void,
): Promise<PullsSnapshot> {
  const settings = { ...DEFAULTS, ...options };
  const warnings: string[] = [];
  const byId = new Map<string, PullRequest>();
  let repositoriesScanned = 0;
  let repositoriesWithOpenPullRequests = 0;

  const snapshot = (): PullsSnapshot => ({
    pullRequests: [...byId.values()].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    ),
    repositoriesScanned,
    repositoriesWithOpenPullRequests,
    rateLimit: client.getRateLimit(),
    fetchedAt: new Date().toISOString(),
    warnings: [...warnings],
  });

  const limit = createLimiter(settings.concurrency);
  const inFlight: Promise<void>[] = [];
  let pending: RepositorySummary[] = [];

  const scheduleBatch = (batch: RepositorySummary[]) => {
    inFlight.push(
      limit(async () => {
        const collected = await fetchBatch(client, batch, settings, warnings);
        for (const pullRequest of collected) byId.set(pullRequest.id, pullRequest);
        onProgress?.(snapshot());
      }),
    );
  };

  await walkInventoryPages(client, settings, (added) => {
    repositoriesScanned += added.length;
    for (const repository of added) {
      if (repository.openPullRequestCount > 0 && !repository.isArchived) {
        repositoriesWithOpenPullRequests += 1;
        pending.push(repository);
      }
    }
    while (pending.length >= settings.repositoryBatchSize) {
      scheduleBatch(pending.slice(0, settings.repositoryBatchSize));
      pending = pending.slice(settings.repositoryBatchSize);
    }
    onProgress?.(snapshot());
  });

  if (pending.length > 0) scheduleBatch(pending);
  await Promise.all(inFlight);

  return snapshot();
}
