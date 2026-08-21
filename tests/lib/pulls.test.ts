import { beforeEach, describe, expect, it } from "vitest";
import { GitHubClient } from "@/lib/github/client";
import {
  fetchAllOpenPullRequests,
  fetchRepositoryInventory,
  fetchViewer,
} from "@/lib/github/pulls";
import type { RawRepository } from "@/lib/github/raw";
import { MockGitHub, RATE_LIMIT } from "~tests/mockGitHub";
import { rawPullRequest, rawRepository, resetFactories } from "~tests/factories";

function inventoryPage(
  repositories: RawRepository[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
) {
  return {
    body: {
      data: {
        rateLimit: RATE_LIMIT,
        viewer: {
          login: "octocat",
          repositories: {
            totalCount: repositories.length,
            pageInfo,
            nodes: repositories,
          },
        },
      },
    },
  };
}

beforeEach(() => {
  resetFactories();
});

describe("fetchViewer", () => {
  it("returns the identity behind the token", async () => {
    const github = new MockGitHub().onGraphQL("Viewer", () => ({
      body: {
        data: {
          rateLimit: RATE_LIMIT,
          viewer: {
            login: "octocat",
            name: "The Octocat",
            avatarUrl: "https://avatars.githubusercontent.com/u/1",
            url: "https://github.com/octocat",
          },
        },
      },
    }));

    const viewer = await fetchViewer(new GitHubClient("ghp_token", github.fetch));

    expect(viewer).toEqual({
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      url: "https://github.com/octocat",
    });
  });
});

describe("fetchRepositoryInventory", () => {
  it("paginates until GitHub reports no further pages", async () => {
    const github = new MockGitHub();
    let page = 0;

    github.onGraphQL("RepositoryInventory", () => {
      page += 1;
      if (page === 1) {
        return inventoryPage(
          [
            rawRepository({ nameWithOwner: "acme/one", pullRequests: { totalCount: 2 } }),
            rawRepository({ nameWithOwner: "acme/two", pullRequests: { totalCount: 0 } }),
          ],
          { hasNextPage: true, endCursor: "cursor-1" },
        );
      }
      return inventoryPage(
        [rawRepository({ nameWithOwner: "acme/three", pullRequests: { totalCount: 5 } })],
        { hasNextPage: false, endCursor: null },
      );
    });

    const inventory = await fetchRepositoryInventory(new GitHubClient("ghp_token", github.fetch));

    expect(inventory.all.map((repository) => repository.nameWithOwner)).toEqual([
      "acme/one",
      "acme/two",
      "acme/three",
    ]);
    expect(inventory.withOpenPullRequests.map((repository) => repository.nameWithOwner)).toEqual([
      "acme/one",
      "acme/three",
    ]);

    const calls = github.callsFor("RepositoryInventory");
    expect(calls).toHaveLength(2);
    expect(calls[0].variables.cursor).toBeNull();
    expect(calls[1].variables.cursor).toBe("cursor-1");
  });

  it("skips archived repositories and de-duplicates repeated nodes", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () =>
      inventoryPage(
        [
          rawRepository({ nameWithOwner: "acme/live", pullRequests: { totalCount: 1 } }),
          rawRepository({ nameWithOwner: "acme/live", pullRequests: { totalCount: 1 } }),
          rawRepository({
            nameWithOwner: "acme/attic",
            isArchived: true,
            pullRequests: { totalCount: 3 },
          }),
        ],
        { hasNextPage: false, endCursor: null },
      ),
    );

    const inventory = await fetchRepositoryInventory(new GitHubClient("ghp_token", github.fetch));

    expect(inventory.all).toHaveLength(2);
    expect(inventory.withOpenPullRequests.map((repository) => repository.nameWithOwner)).toEqual([
      "acme/live",
    ]);
  });

  it("stops when GitHub reports another page but no cursor", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () =>
      inventoryPage([rawRepository({ nameWithOwner: "acme/one" })], {
        hasNextPage: true,
        endCursor: null,
      }),
    );

    const inventory = await fetchRepositoryInventory(new GitHubClient("ghp_token", github.fetch));

    expect(inventory.all).toHaveLength(1);
    expect(github.callsFor("RepositoryInventory")).toHaveLength(1);
  });
});

describe("fetchAllOpenPullRequests", () => {
  it("only requests detail for repositories that have open pull requests", async () => {
    const github = new MockGitHub()
      .onGraphQL("RepositoryInventory", () =>
        inventoryPage(
          [
            rawRepository({ nameWithOwner: "acme/one", pullRequests: { totalCount: 1 } }),
            rawRepository({ nameWithOwner: "acme/empty", pullRequests: { totalCount: 0 } }),
          ],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .onGraphQL("RepositoryPullRequests", () => ({
        body: {
          data: {
            rateLimit: RATE_LIMIT,
            r0: rawRepository({
              nameWithOwner: "acme/one",
              pullRequests: {
                totalCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [rawPullRequest({ number: 11 })],
              },
            }),
          },
        },
      }));

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch));

    expect(payload.repositoriesScanned).toBe(2);
    expect(payload.repositoriesWithOpenPullRequests).toBe(1);
    expect(payload.pullRequests).toHaveLength(1);
    expect(payload.pullRequests[0].number).toBe(11);
    expect(payload.pullRequests[0].repository.nameWithOwner).toBe("acme/one");
    expect(payload.warnings).toEqual([]);

    const detailCalls = github.callsFor("RepositoryPullRequests");
    expect(detailCalls).toHaveLength(1);
    expect(detailCalls[0].variables).toMatchObject({ owner0: "acme", name0: "one" });
    expect(detailCalls[0].variables).not.toHaveProperty("owner1");
  });

  it("batches several repositories into a single aliased query", async () => {
    const names = ["acme/a", "acme/b", "acme/c", "acme/d"];
    const github = new MockGitHub()
      .onGraphQL("RepositoryInventory", () =>
        inventoryPage(
          names.map((nameWithOwner) =>
            rawRepository({ nameWithOwner, pullRequests: { totalCount: 1 } }),
          ),
          { hasNextPage: false, endCursor: null },
        ),
      )
      .onGraphQL("RepositoryPullRequests", (call) => {
        const data: Record<string, unknown> = { rateLimit: RATE_LIMIT };
        for (let index = 0; index < names.length; index += 1) {
          const owner = call.variables[`owner${index}`] as string | undefined;
          const name = call.variables[`name${index}`] as string | undefined;
          if (!owner || !name) continue;
          data[`r${index}`] = rawRepository({
            nameWithOwner: `${owner}/${name}`,
            pullRequests: {
              totalCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [rawPullRequest({ number: index + 1 })],
            },
          });
        }
        return { body: { data } };
      });

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch), {
      repositoryBatchSize: 4,
    });

    expect(github.callsFor("RepositoryPullRequests")).toHaveLength(1);
    expect(payload.pullRequests).toHaveLength(4);
    expect(
      payload.pullRequests.map((pullRequest) => pullRequest.repository.nameWithOwner).sort(),
    ).toEqual(names);
  });

  it("follows pagination inside a repository with many open pull requests", async () => {
    const github = new MockGitHub()
      .onGraphQL("RepositoryInventory", () =>
        inventoryPage(
          [rawRepository({ nameWithOwner: "acme/busy", pullRequests: { totalCount: 3 } })],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .onGraphQL("RepositoryPullRequests", () => ({
        body: {
          data: {
            rateLimit: RATE_LIMIT,
            r0: rawRepository({
              nameWithOwner: "acme/busy",
              pullRequests: {
                totalCount: 3,
                pageInfo: { hasNextPage: true, endCursor: "pr-cursor-1" },
                nodes: [rawPullRequest({ number: 1 })],
              },
            }),
          },
        },
      }))
      .onGraphQL("RepositoryPullRequestsPage", (call) => {
        const cursor = call.variables.cursor as string;
        const isLast = cursor === "pr-cursor-2";
        return {
          body: {
            data: {
              rateLimit: RATE_LIMIT,
              repository: rawRepository({
                nameWithOwner: "acme/busy",
                pullRequests: {
                  totalCount: 3,
                  pageInfo: {
                    hasNextPage: !isLast,
                    endCursor: isLast ? null : "pr-cursor-2",
                  },
                  nodes: [rawPullRequest({ number: isLast ? 3 : 2 })],
                },
              }),
            },
          },
        };
      });

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch));

    expect(payload.pullRequests.map((pullRequest) => pullRequest.number).sort()).toEqual([1, 2, 3]);
    expect(github.callsFor("RepositoryPullRequestsPage")).toHaveLength(2);
  });

  it("sorts by most recently updated", async () => {
    const github = new MockGitHub()
      .onGraphQL("RepositoryInventory", () =>
        inventoryPage([rawRepository({ nameWithOwner: "acme/one", pullRequests: { totalCount: 3 } })], {
          hasNextPage: false,
          endCursor: null,
        }),
      )
      .onGraphQL("RepositoryPullRequests", () => ({
        body: {
          data: {
            rateLimit: RATE_LIMIT,
            r0: rawRepository({
              nameWithOwner: "acme/one",
              pullRequests: {
                totalCount: 3,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  rawPullRequest({ number: 1, updatedAt: "2026-08-01T00:00:00Z" }),
                  rawPullRequest({ number: 2, updatedAt: "2026-08-20T00:00:00Z" }),
                  rawPullRequest({ number: 3, updatedAt: "2026-08-10T00:00:00Z" }),
                ],
              },
            }),
          },
        },
      }));

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch));

    expect(payload.pullRequests.map((pullRequest) => pullRequest.number)).toEqual([2, 3, 1]);
  });

  it("records a warning and keeps going when one batch fails", async () => {
    const github = new MockGitHub()
      .onGraphQL("RepositoryInventory", () =>
        inventoryPage(
          [
            rawRepository({ nameWithOwner: "acme/good", pullRequests: { totalCount: 1 } }),
            rawRepository({ nameWithOwner: "acme/bad", pullRequests: { totalCount: 1 } }),
          ],
          { hasNextPage: false, endCursor: null },
        ),
      )
      .onGraphQL("RepositoryPullRequests", (call) => {
        if (call.variables.name0 === "bad") {
          return { status: 502, body: { message: "Server Error" } };
        }
        return {
          body: {
            data: {
              rateLimit: RATE_LIMIT,
              r0: rawRepository({
                nameWithOwner: "acme/good",
                pullRequests: {
                  totalCount: 1,
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [rawPullRequest({ number: 7 })],
                },
              }),
            },
          },
        };
      });

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch), {
      repositoryBatchSize: 1,
    });

    expect(payload.pullRequests).toHaveLength(1);
    expect(payload.pullRequests[0].number).toBe(7);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]).toContain("acme/bad");
    expect(payload.warnings[0]).toContain("Server Error");
  });

  it("warns when a repository in a batch comes back null", async () => {
    const github = new MockGitHub()
      .onGraphQL("RepositoryInventory", () =>
        inventoryPage([rawRepository({ nameWithOwner: "acme/gone", pullRequests: { totalCount: 1 } })], {
          hasNextPage: false,
          endCursor: null,
        }),
      )
      .onGraphQL("RepositoryPullRequests", () => ({
        body: { data: { rateLimit: RATE_LIMIT, r0: null } },
      }));

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch));

    expect(payload.pullRequests).toEqual([]);
    expect(payload.warnings[0]).toContain("acme/gone");
  });

  it("reports the accumulated rate limit cost", async () => {
    const github = new MockGitHub()
      .onGraphQL("RepositoryInventory", () =>
        inventoryPage([rawRepository({ nameWithOwner: "acme/one", pullRequests: { totalCount: 1 } })], {
          hasNextPage: false,
          endCursor: null,
        }),
      )
      .onGraphQL("RepositoryPullRequests", () => ({
        body: {
          data: {
            rateLimit: { ...RATE_LIMIT, cost: 12, remaining: 4900 },
            r0: rawRepository({
              nameWithOwner: "acme/one",
              pullRequests: {
                totalCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [rawPullRequest({ number: 1 })],
              },
            }),
          },
        },
      }));

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch));

    expect(payload.rateLimit).toMatchObject({ remaining: 4900, usedThisRequest: 13 });
    expect(Date.parse(payload.fetchedAt)).not.toBeNaN();
  });

  it("returns an empty payload when nothing has open pull requests", async () => {
    const github = new MockGitHub().onGraphQL("RepositoryInventory", () =>
      inventoryPage([rawRepository({ nameWithOwner: "acme/quiet", pullRequests: { totalCount: 0 } })], {
        hasNextPage: false,
        endCursor: null,
      }),
    );

    const payload = await fetchAllOpenPullRequests(new GitHubClient("ghp_token", github.fetch));

    expect(payload.pullRequests).toEqual([]);
    expect(payload.repositoriesScanned).toBe(1);
    expect(github.callsFor("RepositoryPullRequests")).toHaveLength(0);
  });
});
