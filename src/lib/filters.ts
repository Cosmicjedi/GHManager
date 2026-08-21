import type { PullRequest } from "@/lib/types";

export type ReadinessFilter = "all" | "ready" | "blocked";

export type SortKey =
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "repository"
  | "author";

export interface FilterState {
  /** Free text matched against title, repo, author, branch and PR number. */
  search: string;
  /** "" means every repository. */
  repository: string;
  /** "" means every author. */
  author: string;
  readiness: ReadinessFilter;
  hideDrafts: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: FilterState = {
  search: "",
  repository: "",
  author: "",
  readiness: "all",
  hideDrafts: false,
  sort: "updated-desc",
};

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "updated-desc", label: "Recently updated" },
  { value: "updated-asc", label: "Least recently updated" },
  { value: "created-desc", label: "Newest first" },
  { value: "repository", label: "Repository A-Z" },
  { value: "author", label: "Author A-Z" },
];

export const READINESS_OPTIONS: Array<{ value: ReadinessFilter; label: string }> = [
  { value: "all", label: "All states" },
  { value: "ready", label: "Ready to merge" },
  { value: "blocked", label: "Needs attention" },
];

function matchesSearch(pullRequest: PullRequest, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    pullRequest.title,
    pullRequest.repository.nameWithOwner,
    pullRequest.author?.login ?? "",
    pullRequest.headRefName,
    pullRequest.baseRefName,
    `#${pullRequest.number}`,
    String(pullRequest.number),
    ...pullRequest.labels.map((label) => label.name),
  ]
    .join(" ")
    .toLowerCase();

  // Every whitespace-separated term must appear somewhere.
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function compare(a: PullRequest, b: PullRequest, sort: SortKey): number {
  switch (sort) {
    case "updated-asc":
      return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    case "created-desc":
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    case "repository": {
      const byRepo = a.repository.nameWithOwner.localeCompare(b.repository.nameWithOwner);
      return byRepo !== 0 ? byRepo : a.number - b.number;
    }
    case "author": {
      const byAuthor = (a.author?.login ?? "").localeCompare(b.author?.login ?? "");
      return byAuthor !== 0 ? byAuthor : Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    }
    case "updated-desc":
    default:
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }
}

/** Apply the toolbar filters and sort, returning a new array. */
export function applyFilters(
  pullRequests: readonly PullRequest[],
  filters: FilterState,
): PullRequest[] {
  const search = filters.search.trim();

  const filtered = pullRequests.filter((pullRequest) => {
    if (filters.hideDrafts && pullRequest.isDraft) return false;
    if (filters.repository && pullRequest.repository.nameWithOwner !== filters.repository) {
      return false;
    }
    if (filters.author && (pullRequest.author?.login ?? "") !== filters.author) return false;
    if (filters.readiness === "ready" && !pullRequest.mergeability.canMerge) return false;
    if (filters.readiness === "blocked" && pullRequest.mergeability.canMerge) return false;
    return matchesSearch(pullRequest, search);
  });

  return filtered.sort((a, b) => compare(a, b, filters.sort));
}

/** Distinct repository and author values present in the data, sorted. */
export function collectFilterOptions(pullRequests: readonly PullRequest[]): {
  repositories: string[];
  authors: string[];
} {
  const repositories = new Set<string>();
  const authors = new Set<string>();

  for (const pullRequest of pullRequests) {
    repositories.add(pullRequest.repository.nameWithOwner);
    if (pullRequest.author?.login) authors.add(pullRequest.author.login);
  }

  return {
    repositories: [...repositories].sort((a, b) => a.localeCompare(b)),
    authors: [...authors].sort((a, b) => a.localeCompare(b)),
  };
}

/** True when any active filter is narrowing the list. */
export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.repository !== "" ||
    filters.author !== "" ||
    filters.readiness !== "all" ||
    filters.hideDrafts
  );
}

/** Ids of the pull requests in `pullRequests` that can actually be merged. */
export function mergeableIds(pullRequests: readonly PullRequest[]): string[] {
  return pullRequests
    .filter((pullRequest) => pullRequest.mergeability.canMerge)
    .map((pullRequest) => pullRequest.id);
}

/** Merge methods every supplied pull request allows, in a stable order. */
export function commonMergeMethods(
  pullRequests: readonly PullRequest[],
): PullRequest["repository"]["allowedMergeMethods"] {
  const order: PullRequest["repository"]["allowedMergeMethods"] = ["merge", "squash", "rebase"];
  if (pullRequests.length === 0) return order;

  return order.filter((method) =>
    pullRequests.every((pullRequest) =>
      pullRequest.repository.allowedMergeMethods.includes(method),
    ),
  );
}
