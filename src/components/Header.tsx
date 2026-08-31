"use client";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatRelativeTime } from "@/lib/format";
import type { AuthStatus, RateLimitInfo } from "@/lib/types";

export interface HeaderProps {
  auth: AuthStatus | null;
  rateLimit: RateLimitInfo | null;
  fetchedAt: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
  isSigningOut: boolean;
  canRefresh: boolean;
}

export function Header({
  auth,
  rateLimit,
  fetchedAt,
  isRefreshing,
  onRefresh,
  onSignOut,
  isSigningOut,
  canRefresh,
}: HeaderProps) {
  const viewer = auth?.viewer ?? null;

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-fg"
          >
            GH
          </span>
          <div className="leading-tight">
            <h1 className="text-base font-semibold text-fg">GHManager</h1>
            <p className="text-xs text-fg-muted">Open pull requests, everywhere you have access</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {fetchedAt ? (
            <span className="hidden text-xs text-fg-muted sm:inline" title={fetchedAt}>
              Updated {formatRelativeTime(fetchedAt)}
            </span>
          ) : null}

          {rateLimit ? (
            <Badge
              tone={rateLimit.remaining < 500 ? "warning" : "neutral"}
              title={`GraphQL points: ${rateLimit.remaining} of ${rateLimit.limit} remaining. This load cost ${rateLimit.usedThisRequest}. Resets ${formatRelativeTime(rateLimit.resetAt)}.`}
              className="hidden md:inline-flex"
            >
              API {rateLimit.remaining}/{rateLimit.limit}
            </Badge>
          ) : null}

          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            loading={isRefreshing}
            disabled={!canRefresh}
          >
            {isRefreshing ? "Refreshing" : "Refresh"}
          </Button>

          <a
            href="/tokens"
            title="Manage the tokens stored on this server"
            className="inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
          >
            Tokens
          </a>

          <ThemeToggle />

          {viewer ? (
            <div className="flex items-center gap-2 rounded-full border border-border bg-surface-muted py-1 pr-1 pl-1.5">
              {viewer.avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={viewer.avatarUrl}
                  alt=""
                  width={24}
                  height={24}
                  className="size-6 rounded-full"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent"
                >
                  {viewer.login.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="max-w-[10rem] truncate text-sm font-medium text-fg">
                {viewer.login}
              </span>
              {auth?.managedByServer ? (
                <Badge
                  tone="neutral"
                  title="This token comes from GITHUB_TOKEN on the server and cannot be cleared from the browser."
                >
                  server token
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onSignOut}
                  loading={isSigningOut}
                  className="h-6 px-2 text-xs"
                >
                  Sign out
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
