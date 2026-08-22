"use client";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/format";

export type BannerTone = "error" | "warning" | "info" | "success";

const TONES: Record<BannerTone, string> = {
  error: "border-danger/35 bg-danger-soft text-danger",
  warning: "border-warning/35 bg-warning-soft text-warning",
  info: "border-accent/30 bg-accent-soft text-accent",
  success: "border-success/35 bg-success-soft text-success",
};

const ICONS: Record<BannerTone, string> = {
  error: "!",
  warning: "!",
  info: "i",
  success: "✓",
};

export function Banner({
  tone = "info",
  title,
  children,
  onRetry,
  retryLabel = "Try again",
  onDismiss,
  className,
}: {
  tone?: BannerTone;
  title?: string;
  children?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", TONES[tone], className)}
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold"
      >
        {ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "text-fg")}>{children}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
        {onDismiss ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="px-2 text-current"
          >
            ✕
          </Button>
        ) : null}
      </div>
    </div>
  );
}
