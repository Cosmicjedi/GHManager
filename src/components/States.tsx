"use client";

import { Button } from "@/components/ui/Button";

/** Skeleton shown while the first pull request load is in flight. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      data-testid="table-skeleton"
      role="status"
      aria-label="Loading pull requests"
      className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]"
    >
      <div className="h-10 border-b border-border bg-surface-muted" />
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-4">
            <span className="size-4 shrink-0 rounded bg-neutral-soft animate-ghm-pulse" />
            <span className="h-3.5 w-40 shrink-0 rounded bg-neutral-soft animate-ghm-pulse" />
            <span className="h-3.5 flex-1 rounded bg-neutral-soft animate-ghm-pulse" />
            <span className="h-3.5 w-24 shrink-0 rounded bg-neutral-soft animate-ghm-pulse" />
            <span className="h-6 w-24 shrink-0 rounded-full bg-neutral-soft animate-ghm-pulse" />
            <span className="h-8 w-20 shrink-0 rounded-md bg-neutral-soft animate-ghm-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-16 text-center"
    >
      <span
        aria-hidden
        className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-muted text-xl text-fg-subtle"
      >
        ✓
      </span>
      <p className="text-base font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>
      {actionLabel && onAction ? (
        <Button variant="secondary" className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
