"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { pluralise } from "@/lib/format";
import type { MergeMethod, PullRequest } from "@/lib/types";

export interface ConfirmMergeDialogProps {
  pullRequests: PullRequest[];
  mergeMethod: MergeMethod;
  isMerging: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const METHOD_LABELS: Record<MergeMethod, string> = {
  merge: "merge commit",
  squash: "squash and merge",
  rebase: "rebase and merge",
};

/**
 * Merging is not something you can undo with a click, so both the single-row
 * button and the bulk action route through this confirmation.
 */
export function ConfirmMergeDialog({
  pullRequests,
  mergeMethod,
  isMerging,
  onConfirm,
  onCancel,
}: ConfirmMergeDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isMerging) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMerging, onCancel]);

  const unsupported = pullRequests.filter(
    (pullRequest) => !pullRequest.repository.allowedMergeMethods.includes(mergeMethod),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--overlay)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-md)]"
      >
        <h2 id={titleId} className="text-base font-semibold text-fg">
          Merge {pluralise(pullRequests.length, "pull request")}?
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          GHManager will use <span className="font-medium text-fg">{METHOD_LABELS[mergeMethod]}</span>{" "}
          on each one. This writes to GitHub straight away and cannot be undone from here.
        </p>

        <ul className="scroll-area mt-4 max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-surface-muted p-3">
          {pullRequests.map((pullRequest) => (
            <li key={pullRequest.id} className="text-sm text-fg">
              <span className="font-mono text-xs text-fg-muted">
                {pullRequest.repository.nameWithOwner}#{pullRequest.number}
              </span>{" "}
              {pullRequest.title}
            </li>
          ))}
        </ul>

        {unsupported.length > 0 ? (
          <p className="mt-3 text-sm text-warning">
            {pluralise(unsupported.length, "repository", "repositories")} in this selection
            {unsupported.length === 1 ? " does" : " do"} not allow {METHOD_LABELS[mergeMethod]}.
            Those merges will be reported as failures.
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isMerging}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant="primary" onClick={onConfirm} loading={isMerging}>
            {isMerging ? "Merging" : `Merge ${pullRequests.length}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
