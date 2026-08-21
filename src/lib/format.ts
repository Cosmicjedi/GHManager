/** Small presentation helpers shared across the dashboard components. */

/** Join conditional class names. */
export function cn(...values: unknown[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

const RELATIVE_UNITS: Array<{ limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60_000, divisor: 1_000, unit: "second" },
  { limit: 3_600_000, divisor: 60_000, unit: "minute" },
  { limit: 86_400_000, divisor: 3_600_000, unit: "hour" },
  { limit: 2_592_000_000, divisor: 86_400_000, unit: "day" },
  { limit: 31_536_000_000, divisor: 2_592_000_000, unit: "month" },
  { limit: Number.POSITIVE_INFINITY, divisor: 31_536_000_000, unit: "year" },
];

/**
 * Format an ISO timestamp as "3 hours ago". `now` is injectable so tests do
 * not depend on the wall clock.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown";

  const deltaMs = timestamp - now;
  const absolute = Math.abs(deltaMs);

  if (absolute < 45_000) return "just now";

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const { limit, divisor, unit } of RELATIVE_UNITS) {
    if (absolute < limit) {
      return formatter.format(Math.round(deltaMs / divisor), unit);
    }
  }

  return "unknown";
}

/** Absolute timestamp for tooltips. */
export function formatAbsoluteTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown";
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "1 pull request" / "4 pull requests". */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Decide whether black or white text is readable on a GitHub label colour. */
export function readableTextColor(hex: string): string {
  const normalised = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalised)) return "#ffffff";

  const r = Number.parseInt(normalised.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalised.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalised.slice(4, 6), 16) / 255;

  const channel = (value: number): number =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.45 ? "#101820" : "#ffffff";
}

/** Compact diff summary, e.g. "+120 / -8". */
export function formatDiff(additions: number, deletions: number): string {
  return `+${additions.toLocaleString()} / -${deletions.toLocaleString()}`;
}
