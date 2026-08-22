"use client";

import { Button } from "@/components/ui/Button";
import { cn, pluralise } from "@/lib/format";
import type { MergePayload } from "@/lib/types";

export interface MergeSummaryProps {
  payload: MergePayload;
  onDismiss: () => void;
  onRetryFailed?: () => void;
}

/** Result panel shown after a single or bulk merge finishes. */
export function MergeSummary({ payload, onDismiss, onRetryFailed }: MergeSummaryProps) {
  const { mergedCount, failedCount, results } = payload;
  const failures = results.filter((result) => result.status === "failed");
  const tone = failedCount === 0 ? "success" : mergedCount === 0 ? "error" : "warning";

  const toneClasses = {
    success: "border-success/35 bg-success-soft",
    warning: "border-warning/35 bg-warning-soft",
    error: "border-danger/35 bg-danger-soft",
  }[tone];

  const headline =
    failedCount === 0
      ? `Merged ${pluralise(mergedCount, "pull request")}.`
      : mergedCount === 0
        ? `Could not merge ${pluralise(failedCount, "pull request")}.`
        : `Merged ${mergedCount} of ${results.length} pull requests, ${failedCount} failed.`;

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="merge-summary"
      className={cn("rounded-2xl border px-4 py-3", toneClasses)}
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-fg">{headline}</p>
        <div className="ml-auto flex items-center gap-2">
          {failedCount > 0 && onRetryFailed ? (
            <Button size="sm" variant="secondary" onClick={onRetryFailed}>
              Retry failed
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>

      {failures.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-current/15 pt-3">
          {failures.map((failure) => (
            <li
              key={`${failure.owner}/${failure.repo}#${failure.number}`}
              className="text-sm text-fg"
            >
              <span className="font-mono text-xs text-fg-muted">
                {failure.owner}/{failure.repo}#{failure.number}
              </span>{" "}
              <span className="text-danger">{failure.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
