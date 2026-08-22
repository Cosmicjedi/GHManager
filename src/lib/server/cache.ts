import { createHash } from "node:crypto";

/**
 * A tiny in-process TTL cache for pull request payloads.
 *
 * Enumerating every repository is expensive, and a dashboard tab that is left
 * open will re-request on focus. Caching for a few tens of seconds keeps the
 * GraphQL point cost sane while still feeling live. Entries are keyed by a
 * hash of the token so two users of the same server never see each other data.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    this.prune();
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }
}

/** Non-reversible key for a token, so raw tokens never sit in a cache map. */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}
