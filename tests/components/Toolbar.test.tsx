import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toolbar } from "@/components/Toolbar";
import { DEFAULT_FILTERS } from "@/lib/filters";
import { renderWithProviders } from "~tests/renderWithProviders";

function renderToolbar(overrides: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
  const props: React.ComponentProps<typeof Toolbar> = {
    filters: DEFAULT_FILTERS,
    onFiltersChange: vi.fn(),
    repositories: ["acme/api", "acme/web"],
    authors: ["ada", "grace"],
    totalCount: 8,
    visibleCount: 5,
    selectedCount: 0,
    filtersActive: false,
    onClearFilters: vi.fn(),
    mergeMethod: "merge",
    onMergeMethodChange: vi.fn(),
    allowedMergeMethods: ["merge", "squash", "rebase"],
    onMergeSelected: vi.fn(),
    onClearSelection: vi.fn(),
    isMerging: false,
    ...overrides,
  };

  return { props, ...renderWithProviders(<Toolbar {...props} />) };
}

describe("Toolbar", () => {
  it("summarises how many pull requests are visible", () => {
    renderToolbar();
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 5 of 8 open pull requests");
  });

  it("shows the selected count when rows are selected", () => {
    renderToolbar({ selectedCount: 3 });
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("emits a new filter state as the user types a search", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.type(screen.getByRole("searchbox", { name: "Search pull requests" }), "b");

    expect(props.onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, search: "b" });
  });

  it("emits a repository filter change", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.selectOptions(screen.getByRole("combobox", { name: "Repository" }), "acme/web");

    expect(props.onFiltersChange).toHaveBeenCalledWith({
      ...DEFAULT_FILTERS,
      repository: "acme/web",
    });
  });

  it("emits an author filter change", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.selectOptions(screen.getByRole("combobox", { name: "Author" }), "grace");

    expect(props.onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, author: "grace" });
  });

  it("emits a readiness filter change", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.selectOptions(screen.getByRole("combobox", { name: "Readiness" }), "ready");

    expect(props.onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, readiness: "ready" });
  });

  it("emits a sort change", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "author");

    expect(props.onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, sort: "author" });
  });

  it("toggles the hide drafts option", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.click(screen.getByLabelText("Hide drafts"));

    expect(props.onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, hideDrafts: true });
  });

  it("lists every repository and author as an option", () => {
    renderToolbar();

    const repositorySelect = screen.getByRole("combobox", { name: "Repository" });
    expect(repositorySelect).toHaveTextContent("All repositories (2)");
    expect(repositorySelect).toHaveTextContent("acme/api");
    expect(repositorySelect).toHaveTextContent("acme/web");

    expect(screen.getByRole("combobox", { name: "Author" })).toHaveTextContent("All authors (2)");
  });

  it("offers Clear filters only when a filter is active", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderToolbar();

    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    rerender(<Toolbar {...props} filtersActive />);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(props.onClearFilters).toHaveBeenCalled();
  });

  it("disables Merge selected until something is selected", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: /Merge selected/ })).toBeDisabled();
  });

  it("enables Merge selected and shows the count", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar({ selectedCount: 4 });

    const button = screen.getByRole("button", { name: "Merge selected (4)" });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(props.onMergeSelected).toHaveBeenCalled();
  });

  it("shows a merging state while a bulk merge runs", () => {
    renderToolbar({ selectedCount: 2, isMerging: true });

    expect(screen.getByRole("button", { name: /Merging 2 pull requests/ })).toBeDisabled();
  });

  it("offers Clear selection only when rows are selected", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderToolbar();

    expect(screen.queryByRole("button", { name: "Clear selection" })).not.toBeInTheDocument();

    rerender(<Toolbar {...props} selectedCount={2} />);
    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(props.onClearSelection).toHaveBeenCalled();
  });

  it("emits the chosen merge method", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.selectOptions(screen.getByRole("combobox", { name: "Merge method" }), "squash");

    expect(props.onMergeMethodChange).toHaveBeenCalledWith("squash");
  });

  it("disables merge methods that are not allowed everywhere in the selection", () => {
    renderToolbar({ allowedMergeMethods: ["merge"] });

    const options = screen.getAllByRole("option", { name: /merge/i });
    const rebase = options.find((option) => (option as HTMLOptionElement).value === "rebase");

    expect(rebase).toBeDisabled();
    expect(rebase).toHaveTextContent("not allowed everywhere");
  });
});
