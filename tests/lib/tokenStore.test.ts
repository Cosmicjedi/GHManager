import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tokenFingerprint } from "@/lib/server/cache";
import {
  clearStoredTokens,
  getActiveStoredToken,
  listStoredTokens,
  maskToken,
  relabelStoredToken,
  removeStoredToken,
  setActiveStoredToken,
  upsertStoredToken,
} from "@/lib/server/tokenStore";
import type { Viewer } from "@/lib/types";

const TOKEN_A = "ghp_token_a_0123456789abcdefgh";
const TOKEN_B = "ghp_token_b_0123456789abcdefgh";

function viewer(login: string): Viewer {
  return {
    login,
    name: null,
    avatarUrl: null,
    url: `https://github.com/${login}`,
  };
}

beforeEach(() => {
  clearStoredTokens();
});

describe("tokenStore", () => {
  it("starts empty", () => {
    expect(listStoredTokens()).toEqual({ tokens: [], activeId: null });
    expect(getActiveStoredToken()).toBeNull();
  });

  it("stores a token and makes the first one active automatically", () => {
    const entry = upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat") });

    expect(entry.id).toBe(tokenFingerprint(TOKEN_A));
    expect(entry.label).toBe("octocat");

    const { tokens, activeId } = listStoredTokens();
    expect(tokens).toHaveLength(1);
    expect(activeId).toBe(entry.id);
    expect(getActiveStoredToken()?.token).toBe(TOKEN_A);
  });

  it("keeps the first token active when a second is added without makeActive", () => {
    const first = upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat") });
    upsertStoredToken({ token: TOKEN_B, viewer: viewer("hubot") });

    expect(listStoredTokens().activeId).toBe(first.id);
  });

  it("activates a token on demand", () => {
    upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat") });
    const second = upsertStoredToken({ token: TOKEN_B, viewer: viewer("hubot") });

    expect(setActiveStoredToken(second.id)).toBe(true);
    expect(getActiveStoredToken()?.login).toBe("hubot");
    expect(setActiveStoredToken("nope")).toBe(false);
  });

  it("re-adding the same token updates it instead of duplicating", () => {
    upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat"), label: "old" });
    upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat"), label: "new" });

    const { tokens } = listStoredTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].label).toBe("new");
  });

  it("removes a token and promotes the next one to active", () => {
    const first = upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat") });
    const second = upsertStoredToken({ token: TOKEN_B, viewer: viewer("hubot") });

    const removed = removeStoredToken(first.id);
    expect(removed?.token).toBe(TOKEN_A);
    expect(listStoredTokens().activeId).toBe(second.id);
    expect(getActiveStoredToken()?.login).toBe("hubot");

    expect(removeStoredToken(first.id)).toBeNull();
  });

  it("relabels a token, falling back to the login for a blank label", () => {
    const entry = upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat") });

    expect(relabelStoredToken(entry.id, "bot account")).toBe(true);
    expect(listStoredTokens().tokens[0].label).toBe("bot account");

    expect(relabelStoredToken(entry.id, "   ")).toBe(true);
    expect(listStoredTokens().tokens[0].label).toBe("octocat");
  });

  it("persists to a file that holds the raw token", () => {
    upsertStoredToken({ token: TOKEN_A, viewer: viewer("octocat") });

    const raw = readFileSync(
      join(process.env.GHMANAGER_DATA_DIR as string, "tokens.json"),
      "utf8",
    );
    expect(raw).toContain(TOKEN_A);
    expect(JSON.parse(raw).version).toBe(1);
  });

  it("masks tokens down to prefix and suffix", () => {
    expect(maskToken("ghp_token_a_0123456789abcdefgh")).toBe("ghp_...efgh");
    expect(maskToken("short")).toBe("...");
  });
});
