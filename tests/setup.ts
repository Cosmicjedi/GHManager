import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "~tests/server";

// Every worker gets its own managed-token store so tests never touch the
// repository's data directory or each other's tokens.
process.env.GHMANAGER_DATA_DIR = mkdtempSync(join(tmpdir(), "ghmanager-test-"));

// jsdom does not implement matchMedia, which the theme handling touches.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeAll(() => {
  // `bypass` lets the API-route tests (which stub global fetch themselves and
  // never talk to localhost) run untouched, while component tests register
  // explicit handlers for /api/*.
  server.listen({ onUnhandledRequest: "bypass" });
});

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});

afterAll(() => {
  server.close();
});
