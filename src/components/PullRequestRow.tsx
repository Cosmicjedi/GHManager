"use client";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  cn,
  formatAbsoluteTime,
  formatDiff,
  formatRelativeTime,
  readableTextColor,
} from "@/lib/format";
import type { ChecksSummary, MergeResult, PullRequest, ReviewDecision } from "@/lib/types";

export interface PullRequestRowProps {
  pullRequest: PullRequest;
  selected: boolean;
  onToggleSelected: (id: string, selected: boolean) => void;
  onMerge: (pullRequest: PullRequest) => void;
  isMerging: boolean;
  /** Result of the most recent merge attempt for this row, if any. */
  result: MergeResult | null;
}

const CHECK_TONES: Record<ChecksSummary["state"], BadgeTone> = {
  SUCCESS: "positive",
  FAILURE: "negative",
  ERROR: "negative",
  PENDING: "warning",
  EXPECTED: "warning",
  NONE: "neutral",
};

const CHECK_LABELS: Record<ChecksSummary["state"], string> = {
  SUCCESS: "Checks passing",
  FAILURE: "Checks failing",
  ERROR: "Checks errored",
  PENDING: "Checks running",
  EXPECTED: "Checks expected",
  NONE: "No checks",
};

const REVIEW_TONES: Record<ReviewDecision, BadgeTone> = {
  APPROVED: "positive",
  CHANGES_REQUESTED: "negative",
  REVIEW_REQUIRED: "warning",
};

const REVIEW_LABELS: Record<ReviewDecision, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

const MERGEABILITY_TONES: Record<PullRequest["mergeability"]["tone"], BadgeTone> = {
  positive: "positive",
  negative: "negative",
  warning: "warning",
  neutral: "neutral",
};

function checksDetail(checks: ChecksSummary): string {
  if (checks.total === 0) return "No status checks are configured for this commit.";
  const parts = [`${checks.total} total`];
  if (checks.success) parts.push(`${checks.success} passing`);
  if (checks.failure) parts.push(`${checks.failure} failing`);
  if (checks.pending) parts.push(`${checks.pending} running`);
  if (checks.skipped) parts.push(`${checks.skipped} skipped or neutral`);
  return parts.join(", ");
}

export function PullRequestRow({
  pullRequest,
  selected,
  onToggleSelected,
  onMerge,
  isMerging,
  result,
}: PullRequestRowProps) {
  const selectable = pullRequest.mergeability.canMerge;
  const failed = result?.status === "failed";
  const merged = result?.status === "merged";

  return (
    <>
      <tr
        data-testid={`pr-row-${pullRequest.id}`}
        className={cn(
          "border-t border-border align-top transition-colors",
          selected ? "bg-accent-soft/45" : "hover:bg-surface-muted/70",
          merged && "opacity-60",
        )}
      >
        <td className="w-10 py-3 pr-2 pl-4">
          <Checkbox
            checked={selected}
            disabled={!selectable || isMerging || merged}
            onChange={(event) => onToggleSelected(pullRequest.id, event.target.checked)}
            label={
              selectable
                ? `Select ${pullRequest.repository.nameWithOwner} #${pullRequest.number}`
                : `${pullRequest.repository.nameWithOwner} #${pullRequest.number} cannot be merged: ${pullRequest.mergeability.reason}`
            }
          />
        </td>

        <td className="max-w-[16rem] py-3 pr-4">
          <a
            href={pullRequest.repository.url}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate text-sm font-medium text-fg hover:text-accent hover:underline"
            title={pullRequest.repository.nameWithOwner}
          >
            {pullRequest.repository.nameWithOwner}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {pullRequest.repository.isPrivate ? (
              <Badge tone="neutral" title="Private repository">
                private
              </Badge>
            ) : null}
            {pullRequest.repository.isFork ? (
              <Badge tone="neutral" title="Fork">
                fork
              </Badge>
            ) : null}
            <span className="font-mono text-[11px] text-fg-subtle" title="Base branch">
              {pullRequest.baseRefName}
            </span>
          </div>
        </td>

        <td className="min-w-[22rem] py-3 pr-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium text-fg hover:text-accent hover:underline"
            >
              {pullRequest.title}
            </a>
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs text-fg-subtle hover:text-accent"
            >
              #{pullRequest.number}
            </a>
            {pullRequest.isDraft ? <Badge tone="neutral">draft</Badge> : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="font-mono" title={`Head branch: ${pullRequest.headRefName}`}>
              {pullRequest.headRefName}
            </span>
            <span title={`${pullRequest.changedFiles} files changed`}>
              {formatDiff(pullRequest.additions, pullRequest.deletions)}
            </span>
            <span title={formatAbsoluteTime(pullRequest.updatedAt)}>
              updated {formatRelativeTime(pullRequest.updatedAt)}
            </span>
          </div>

          {pullRequest.labels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {pullRequest.labels.slice(0, 6).map((label) => (
                <span
                  key={label.name}
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: `#${label.color}`,
                    color: readableTextColor(label.color),
                  }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
        </td>

        <td className="py-3 pr-4">
          {pullRequest.author ? (
            <a
              href={pullRequest.author.url ?? `https://github.com/${pullRequest.author.login}`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-2 text-sm text-fg hover:text-accent"
            >
              {pullRequest.author.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={pullRequest.author.avatarUrl}
                  alt=""
                  width={20}
                  height={20}
                  className="size-5 shrink-0 rounded-full"
                />
              ) : null}
              <span className="truncate">{pullRequest.author.login}</span>
            </a>
          ) : (
            <span className="text-sm text-fg-subtle">unknown</span>
          )}
        </td>

        <td className="py-3 pr-4">
          <div className="flex flex-col items-start gap-1.5">
            <Badge
              tone={MERGEABILITY_TONES[pullRequest.mergeability.tone]}
              title={pullRequest.mergeability.reason}
            >
              {pullRequest.mergeability.label}
            </Badge>
            <Badge tone={CHECK_TONES[pullRequest.checks.state]} title={checksDetail(pullRequest.checks)}>
              {CHECK_LABELS[pullRequest.checks.state]}
              {pullRequest.checks.total > 0
                ? ` ${pullRequest.checks.success}/${pullRequest.checks.total}`
                : ""}
            </Badge>
            {pullRequest.reviewDecision ? (
              <Badge tone={REVIEW_TONES[pullRequest.reviewDecision]}>
                {REVIEW_LABELS[pullRequest.reviewDecision]}
              </Badge>
            ) : null}
          </div>
        </td>

        <td className="py-3 pr-4 pl-2 text-right">
          <Button
            size="sm"
            variant={selectable ? "primary" : "secondary"}
            onClick={() => onMerge(pullRequest)}
            loading={isMerging}
            disabled={!pullRequest.viewerCanMerge || merged}
            title={
              merged
                ? "Already merged in this session."
                : pullRequest.viewerCanMerge
                  ? pullRequest.mergeability.reason
                  : "Your token cannot merge in this repository."
            }
          >
            {merged ? "Merged" : isMerging ? "Merging" : "Merge"}
          </Button>
        </td>
      </tr>

      {result ? (
        <tr
          data-testid={`pr-result-${pullRequest.id}`}
          className={cn(
            "border-t border-dashed",
            failed ? "bg-danger-soft/60" : "bg-success-soft/60",
          )}
        >
          <td />
          <td colSpan={5} className="px-1 py-2 pr-4">
            <p className={cn("text-sm", failed ? "text-danger" : "text-success")}>
              <span className="font-semibold">
                {failed ? "Merge failed" : "Merged"}
                {result.errorCode ? ` (${result.errorCode.toLowerCase().replace(/_/g, " ")})` : ""}
                {": "}
              </span>
              {result.message}
              {result.sha ? (
                <span className="ml-1 font-mono text-xs">{result.sha.slice(0, 7)}</span>
              ) : null}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
