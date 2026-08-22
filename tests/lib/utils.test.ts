import { describe, expect, it, vi } from "vitest";
import { chunk, mapWithConcurrency } from "@/lib/concurrency";
import {
  cn,
  formatAbsoluteTime,
  formatDiff,
  formatRelativeTime,
  pluralise,
  readableTextColor,
} from "@/lib/format";
import { TtlCache, tokenFingerprint } from "@/lib/server/cache";

describe("cn", () => {
  it("joins truthy class names and drops the rest", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
    expect(cn()).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-08-21T12:00:00Z");

  it("describes recent timestamps as just now", () => {
    expect(formatRelativeTime("2026-08-21T11:59:40Z", now)).toBe("just now");
  });

  it("formats minutes, hours, days, months and years", () => {
    expect(formatRelativeTime("2026-08-21T11:50:00Z", now)).toBe("10 minutes ago");
    expect(formatRelativeTime("2026-08-21T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-08-18T12:00:00Z", now)).toBe("3 days ago");
    expect(formatRelativeTime("2026-06-21T12:00:00Z", now)).toBe("2 months ago");
    expect(formatRelativeTime("2024-08-21T12:00:00Z", now)).toBe("2 years ago");
  });

  it("handles future timestamps", () => {
    expect(formatRelativeTime("2026-08-21T14:00:00Z", now)).toBe("in 2 hours");
  });

  it("returns unknown for an unparsable value", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("unknown");
  });
});

describe("formatAbsoluteTime", () => {
  it("formats a valid timestamp and rejects an invalid one", () => {
    expect(formatAbsoluteTime("2026-08-21T12:00:00Z")).toContain("2026");
    expect(formatAbsoluteTime("nope")).toBe("unknown");
  });
});

describe("pluralise", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralise(1, "pull request")).toBe("1 pull request");
    expect(pluralise(0, "pull request")).toBe("0 pull requests");
    expect(pluralise(3, "repository", "repositories")).toBe("3 repositories");
  });
});

describe("readableTextColor", () => {
  it("picks dark text on light labels and light text on dark labels", () => {
    expect(readableTextColor("ffffff")).toBe("#101820");
    expect(readableTextColor("#a2eeef")).toBe("#101820");
    expect(readableTextColor("0e8a16")).toBe("#ffffff");
    expect(readableTextColor("000000")).toBe("#ffffff");
  });

  it("falls back to white for a malformed colour", () => {
    expect(readableTextColor("zzz")).toBe("#ffffff");
  });
});

describe("formatDiff", () => {
  it("renders additions and deletions with thousands separators", () => {
    expect(formatDiff(1200, 8)).toBe(`+${(1200).toLocaleString()} / -8`);
  });
});

describe("chunk", () => {
  it("splits into fixed size groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("treats a zero or negative size as one", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
    expect(chunk([1, 2], -5)).toEqual([[1], [2]]);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const delays = [30, 5, 20, 1];
    const results = await mapWithConcurrency(delays, 2, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("returns an empty array without calling the mapper", async () => {
    const mapper = vi.fn();
    expect(await mapWithConcurrency([], 4, mapper)).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("clamps an invalid limit to at least one", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 0, async (value) => value * 2);
    expect(results).toEqual([2, 4, 6]);
  });
});

describe("TtlCache", () => {
  it("stores and returns a value inside the ttl", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
  });

  it("expires entries once the ttl elapses", () => {
    vi.useFakeTimers();
    try {
      const cache = new TtlCache<string>(1000);
      cache.set("k", "v");
      vi.advanceTimersByTime(1001);
      expect(cache.get("k")).toBeNull();
      expect(cache.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports explicit deletion and clearing", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 1);
    cache.set("b", 2);

    cache.delete("a");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("returns null for an unknown key", () => {
    expect(new TtlCache<number>(1000).get("missing")).toBeNull();
  });
});

describe("tokenFingerprint", () => {
  it("is stable, non-reversible and distinct per token", () => {
    const a = tokenFingerprint("ghp_one");
    const b = tokenFingerprint("ghp_two");

    expect(a).toHaveLength(32);
    expect(a).toBe(tokenFingerprint("ghp_one"));
    expect(a).not.toBe(b);
    expect(a).not.toContain("ghp_");
  });
});
