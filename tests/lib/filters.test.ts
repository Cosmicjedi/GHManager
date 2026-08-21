import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  applyFilters,
  collectFilterOptions,
  commonMergeMethods,
  hasActiveFilters,
  mergeableIds,
} from "@/lib/filters";
import type { PullRequest } from "@/lib/types";
import {
  conflictingPullRequest,
  pullRequest,
  repositorySummary,
  resetFactories,
} from "~tests/factories";

let data: PullRequest[];

beforeEach(() => {
  resetFactories();

  data = [
    pullRequest({
      id: "pr-alpha",
      number: 1,
      title: "Add rate limiting",
      updatedAt: "2026-08-20T10:00:00Z",
      createdAt: "2026-08-01T10:00:00Z",
      repository: repositorySummary({ nameWithOwner: "acme/api" }),
      author: { login: "ada", avatarUrl: null, url: null },
      headRefName: "feat/rate-limit",
      labels: [{ name: "backend", color: "0e8a16" }],
    }),
    conflictingPullRequest({
      id: "pr-beta",
      number: 2,
      title: "Refactor billing",
      updatedAt: "2026-08-18T10:00:00Z",
      createdAt: "2026-08-05T10:00:00Z",
      repository: repositorySummary({
        nameWithOwner: "acme/web",
        allowedMergeMethods: ["merge", "squash"],
      }),
      author: { login: "grace", avatarUrl: null, url: null },
      headRefName: "chore/billing",
      labels: [],
    }),
    pullRequest({
      id: "pr-gamma",
      number: 3,
      title: "Draft: experiment with caching",
      isDraft: true,
      updatedAt: "2026-08-19T10:00:00Z",
      createdAt: "2026-08-10T10:00:00Z",
      repository: repositorySummary({ nameWithOwner: "acme/web" }),
      author: { login: "ada", avatarUrl: null, url: null },
      headRefName: "spike/cache",
      labels: [],
      mergeability: {
        canMerge: false,
        label: "Draft",
        reason: "This pull request is still a draft.",
        tone: "neutral",
      },
    }),
  ];
});

describe("applyFilters", () => {
  it("returns everything sorted by most recently updated by default", () => {
    const result = applyFilters(data, DEFAULT_FILTERS);
    expect(result.map((pr) => pr.id)).toEqual(["pr-alpha", "pr-gamma", "pr-beta"]);
  });

  it("sorts oldest first", () => {
    const result = applyFilters(data, { ...DEFAULT_FILTERS, sort: "updated-asc" });
    expect(result.map((pr) => pr.id)).toEqual(["pr-beta", "pr-gamma", "pr-alpha"]);
  });

  it("sorts by creation date", () => {
    const result = applyFilters(data, { ...DEFAULT_FILTERS, sort: "created-desc" });
    expect(result.map((pr) => pr.id)).toEqual(["pr-gamma", "pr-beta", "pr-alpha"]);
  });

  it("sorts by repository then pull request number", () => {
    const result = applyFilters(data, { ...DEFAULT_FILTERS, sort: "repository" });
    expect(result.map((pr) => pr.repository.nameWithOwner)).toEqual([
      "acme/api",
      "acme/web",
      "acme/web",
    ]);
    expect(result.slice(1).map((pr) => pr.number)).toEqual([2, 3]);
  });

  it("sorts by author login", () => {
    const result = applyFilters(data, { ...DEFAULT_FILTERS, sort: "author" });
    expect(result.map((pr) => pr.author?.login)).toEqual(["ada", "ada", "grace"]);
  });

  it("matches search terms against title, repo, author, branch and labels", () => {
    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, search: "billing" }).map((pr) => pr.id),
    ).toEqual(["pr-beta"]);

    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, search: "acme/api" }).map((pr) => pr.id),
    ).toEqual(["pr-alpha"]);

    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, search: "grace" }).map((pr) => pr.id),
    ).toEqual(["pr-beta"]);

    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, search: "spike/cache" }).map((pr) => pr.id),
    ).toEqual(["pr-gamma"]);

    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, search: "backend" }).map((pr) => pr.id),
    ).toEqual(["pr-alpha"]);
  });

  it("requires every search term to match", () => {
    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, search: "ada caching" }).map((pr) => pr.id),
    ).toEqual(["pr-gamma"]);

    expect(applyFilters(data, { ...DEFAULT_FILTERS, search: "ada billing" })).toEqual([]);
  });

  it("matches a pull request number with or without the hash", () => {
    expect(applyFilters(data, { ...DEFAULT_FILTERS, search: "#2" }).map((pr) => pr.id)).toEqual([
      "pr-beta",
    ]);
    expect(applyFilters(data, { ...DEFAULT_FILTERS, search: "3" }).map((pr) => pr.id)).toEqual([
      "pr-gamma",
    ]);
  });

  it("is case insensitive", () => {
    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, search: "REFACTOR" }).map((pr) => pr.id),
    ).toEqual(["pr-beta"]);
  });

  it("filters by repository and author", () => {
    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, repository: "acme/web" }).map((pr) => pr.id),
    ).toEqual(["pr-gamma", "pr-beta"]);

    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, author: "ada" }).map((pr) => pr.id),
    ).toEqual(["pr-alpha", "pr-gamma"]);
  });

  it("filters by readiness", () => {
    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, readiness: "ready" }).map((pr) => pr.id),
    ).toEqual(["pr-alpha"]);

    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, readiness: "blocked" }).map((pr) => pr.id),
    ).toEqual(["pr-gamma", "pr-beta"]);
  });

  it("hides drafts on request", () => {
    expect(
      applyFilters(data, { ...DEFAULT_FILTERS, hideDrafts: true }).map((pr) => pr.id),
    ).toEqual(["pr-alpha", "pr-beta"]);
  });

  it("combines filters", () => {
    expect(
      applyFilters(data, {
        ...DEFAULT_FILTERS,
        repository: "acme/web",
        author: "ada",
        hideDrafts: true,
      }),
    ).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const snapshot = data.map((pr) => pr.id);
    applyFilters(data, { ...DEFAULT_FILTERS, sort: "updated-asc" });
    expect(data.map((pr) => pr.id)).toEqual(snapshot);
  });
});

describe("collectFilterOptions", () => {
  it("returns sorted distinct repositories and authors", () => {
    expect(collectFilterOptions(data)).toEqual({
      repositories: ["acme/api", "acme/web"],
      authors: ["ada", "grace"],
    });
  });

  it("skips pull requests with no author", () => {
    const options = collectFilterOptions([pullRequest({ author: null })]);
    expect(options.authors).toEqual([]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the defaults and true for any narrowing", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, search: "  " })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, search: "x" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, repository: "acme/web" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, author: "ada" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, readiness: "ready" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, hideDrafts: true })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, sort: "author" })).toBe(false);
  });
});

describe("mergeableIds", () => {
  it("returns only the ids that can actually be merged", () => {
    expect(mergeableIds(data)).toEqual(["pr-alpha"]);
  });
});

describe("commonMergeMethods", () => {
  it("returns the intersection across the selection", () => {
    expect(commonMergeMethods(data)).toEqual(["merge", "squash"]);
  });

  it("returns all methods for an empty selection", () => {
    expect(commonMergeMethods([])).toEqual(["merge", "squash", "rebase"]);
  });

  it("returns an empty list when nothing is shared", () => {
    const a = pullRequest({
      repository: repositorySummary({ allowedMergeMethods: ["merge"] }),
    });
    const b = pullRequest({
      repository: repositorySummary({ allowedMergeMethods: ["rebase"] }),
    });

    expect(commonMergeMethods([a, b])).toEqual([]);
  });
});
