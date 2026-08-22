/** Raw GraphQL response shapes returned by GitHub, before normalisation. */

export interface RawRepository {
  id: string;
  name: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  viewerPermission: string | null;
  mergeCommitAllowed: boolean | null;
  squashMergeAllowed: boolean | null;
  rebaseMergeAllowed: boolean | null;
  owner: { login: string } | null;
  defaultBranchRef: { name: string } | null;
  pullRequests?: {
    totalCount: number;
    pageInfo?: { hasNextPage: boolean; endCursor: string | null };
    nodes?: Array<RawPullRequest | null> | null;
  } | null;
}

export interface RawCheckContext {
  __typename?: string;
  name?: string;
  status?: string | null;
  conclusion?: string | null;
  context?: string;
  state?: string | null;
}

export interface RawPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: string | null;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  author: { login: string; url: string | null; avatarUrl: string | null } | null;
  labels: { nodes: Array<{ name: string; color: string } | null> | null } | null;
  commits: {
    nodes: Array<{
      commit: {
        oid: string;
        statusCheckRollup: {
          state: string | null;
          contexts: {
            totalCount: number;
            nodes: Array<RawCheckContext | null> | null;
          } | null;
        } | null;
      };
    } | null> | null;
  } | null;
}

export interface RawInventoryResponse {
  viewer: {
    login: string;
    repositories: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<RawRepository | null> | null;
    };
  };
}

export interface RawViewerResponse {
  viewer: {
    login: string;
    name: string | null;
    avatarUrl: string | null;
    url: string;
  };
}
