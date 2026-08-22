import { cn } from "@/lib/format";

export type BadgeTone = "positive" | "negative" | "warning" | "neutral" | "accent";

const TONES: Record<BadgeTone, string> = {
  positive: "bg-success-soft text-success border-success/25",
  negative: "bg-danger-soft text-danger border-danger/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  neutral: "bg-neutral-soft text-fg-muted border-border",
  accent: "bg-accent-soft text-accent border-accent/25",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
  icon,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
