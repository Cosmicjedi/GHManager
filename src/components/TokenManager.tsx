"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import {
  activateServerToken,
  addServerToken,
  getServerTokens,
  removeServerToken,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import type { ServerTokensPayload } from "@/lib/types";

export const SERVER_TOKENS_QUERY_KEY = ["server-tokens"] as const;

/**
 * Management screen for tokens stored on the server, so nobody has to edit
 * an env file and restart the container to add or rotate one. Raw tokens are
 * write-only: the server returns a mask and metadata, never the token.
 */
export function TokenManager() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const query = useQuery<ServerTokensPayload>({
    queryKey: SERVER_TOKENS_QUERY_KEY,
    queryFn: getServerTokens,
  });

  const apply = (payload: ServerTokensPayload) => {
    queryClient.setQueryData(SERVER_TOKENS_QUERY_KEY, payload);
  };

  const addMutation = useMutation({
    mutationFn: addServerToken,
    onSuccess: (payload) => {
      apply(payload);
      setToken("");
      setLabel("");
    },
  });

  const activateMutation = useMutation({
    mutationFn: activateServerToken,
    onSuccess: apply,
  });

  const removeMutation = useMutation({
    mutationFn: removeServerToken,
    onSuccess: apply,
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setLocalError("Paste a personal access token to add it.");
      return;
    }
    setLocalError(null);
    addMutation.mutate({ token: trimmed, label: label.trim() || undefined });
  }

  const tokens = query.data?.tokens ?? [];
  const mutationError =
    (addMutation.error instanceof Error ? addMutation.error.message : null) ??
    (activateMutation.error instanceof Error ? activateMutation.error.message : null) ??
    (removeMutation.error instanceof Error ? removeMutation.error.message : null);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-fg"
          >
            GH
          </span>
          <div className="leading-tight">
            <h1 className="text-base font-semibold text-fg">Server tokens</h1>
            <p className="text-xs text-fg-muted">
              Shared credentials this GHManager uses when nobody is signed in personally
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <a
              href="/"
              className="inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
            >
              Back to dashboard
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <p className="text-sm text-fg-muted">
          Tokens added here are stored on the server, survive container restarts, and are
          kept warm by the background refresh - no env file edits, no restarts. The{" "}
          <span className="font-medium text-fg">active</span> token drives the dashboard
          for anyone who has not pasted a personal token; a personal token always wins for
          that browser.
        </p>

        {query.data?.envTokenConfigured ? (
          <Banner tone="warning" title="A GITHUB_TOKEN environment variable is also set">
            Tokens managed here take priority over it. Once you have added a token you can
            drop GITHUB_TOKEN from your compose file entirely.
          </Banner>
        ) : null}

        {mutationError ? (
          <Banner tone="error" title="Token change failed">
            {mutationError}
          </Banner>
        ) : null}

        {query.error ? (
          <Banner tone="error" title="Could not load the stored tokens">
            {query.error instanceof Error ? query.error.message : "Unknown error."}
          </Banner>
        ) : null}

        <section className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-fg">
            Stored tokens
          </h2>

          {query.isLoading ? (
            <p role="status" className="px-5 py-8 text-sm text-fg-muted">
              Loading stored tokens...
            </p>
          ) : tokens.length === 0 ? (
            <p data-testid="tokens-empty" className="px-5 py-8 text-sm text-fg-muted">
              No tokens stored yet. Add one below and this GHManager works for everyone
              who opens it, with no sign-in step.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {tokens.map((entry) => (
                <li
                  key={entry.id}
                  data-testid={`token-row-${entry.id}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  {entry.avatarUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={entry.avatarUrl}
                      alt=""
                      width={32}
                      height={32}
                      className="size-8 rounded-full"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                    >
                      {entry.login.slice(0, 2).toUpperCase()}
                    </span>
                  )}

                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm font-medium text-fg">
                      {entry.label}
                      {entry.label !== entry.login ? (
                        <span className="ml-2 text-xs font-normal text-fg-muted">
                          {entry.login}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      <span className="font-mono">{entry.maskedToken}</span>
                      {" · added "}
                      {formatRelativeTime(entry.addedAt)}
                    </p>
                  </div>

                  {entry.active ? (
                    <Badge tone="positive">Active</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => activateMutation.mutate(entry.id)}
                      loading={
                        activateMutation.isPending &&
                        activateMutation.variables === entry.id
                      }
                    >
                      Use for dashboard
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => removeMutation.mutate(entry.id)}
                    loading={
                      removeMutation.isPending && removeMutation.variables === entry.id
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)]">
          <h2 className="text-sm font-semibold text-fg">Add a token</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Verified with GitHub before it is stored. The full token is never shown again -
            to rotate one, add the new token and remove the old.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
            />
            <TextInput
              label="Label (optional)"
              placeholder="e.g. bot account, work org"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              hint="Defaults to the GitHub account name behind the token."
            />
            <Button type="submit" variant="primary" loading={addMutation.isPending}>
              {addMutation.isPending ? "Verifying with GitHub" : "Add token"}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
