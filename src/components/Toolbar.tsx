"use client";

import { Button } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Field";
import {
  type FilterState,
  READINESS_OPTIONS,
  type ReadinessFilter,
  SORT_OPTIONS,
  type SortKey,
} from "@/lib/filters";
import { pluralise } from "@/lib/format";
import type { MergeMethod } from "@/lib/types";

export interface ToolbarProps {
  filters: FilterState;
  onFiltersChange: (next: FilterState) => void;
  repositories: string[];
  authors: string[];
  totalCount: number;
  visibleCount: number;
  selectedCount: number;
  filtersActive: boolean;
  onClearFilters: () => void;
  mergeMethod: MergeMethod;
  onMergeMethodChange: (next: MergeMethod) => void;
  allowedMergeMethods: MergeMethod[];
  onMergeSelected: () => void;
  onClearSelection: () => void;
  isMerging: boolean;
}

const METHOD_LABELS: Record<MergeMethod, string> = {
  merge: "Create a merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

export function Toolbar({
  filters,
  onFiltersChange,
  repositories,
  authors,
  totalCount,
  visibleCount,
  selectedCount,
  filtersActive,
  onClearFilters,
  mergeMethod,
  onMergeMethodChange,
  allowedMergeMethods,
  onMergeSelected,
  onClearSelection,
  isMerging,
}: ToolbarProps) {
  function update<Key extends keyof FilterState>(key: Key, value: FilterState[Key]) {
    onFiltersChange({ ...filters, [key]: value });
  }

  return (
    <section
      aria-label="Filters and bulk actions"
      className="rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <TextInput
          label="Search pull requests"
          labelHidden
          type="search"
          placeholder="Search title, repo, author, branch or #number"
          value={filters.search}
          onChange={(event) => update("search", event.target.value)}
          leading={<span aria-hidden>⌕</span>}
        />

        <Select
          label="Repository"
          labelHidden
          value={filters.repository}
          onChange={(event) => update("repository", event.target.value)}
          options={[
            { value: "", label: `All repositories (${repositories.length})` },
            ...repositories.map((repository) => ({ value: repository, label: repository })),
          ]}
        />

        <Select
          label="Author"
          labelHidden
          value={filters.author}
          onChange={(event) => update("author", event.target.value)}
          options={[
            { value: "", label: `All authors (${authors.length})` },
            ...authors.map((author) => ({ value: author, label: author })),
          ]}
        />

        <Select
          label="Readiness"
          labelHidden
          value={filters.readiness}
          onChange={(event) => update("readiness", event.target.value as ReadinessFilter)}
          options={READINESS_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />

        <Select
          label="Sort by"
          labelHidden
          value={filters.sort}
          onChange={(event) => update("sort", event.target.value as SortKey)}
          options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            className="size-4 cursor-pointer rounded border-border-strong accent-[var(--accent)]"
            checked={filters.hideDrafts}
            onChange={(event) => update("hideDrafts", event.target.checked)}
          />
          Hide drafts
        </label>

        <p className="text-sm text-fg-muted" aria-live="polite">
          Showing <span className="font-medium text-fg">{visibleCount}</span> of{" "}
          {pluralise(totalCount, "open pull request")}
          {selectedCount > 0 ? (
            <>
              {" · "}
              <span className="font-medium text-accent">{selectedCount} selected</span>
            </>
          ) : null}
        </p>

        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selectedCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              Clear selection
            </Button>
          ) : null}

          <label className="sr-only" htmlFor="merge-method">
            Merge method
          </label>
          <select
            id="merge-method"
            value={mergeMethod}
            onChange={(event) => onMergeMethodChange(event.target.value as MergeMethod)}
            className="h-9 cursor-pointer rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg focus:border-accent focus:outline-none"
          >
            {(["merge", "squash", "rebase"] as MergeMethod[]).map((method) => (
              <option
                key={method}
                value={method}
                disabled={!allowedMergeMethods.includes(method)}
              >
                {METHOD_LABELS[method]}
                {allowedMergeMethods.includes(method) ? "" : " (not allowed everywhere)"}
              </option>
            ))}
          </select>

          <Button
            variant="primary"
            onClick={onMergeSelected}
            disabled={selectedCount === 0}
            loading={isMerging}
          >
            {isMerging
              ? `Merging ${pluralise(selectedCount, "pull request")}`
              : `Merge selected${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
          </Button>
        </div>
      </div>
    </section>
  );
}
