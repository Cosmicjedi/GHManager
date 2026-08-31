"use client";

import { type FormEvent, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";

export interface TokenGateProps {
  onSubmit: (token: string) => void;
  isSubmitting: boolean;
  error: string | null;
}

/**
 * First-run screen. The token is POSTed to the server, verified against
 * GitHub, and stored in an httpOnly cookie - it is never written to
 * localStorage and never read back into JavaScript.
 */
export function TokenGate({ onSubmit, isSubmitting, error }: TokenGateProps) {
  const [token, setToken] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setLocalError("Paste a personal access token to continue.");
      return;
    }
    setLocalError(null);
    onSubmit(trimmed);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <main className="flex flex-1 items-start justify-center px-4 pb-16">
        <div className="w-full max-w-lg">
          <div className="mb-6 flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-2xl bg-accent text-base font-bold text-accent-fg"
            >
              GH
            </span>
            <div>
              <h1 className="text-xl font-semibold text-fg">GHManager</h1>
              <p className="text-sm text-fg-muted">
                Every open pull request you can reach, in one place.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-md)]">
            <h2 className="text-base font-semibold text-fg">Connect your GitHub account</h2>
            <p className="mt-1 text-sm text-fg-muted">
              GHManager talks to GitHub from the server. Your token is stored in an httpOnly
              cookie that browser scripts cannot read, and is never sent anywhere except
              github.com.
            </p>

            {error ? (
              <Banner tone="error" className="mt-4">
                {error}
              </Banner>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <TextInput
                label="Personal access token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="ghp_... or github_pat_..."
                value={token}
                error={localError}
                onChange={(event) => {
                  setToken(event.target.value);
                  if (localError) setLocalError(null);
                }}
                hint="The token is verified with GitHub before it is stored."
              />

              <Button type="submit" variant="primary" loading={isSubmitting} className="w-full">
                {isSubmitting ? "Verifying with GitHub" : "Connect"}
              </Button>
            </form>

            <div className="mt-6 space-y-3 border-t border-border pt-5 text-sm text-fg-muted">
              <p className="font-medium text-fg">Required scopes</p>
              <ul className="space-y-1.5">
                <li>
                  <span className="font-mono text-xs text-fg">classic</span> - the{" "}
                  <span className="font-mono text-xs text-fg">repo</span> scope.
                </li>
                <li>
                  <span className="font-mono text-xs text-fg">fine-grained</span> - Contents:
                  read and write, Pull requests: read and write, Metadata: read-only.
                </li>
              </ul>
              <p>
                <a
                  className="font-medium text-accent underline underline-offset-2"
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Create a token on GitHub
                </a>
              </p>
              <p className="text-xs">
                Sharing this GHManager, or tired of re-pasting?{" "}
                <a
                  className="font-medium text-accent underline underline-offset-2"
                  href="/tokens"
                >
                  Add a server token
                </a>{" "}
                instead - it is stored on the server, survives restarts, and signs
                everyone in automatically.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
