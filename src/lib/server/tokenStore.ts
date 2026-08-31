import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tokenFingerprint } from "@/lib/server/cache";
import type { Viewer } from "@/lib/types";

/**
 * Persistent server-side token store, so tokens are managed from the UI
 * instead of a text file. Lives as JSON in the data directory - mount that
 * directory as a volume and tokens survive container rebuilds.
 *
 * The file holds raw tokens (that is its job: the server needs them to talk
 * to GitHub), so it is written with owner-only permissions and its contents
 * are never returned by any API route - callers get metadata and a mask.
 */

export interface StoredToken {
  /** Fingerprint of the token; doubles as the public id. */
  id: string;
  /** The raw token. Server-side only, never serialised into a response. */
  token: string;
  label: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  url: string;
  addedAt: string;
}

interface StoreFile {
  version: 1;
  /** Id of the token that drives the dashboard when no cookie token is set. */
  activeId: string | null;
  tokens: StoredToken[];
}

const EMPTY: StoreFile = { version: 1, activeId: null, tokens: [] };

function dataDir(): string {
  const configured = process.env.GHMANAGER_DATA_DIR?.trim();
  return configured || join(process.cwd(), "data");
}

function storePath(): string {
  return join(dataDir(), "tokens.json");
}

/** Read the store from disk. A missing or unreadable file is an empty store. */
function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as StoreFile;
    if (parsed?.version === 1 && Array.isArray(parsed.tokens)) {
      return parsed;
    }
  } catch {
    // First run, or the volume is empty - both mean "no tokens yet".
  }
  return { ...EMPTY, tokens: [] };
}

function writeStore(store: StoreFile): void {
  mkdirSync(dataDir(), { recursive: true });
  const path = storePath();
  const tmp = `${path}.tmp`;
  // Write-then-rename so a crash mid-write can never corrupt the store.
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // chmod is a no-op on some filesystems (notably Windows); the mode on
    // writeFileSync above already did what could be done.
  }
}

export function listStoredTokens(): { tokens: StoredToken[]; activeId: string | null } {
  const store = readStore();
  return { tokens: store.tokens, activeId: effectiveActiveId(store) };
}

/** The activeId, self-healed to the first token if it points nowhere. */
function effectiveActiveId(store: StoreFile): string | null {
  if (store.activeId && store.tokens.some((entry) => entry.id === store.activeId)) {
    return store.activeId;
  }
  return store.tokens[0]?.id ?? null;
}

/** The token that should drive the dashboard when no cookie token is set. */
export function getActiveStoredToken(): StoredToken | null {
  const store = readStore();
  const activeId = effectiveActiveId(store);
  return store.tokens.find((entry) => entry.id === activeId) ?? null;
}

/**
 * Add a token, or refresh the metadata of one that is already stored (the
 * same token always maps to the same id). The first token added becomes
 * active automatically.
 */
export function upsertStoredToken(input: {
  token: string;
  viewer: Viewer;
  label?: string;
  makeActive?: boolean;
}): StoredToken {
  const store = readStore();
  const token = input.token.trim();
  const id = tokenFingerprint(token);
  const existing = store.tokens.find((entry) => entry.id === id);

  const entry: StoredToken = {
    id,
    token,
    label: input.label?.trim() || existing?.label || input.viewer.login,
    login: input.viewer.login,
    name: input.viewer.name,
    avatarUrl: input.viewer.avatarUrl,
    url: input.viewer.url,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };

  if (existing) {
    store.tokens = store.tokens.map((candidate) =>
      candidate.id === id ? entry : candidate,
    );
  } else {
    store.tokens.push(entry);
  }

  if (input.makeActive || store.tokens.length === 1) {
    store.activeId = id;
  }

  writeStore(store);
  return entry;
}

/** Remove a token. Returns the removed entry so caches can be invalidated. */
export function removeStoredToken(id: string): StoredToken | null {
  const store = readStore();
  const removed = store.tokens.find((entry) => entry.id === id) ?? null;
  if (!removed) return null;

  store.tokens = store.tokens.filter((entry) => entry.id !== id);
  if (store.activeId === id) {
    store.activeId = store.tokens[0]?.id ?? null;
  }
  writeStore(store);
  return removed;
}

/** Make a stored token the one that drives the dashboard. */
export function setActiveStoredToken(id: string): boolean {
  const store = readStore();
  if (!store.tokens.some((entry) => entry.id === id)) return false;
  store.activeId = id;
  writeStore(store);
  return true;
}

/** Rename a stored token's label. */
export function relabelStoredToken(id: string, label: string): boolean {
  const store = readStore();
  const entry = store.tokens.find((candidate) => candidate.id === id);
  if (!entry) return false;
  entry.label = label.trim() || entry.login;
  writeStore(store);
  return true;
}

/** Test helper - deletes the store file entirely. */
export function clearStoredTokens(): void {
  try {
    rmSync(storePath(), { force: true });
  } catch {
    // Nothing to delete.
  }
}

/** e.g. "ghp_...abcd" - recognisable to a human, useless to an attacker. */
export function maskToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 12) return "...";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}
