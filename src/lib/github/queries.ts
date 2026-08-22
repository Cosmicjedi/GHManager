/**
 * GraphQL documents used to inventory repositories and pull open pull
 * requests. Kept as plain strings so they can be asserted against in tests
 * without a GraphQL toolchain.
 */

export const RATE_LIMIT_FIELDS = `rateLimit { limit cost remaining resetAt }`;

export const REPOSITORY_FRAGMENT = `
fragment RepoFields on Repository {
  id
  name
  nameWithOwner
  url
  isPrivate
  isFork
  isArchived
  viewerPermission
  mergeCommitAllowed
  squashMergeAllowed
  rebaseMergeAllowed
  owner { login }
  defaultBranchRef { name }
}
`;

export const PULL_REQUEST_FRAGMENT = `
fragment PrFields on PullRequest {
  id
  number
  title
  url
  isDraft
  createdAt
  updatedAt
  baseRefName
  headRefName
  additions
  deletions
  changedFiles
  mergeable
  mergeStateStatus
  reviewDecision
  author {
    login
    url
    avatarUrl
  }
  labels(first: 10) {
    nodes { name color }
  }
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
              }
              ... on StatusContext {
                context
                state
              }
            }
          }
        }
      }
    }
  }
}
`;

/** Identity + token sanity check. */
export const VIEWER_QUERY = `
query Viewer {
  ${RATE_LIMIT_FIELDS}
  viewer {
    login
    name
    avatarUrl
    url
  }
}
`;

/**
 * Pass 1: cheaply list every repository the viewer can reach along with how
 * many open pull requests it has. Repositories with zero open PRs are dropped
 * before the expensive detail query runs.
 */
export const REPOSITORY_INVENTORY_QUERY = `
query RepositoryInventory($cursor: String, $pageSize: Int!) {
  ${RATE_LIMIT_FIELDS}
  viewer {
    login
    repositories(
      first: $pageSize
      after: $cursor
      isArchived: false
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ...RepoFields
        pullRequests(states: OPEN) { totalCount }
      }
    }
  }
}
${REPOSITORY_FRAGMENT}
`;

/**
 * Pass 2: fetch full pull request detail for a batch of repositories in a
 * single round trip using GraphQL aliases.
 */
export function buildRepositoryPullRequestsQuery(repositoryCount: number): string {
  if (repositoryCount < 1) {
    throw new Error("buildRepositoryPullRequestsQuery requires at least one repository.");
  }

  const variableDefinitions = ["$prPageSize: Int!"];
  const selections: string[] = [];

  for (let index = 0; index < repositoryCount; index += 1) {
    variableDefinitions.push(`$owner${index}: String!`, `$name${index}: String!`);
    selections.push(`
  r${index}: repository(owner: $owner${index}, name: $name${index}) {
    ...RepoFields
    pullRequests(
      states: OPEN
      first: $prPageSize
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...PrFields }
    }
  }`);
  }

  return `
query RepositoryPullRequests(${variableDefinitions.join(", ")}) {
  ${RATE_LIMIT_FIELDS}${selections.join("")}
}
${REPOSITORY_FRAGMENT}
${PULL_REQUEST_FRAGMENT}
`;
}

/** Follow-up query for repositories with more open PRs than one page holds. */
export const REPOSITORY_PULL_REQUESTS_PAGE_QUERY = `
query RepositoryPullRequestsPage(
  $owner: String!
  $name: String!
  $cursor: String
  $prPageSize: Int!
) {
  ${RATE_LIMIT_FIELDS}
  repository(owner: $owner, name: $name) {
    ...RepoFields
    pullRequests(
      states: OPEN
      first: $prPageSize
      after: $cursor
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ...PrFields }
    }
  }
}
${REPOSITORY_FRAGMENT}
${PULL_REQUEST_FRAGMENT}
`;
