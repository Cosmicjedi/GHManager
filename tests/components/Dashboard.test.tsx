import { screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { Dashboard } from "@/components/Dashboard";
import type { MergePayload, PullRequest } from "@/lib/types";
import {
  conflictingPullRequest,
  pullRequest,
  repositorySummary,
  resetFactories,
} from "~tests/factories";
import { renderWithProviders } from "~tests/renderWithProviders";
import {
  allMerged,
  pullsPayload,
  server,
  signedInAuth,
  signedOutAuth,
  useAuthStatus,
  useMergeHandler,
  usePulls,
  usePullsError,
} from "~tests/server";

const ORIGIN = "http://localhost:3000";

const readyPr = (): PullRequest =>
  pullRequest({
    id: "pr-ready",
    number: 101,
    title: "Add pagination to the search endpoint",
    repository: repositorySummary({ nameWithOwner: "acme/api" }),
    author: { login: "ada", avatarUrl: null, url: null },
    headSha: "head-101",
    updatedAt: "2026-08-20T10:00:00Z",
  });

const secondReadyPr = (): PullRequest =>
  pullRequest({
    id: "pr-ready-2",
    number: 102,
    title: "Bump dependencies",
    repository: repositorySummary({ nameWithOwner: "acme/web" }),
    author: { login: "grace", avatarUrl: null, url: null },
    headSha: "head-102",
    updatedAt: "2026-08-19T10:00:00Z",
  });

const blockedPr = (): PullRequest =>
  conflictingPullRequest({
    id: "pr-blocked",
    number: 202,
    title: "Rewrite the billing module",
    repository: repositorySummary({ nameWithOwner: "acme/web" }),
    author: { login: "grace", avatarUrl: null, url: null },
    updatedAt: "2026-08-18T10:00:00Z",
  });

async function renderDashboard() {
  const utils = renderWithProviders(<Dashboard />);
  await waitFor(() =>
    expect(screen.queryByText(/Checking your GitHub credentials/)).not.toBeInTheDocument(),
  );
  return utils;
}

/** Wait until the pull request table has replaced the loading skeleton. */
async function waitForTable() {
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
}

beforeEach(() => {
  resetFactories();
});

describe("Dashboard authentication", () => {
  it("shows the token screen when there is no token", async () => {
    useAuthStatus(signedOutAuth);
    await renderDashboard();

    expect(
      screen.getByRole("heading", { name: "Connect your GitHub account" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("signs in with a pasted token and loads the dashboard", async () => {
    useAuthStatus(signedOutAuth);
    usePulls(pullsPayload([readyPr()]));

    let submitted: string | null = null;
    server.use(
      http.post(`${ORIGIN}/api/auth`, async ({ request }) => {
        const body = (await request.json()) as { token: string };
        submitted = body.token;
        return HttpResponse.json(signedInAuth);
      }),
    );

    const { user } = await renderDashboard();

    await user.type(screen.getByLabelText("Personal access token"), "ghp_valid_token_123456789");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitForTable();
    expect(submitted).toBe("ghp_valid_token_123456789");
    expect(screen.getByText("octocat")).toBeInTheDocument();
  });

  it("shows the server error when GitHub rejects the token", async () => {
    useAuthStatus(signedOutAuth);
    server.use(
      http.post(`${ORIGIN}/api/auth`, () =>
        HttpResponse.json(
          { ...signedOutAuth, error: "GitHub rejected that token." },
          { status: 401 },
        ),
      ),
    );

    const { user } = await renderDashboard();

    await user.type(screen.getByLabelText("Personal access token"), "ghp_bad_token_1234567890");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("GitHub rejected that token.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("refuses to submit an empty token without calling the server", async () => {
    useAuthStatus(signedOutAuth);
    let called = false;
    server.use(
      http.post(`${ORIGIN}/api/auth`, () => {
        called = true;
        return HttpResponse.json(signedInAuth);
      }),
    );

    const { user } = await renderDashboard();
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Paste a personal access token to continue.")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("hides sign out when the token is managed by the server", async () => {
    useAuthStatus({ ...signedInAuth, source: "env", managedByServer: true });
    usePulls(pullsPayload([readyPr()]));

    await renderDashboard();
    await waitForTable();

    expect(screen.getByText("server token")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("returns to the token screen after signing out", async () => {
    useAuthStatus(signedInAuth);
    usePulls(pullsPayload([readyPr()]));
    server.use(http.delete(`${ORIGIN}/api/auth`, () => HttpResponse.json(signedOutAuth)));

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { name: "Connect your GitHub account" }),
    ).toBeInTheDocument();
  });
});

describe("Dashboard data display", () => {
  beforeEach(() => {
    useAuthStatus(signedInAuth);
  });

  it("shows a skeleton while loading and then the table", async () => {
    server.use(
      http.get(`${ORIGIN}/api/pulls`, async () => {
        await delay(60);
        return HttpResponse.json(pullsPayload([readyPr()]));
      }),
    );
    await renderDashboard();

    expect(await screen.findByTestId("table-skeleton")).toBeInTheDocument();
    await waitForElementToBeRemoved(() => screen.queryByTestId("table-skeleton"));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("lists every open pull request with its repository, author and status", async () => {
    usePulls(pullsPayload([readyPr(), blockedPr()]));
    await renderDashboard();
    await waitForTable();

    expect(screen.getByRole("link", { name: "acme/api" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#101" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ada" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Conflicts")).toBeInTheDocument();
  });

  it("shows the repository scan summary and the rate limit", async () => {
    usePulls(pullsPayload([readyPr(), blockedPr()]));
    await renderDashboard();
    await waitForTable();

    expect(
      screen.getByText(/2 of 12 repositories have open pull requests/),
    ).toBeInTheDocument();
    expect(screen.getByText("API 4900/5000")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is open", async () => {
    usePulls(pullsPayload([]));
    await renderDashboard();

    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("No open pull requests")).toBeInTheDocument();
  });

  it("shows an error banner with a retry when loading fails", async () => {
    usePullsError(502, "GitHub is having a bad day.");
    const { user } = await renderDashboard();

    expect(await screen.findByText("Could not load pull requests")).toBeInTheDocument();
    expect(screen.getByText("GitHub is having a bad day.")).toBeInTheDocument();

    usePulls(pullsPayload([readyPr()]));
    await user.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));

    await waitForTable();
  });

  it("surfaces per-repository warnings without hiding the data", async () => {
    usePulls(
      pullsPayload([readyPr()], {
        warnings: ["acme/legacy could not be read - your token lost access."],
      }),
    );
    await renderDashboard();
    await waitForTable();

    expect(screen.getByText("Some repositories were skipped")).toBeInTheDocument();
    expect(
      screen.getByText("acme/legacy could not be read - your token lost access."),
    ).toBeInTheDocument();
  });

  it("filters the table by search text", async () => {
    usePulls(pullsPayload([readyPr(), blockedPr()]));
    const { user } = await renderDashboard();
    await waitForTable();

    await user.type(
      screen.getByRole("searchbox", { name: "Search pull requests" }),
      "billing",
    );

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "#101" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "#202" })).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1 of 2 open pull requests");
  });

  it("shows a filtered empty state that can be cleared", async () => {
    usePulls(pullsPayload([readyPr()]));
    const { user } = await renderDashboard();
    await waitForTable();

    await user.type(
      screen.getByRole("searchbox", { name: "Search pull requests" }),
      "zzzz-no-match",
    );

    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();

    await user.click(within(screen.getByTestId("empty-state")).getByRole("button", { name: "Clear filters" }));
    await waitForTable();
  });

  it("refetches with refresh=1 when Refresh is clicked", async () => {
    const requestedUrls: string[] = [];
    server.use(
      http.get(`${ORIGIN}/api/pulls`, ({ request }) => {
        requestedUrls.push(request.url);
        return HttpResponse.json(pullsPayload([readyPr()]));
      }),
    );

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(1));
    expect(requestedUrls.at(-1)).toContain("refresh=1");
  });
});

describe("Dashboard single merge", () => {
  beforeEach(() => {
    useAuthStatus(signedInAuth);
  });

  it("confirms, merges and reports success", async () => {
    usePulls(pullsPayload([readyPr()]));
    const merge = useMergeHandler(() =>
      allMerged([{ owner: "acme", repo: "api", number: 101 }]),
    );

    const { user } = await renderDashboard();
    await waitForTable();

    const row = screen.getByTestId("pr-row-pr-ready");
    await user.click(within(row).getByRole("button", { name: "Merge" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Merge 1 pull request\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/acme\/api#101/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Merge 1" }));

    expect(await screen.findByTestId("merge-summary")).toHaveTextContent(
      "Merged 1 pull request.",
    );
    expect(merge.calls).toHaveLength(1);
    expect(merge.calls[0].items).toEqual([
      { owner: "acme", repo: "api", number: 101, headSha: "head-101" },
    ]);
    expect(merge.calls[0].mergeMethod).toBe("merge");
  });

  it("can be cancelled without calling the API", async () => {
    usePulls(pullsPayload([readyPr()]));
    const merge = useMergeHandler(() => allMerged([]));

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(merge.calls).toHaveLength(0);
  });

  it("uses the selected merge method", async () => {
    usePulls(pullsPayload([readyPr()]));
    const merge = useMergeHandler(() =>
      allMerged([{ owner: "acme", repo: "api", number: 101 }]),
    );

    const { user } = await renderDashboard();
    await waitForTable();

    await user.selectOptions(screen.getByRole("combobox", { name: "Merge method" }), "squash");
    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 1" }),
    );

    await screen.findByTestId("merge-summary");
    expect(merge.calls[0].mergeMethod).toBe("squash");
  });

  it("shows GitHub's refusal under the row that failed", async () => {
    usePulls(pullsPayload([readyPr()]));
    const failure: MergePayload = {
      results: [
        {
          owner: "acme",
          repo: "api",
          number: 101,
          status: "failed",
          message: "GitHub refused the merge: required status checks have not passed.",
          sha: null,
          errorCode: "NOT_MERGEABLE",
          httpStatus: 405,
        },
      ],
      mergedCount: 0,
      failedCount: 1,
    };
    useMergeHandler(() => failure);

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 1" }),
    );

    const summary = await screen.findByTestId("merge-summary");
    expect(summary).toHaveTextContent("Could not merge 1 pull request.");
    expect(summary).toHaveTextContent("required status checks have not passed");

    const resultRow = await screen.findByTestId("pr-result-pr-ready");
    expect(within(resultRow).getByText(/Merge failed \(not mergeable\)/)).toBeInTheDocument();
  });

  it("reports a transport level failure as a banner", async () => {
    usePulls(pullsPayload([readyPr()]));
    server.use(
      http.post(`${ORIGIN}/api/merge`, () =>
        HttpResponse.json({ error: "Add a token before merging.", requiresAuth: true }, { status: 401 }),
      ),
    );

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 1" }),
    );

    expect(await screen.findByText("Merge request failed")).toBeInTheDocument();
    expect(screen.getByText("Add a token before merging.")).toBeInTheDocument();
  });
});

describe("Dashboard bulk merge", () => {
  beforeEach(() => {
    useAuthStatus(signedInAuth);
  });

  it("selects every mergeable row and merges them together", async () => {
    usePulls(pullsPayload([readyPr(), secondReadyPr(), blockedPr()]));
    const merge = useMergeHandler(() =>
      allMerged([
        { owner: "acme", repo: "api", number: 101 },
        { owner: "acme", repo: "web", number: 102 },
      ]),
    );

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 mergeable pull requests in view/ }),
    );

    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Merge selected (2)" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Merge 2 pull requests\?/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Merge 2" }));

    expect(await screen.findByTestId("merge-summary")).toHaveTextContent(
      "Merged 2 pull requests.",
    );

    expect(merge.calls[0].items).toEqual([
      { owner: "acme", repo: "api", number: 101, headSha: "head-101" },
      { owner: "acme", repo: "web", number: 102, headSha: "head-102" },
    ]);
  });

  it("never selects a pull request that cannot be merged", async () => {
    usePulls(pullsPayload([readyPr(), blockedPr()]));
    await renderDashboard();
    await waitForTable();

    const blockedCheckbox = screen.getByRole("checkbox", {
      name: /acme\/web #202 cannot be merged/,
    });
    expect(blockedCheckbox).toBeDisabled();
    expect(blockedCheckbox).not.toBeChecked();
  });

  it("reports a mixed outcome and lists each failure", async () => {
    usePulls(pullsPayload([readyPr(), secondReadyPr()]));
    useMergeHandler(() => ({
      results: [
        {
          owner: "acme",
          repo: "api",
          number: 101,
          status: "merged" as const,
          message: "Pull request successfully merged.",
          sha: "sha-101",
          errorCode: null,
          httpStatus: 200,
        },
        {
          owner: "acme",
          repo: "web",
          number: 102,
          status: "failed" as const,
          message: "The head branch changed after the dashboard loaded.",
          sha: null,
          errorCode: "HEAD_CHANGED" as const,
          httpStatus: 409,
        },
      ],
      mergedCount: 1,
      failedCount: 1,
    }));

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 mergeable pull requests in view/ }),
    );
    await user.click(screen.getByRole("button", { name: "Merge selected (2)" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 2" }),
    );

    const summary = await screen.findByTestId("merge-summary");
    expect(summary).toHaveTextContent("Merged 1 of 2 pull requests, 1 failed.");
    expect(summary).toHaveTextContent("acme/web#102");
    expect(summary).toHaveTextContent("The head branch changed after the dashboard loaded.");
    expect(within(summary).getByRole("button", { name: "Retry failed" })).toBeInTheDocument();
  });

  it("clears the selection on request", async () => {
    usePulls(pullsPayload([readyPr(), secondReadyPr()]));
    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      screen.getByRole("checkbox", { name: /Select all 2 mergeable pull requests in view/ }),
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    await waitFor(() => expect(screen.queryByText("2 selected")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Merge selected$/ })).toBeDisabled();
  });

  it("only selects rows that survive the current filter", async () => {
    usePulls(pullsPayload([readyPr(), secondReadyPr()]));
    const { user } = await renderDashboard();
    await waitForTable();

    await user.selectOptions(screen.getByRole("combobox", { name: "Repository" }), "acme/api");
    await user.click(
      await screen.findByRole("checkbox", { name: /Select all 1 mergeable pull requests in view/ }),
    );

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("dismisses the merge summary", async () => {
    usePulls(pullsPayload([readyPr()]));
    useMergeHandler(() => allMerged([{ owner: "acme", repo: "api", number: 101 }]));

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 1" }),
    );

    const summary = await screen.findByTestId("merge-summary");
    await user.click(within(summary).getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(screen.queryByTestId("merge-summary")).not.toBeInTheDocument());
  });

  it("closes the dialog as soon as the merge answers, without waiting on the refresh", async () => {
    let pullsRequests = 0;
    let releaseRefresh = () => {};
    // The post-merge refresh re-walks every repository, so hold it open and
    // check the dialog is gone while it is still in flight.
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    server.use(
      http.get(`${ORIGIN}/api/pulls`, async () => {
        pullsRequests += 1;
        if (pullsRequests > 1) await refreshHeld;
        return HttpResponse.json(pullsPayload(pullsRequests === 1 ? [readyPr()] : []));
      }),
    );
    useMergeHandler(() => allMerged([{ owner: "acme", repo: "api", number: 101 }]));

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 1" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByTestId("merge-summary")).toHaveTextContent(
      "Merged 1 pull request.",
    );
    expect(pullsRequests).toBe(2);

    releaseRefresh();
    await screen.findByTestId("empty-state");
  });

  it("removes merged rows immediately and keeps them out of a stale refresh", async () => {
    // GitHub's open pull request list is eventually consistent, so the refresh
    // right after a merge can still report the pull request as open.
    usePulls(pullsPayload([readyPr(), secondReadyPr()]));
    useMergeHandler(() => allMerged([{ owner: "acme", repo: "api", number: 101 }]));

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 1" }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId("pr-row-pr-ready")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("pr-row-pr-ready-2")).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1 of 1 open pull request");
  });

  it("refreshes the list after a merge completes", async () => {
    let pullsRequests = 0;
    server.use(
      http.get(`${ORIGIN}/api/pulls`, () => {
        pullsRequests += 1;
        return HttpResponse.json(
          pullsPayload(pullsRequests === 1 ? [readyPr()] : []),
        );
      }),
    );
    useMergeHandler(() => allMerged([{ owner: "acme", repo: "api", number: 101 }]));

    const { user } = await renderDashboard();
    await waitForTable();

    await user.click(
      within(screen.getByTestId("pr-row-pr-ready")).getByRole("button", { name: "Merge" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge 1" }),
    );

    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
    expect(pullsRequests).toBeGreaterThan(1);
  });
});
