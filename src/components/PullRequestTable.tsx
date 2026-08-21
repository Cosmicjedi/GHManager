"use client";

import { PullRequestRow } from "@/components/PullRequestRow";
import { Checkbox } from "@/components/ui/Checkbox";
import type { MergeResult, PullRequest } from "@/lib/types";

export interface PullRequestTableProps {
  pullRequests: PullRequest[];
  selectedIds: ReadonlySet<string>;
  onToggleSelected: (id: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onMerge: (pullRequest: PullRequest) => void;
  mergingIds: ReadonlySet<string>;
  results: ReadonlyMap<string, MergeResult>;
}

const HEADERS = ["Repository", "Pull request", "Author", "Mergeability"];

export function PullRequestTable({
  pullRequests,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  onMerge,
  mergingIds,
  results,
}: PullRequestTableProps) {
  const selectable = pullRequests.filter((pullRequest) => pullRequest.mergeability.canMerge);
  const selectedSelectable = selectable.filter((pullRequest) => selectedIds.has(pullRequest.id));
  const allSelected = selectable.length > 0 && selectedSelectable.length === selectable.length;
  const someSelected = selectedSelectable.length > 0 && !allSelected;

  return (
    <div className="scroll-area overflow-x-auto rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
      <table className="w-full min-w-[64rem] border-collapse text-left">
        <caption className="sr-only">
          Open pull requests across every repository your token can access
        </caption>
        <thead>
          <tr className="bg-surface-muted text-xs font-semibold tracking-wide text-fg-muted uppercase">
            <th scope="col" className="w-10 py-2.5 pr-2 pl-4">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                disabled={selectable.length === 0}
                onChange={(event) => onToggleAll(event.target.checked)}
                label={
                  selectable.length === 0
                    ? "No pull requests in view can be merged"
                    : allSelected
                      ? "Deselect all mergeable pull requests"
                      : `Select all ${selectable.length} mergeable pull requests in view`
                }
              />
            </th>
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="py-2.5 pr-4 font-semibold">
                {header}
              </th>
            ))}
            <th scope="col" className="py-2.5 pr-4 pl-2 text-right font-semibold">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {pullRequests.map((pullRequest) => (
            <PullRequestRow
              key={pullRequest.id}
              pullRequest={pullRequest}
              selected={selectedIds.has(pullRequest.id)}
              onToggleSelected={onToggleSelected}
              onMerge={onMerge}
              isMerging={mergingIds.has(pullRequest.id)}
              result={results.get(pullRequest.id) ?? null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
