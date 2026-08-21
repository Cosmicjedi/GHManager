import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestTable } from "@/components/PullRequestTable";
import type { MergeResult, PullRequest } from "@/lib/types";
import {
  conflictingPullRequest,
  pullRequest,
  repositorySummary,
  resetFactories,
} from "~tests/factories";
import { renderWithProviders } from "~tests/renderWithProviders";

const ready = () =>
  pullRequest({
    id: "pr-ready",
    number: 101,
    title: "Add pagination to the search endpoint",
    repository: repositorySummary({ nameWithOwner: "acme/api" }),
    author: { login: "ada", avatarUrl: null, url: "https://github.com/ada" },
  });

const blocked = () =>
  conflictingPullRequest({
    id: "pr-blocked",
    number: 202,
    title: "Rewrite the billing module",
    repository: repositorySummary({ nameWithOwner: "acme/web" }),
    author: { login: "grace", avatarUrl: null, url: null },
  });

function renderTable(overrides: Partial<React.ComponentProps<typeof PullRequestTable>> = {}) {
  const props: React.ComponentProps<typeof PullRequestTable> = {
    pullRequests: [ready(), blocked()],
    selectedIds: new Set<string>(),
    onToggleSelected: vi.fn(),
    onToggleAll: vi.fn(),
    onMerge: vi.fn(),
    mergingIds: new Set<string>(),
    results: new Map<string, MergeResult>(),
    ...overrides,
  };

  return { props, ...renderWithProviders(<PullRequestTable {...props} />) };
}

beforeEach(() => {
  resetFactories();
});

describe("PullRequestTable", () => {
  it("shows repository, title, number, author and mergeability for each row", () => {
    renderTable();

    expect(screen.getByRole("link", { name: "acme/api" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add pagination to the search endpoint" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#101" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ada" })).toBeInTheDocument();

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Conflicts")).toBeInTheDocument();
    expect(screen.getByText(/Checks passing/)).toBeInTheDocument();
    expect(screen.getByText(/Checks failing/)).toBeInTheDocument();
  });

  it("links the title and number to the pull request on GitHub", () => {
    renderTable();

    const link = screen.getByRole("link", { name: "Add pagination to the search endpoint" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/api/pull/101");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("enables the checkbox only for pull requests that can be merged", () => {
    renderTable();

    expect(
      screen.getByRole("checkbox", { name: /Select acme\/api #101/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /acme\/web #202 cannot be merged/ }),
    ).toBeDisabled();
  });

  it("reports a row selection through onToggleSelected", async () => {
    const user = userEvent.setup();
    const { props } = renderTable();

    await user.click(screen.getByRole("checkbox", { name: /Select acme\/api #101/ }));

    expect(props.onToggleSelected).toHaveBeenCalledWith("pr-ready", true);
  });

  it("reports a deselection through onToggleSelected", async () => {
    const user = userEvent.setup();
    const { props } = renderTable({ selectedIds: new Set(["pr-ready"]) });

    await user.click(screen.getByRole("checkbox", { name: /Select acme\/api #101/ }));

    expect(props.onToggleSelected).toHaveBeenCalledWith("pr-ready", false);
  });

  it("offers a select-all box that counts only mergeable rows", async () => {
    const user = userEvent.setup();
    const { props } = renderTable();

    const selectAll = screen.getByRole("checkbox", {
      name: /Select all 1 mergeable pull requests in view/,
    });
    await user.click(selectAll);

    expect(props.onToggleAll).toHaveBeenCalledWith(true);
  });

  it("checks the select-all box when every mergeable row is selected", () => {
    renderTable({ selectedIds: new Set(["pr-ready"]) });

    expect(
      screen.getByRole("checkbox", { name: /Deselect all mergeable pull requests/ }),
    ).toBeChecked();
  });

  it("shows the select-all box as indeterminate on a partial selection", () => {
    const first = pullRequest({ id: "a", number: 1 });
    const second = pullRequest({ id: "b", number: 2 });

    renderTable({
      pullRequests: [first, second],
      selectedIds: new Set(["a"]),
    });

    const selectAll = screen.getByRole("checkbox", {
      name: /Select all 2 mergeable pull requests in view/,
    }) as HTMLInputElement;

    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.checked).toBe(false);
  });

  it("disables the select-all box when nothing in view can be merged", () => {
    renderTable({ pullRequests: [blocked()] });

    expect(
      screen.getByRole("checkbox", { name: /No pull requests in view can be merged/ }),
    ).toBeDisabled();
  });

  it("calls onMerge with the row's pull request", async () => {
    const user = userEvent.setup();
    const { props } = renderTable();

    const row = screen.getByTestId("pr-row-pr-ready");
    await user.click(within(row).getByRole("button", { name: "Merge" }));

    expect(props.onMerge).toHaveBeenCalledTimes(1);
    expect((props.onMerge as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      id: "pr-ready",
      number: 101,
    });
  });

  it("still offers a merge button for a conflicting pull request the viewer owns", () => {
    renderTable();

    const row = screen.getByTestId("pr-row-pr-blocked");
    expect(within(row).getByRole("button", { name: "Merge" })).toBeEnabled();
  });

  it("disables the merge button when the viewer has no write access", () => {
    const readOnly = pullRequest({
      id: "pr-readonly",
      number: 9,
      viewerCanMerge: false,
      repository: repositorySummary({ viewerPermission: "READ" }),
      mergeability: {
        canMerge: false,
        label: "No write access",
        reason: "Your token does not grant write access to this repository.",
        tone: "neutral",
      },
    });

    renderTable({ pullRequests: [readOnly] });

    const row = screen.getByTestId("pr-row-pr-readonly");
    expect(within(row).getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("shows a busy state on the row being merged", () => {
    renderTable({ mergingIds: new Set(["pr-ready"]) });

    const row = screen.getByTestId("pr-row-pr-ready");
    expect(within(row).getByRole("button", { name: "Merging" })).toBeDisabled();
  });

  it("renders a failure message under the row that failed", () => {
    const results = new Map<string, MergeResult>([
      [
        "pr-blocked",
        {
          owner: "acme",
          repo: "web",
          number: 202,
          status: "failed",
          message: "Merge conflict: base and head are incompatible.",
          sha: null,
          errorCode: "CONFLICT",
          httpStatus: 409,
        },
      ],
    ]);

    renderTable({ results });

    const resultRow = screen.getByTestId("pr-result-pr-blocked");
    expect(within(resultRow).getByText(/Merge failed \(conflict\)/)).toBeInTheDocument();
    expect(
      within(resultRow).getByText(/base and head are incompatible/),
    ).toBeInTheDocument();
  });

  it("marks a merged row as merged and disables its button", () => {
    const results = new Map<string, MergeResult>([
      [
        "pr-ready",
        {
          owner: "acme",
          repo: "api",
          number: 101,
          status: "merged",
          message: "Pull request successfully merged.",
          sha: "abcdef1234567",
          errorCode: null,
          httpStatus: 200,
        },
      ],
    ]);

    renderTable({ results });

    const row = screen.getByTestId("pr-row-pr-ready");
    expect(within(row).getByRole("button", { name: "Merged" })).toBeDisabled();
    expect(within(row).getByRole("checkbox")).toBeDisabled();

    const resultRow = screen.getByTestId("pr-result-pr-ready");
    expect(within(resultRow).getByText("abcdef1")).toBeInTheDocument();
  });

  it("renders labels with readable contrast", () => {
    const labelled = pullRequest({
      id: "pr-labels",
      labels: [
        { name: "bug", color: "d73a4a" },
        { name: "good first issue", color: "7057ff" },
      ],
    });

    renderTable({ pullRequests: [labelled] });

    expect(screen.getByText("bug")).toHaveStyle({ backgroundColor: "#d73a4a" });
    expect(screen.getByText("good first issue")).toBeInTheDocument();
  });

  it("renders an empty table body when there is nothing to show", () => {
    renderTable({ pullRequests: [] });

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
  });
});

function typedPullRequests(): PullRequest[] {
  return [ready(), blocked()];
}

describe("PullRequestTable accessibility", () => {
  it("labels the table for screen readers", () => {
    renderTable({ pullRequests: typedPullRequests() });

    expect(
      screen.getByRole("table", {
        name: /Open pull requests across every repository your token can access/,
      }),
    ).toBeInTheDocument();
  });

  it("exposes a column header for every displayed field", () => {
    renderTable();

    for (const header of ["Repository", "Pull request", "Author", "Mergeability", "Action"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });
});
