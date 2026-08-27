"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmMergeDialog } from "@/components/ConfirmMergeDialog";
import { Header } from "@/components/Header";
import { MergeSummary } from "@/components/MergeSummary";
import { PullRequestTable } from "@/components/PullRequestTable";
import { EmptyState, TableSkeleton } from "@/components/States";
import { TokenGate } from "@/components/TokenGate";
import { Toolbar } from "@/components/Toolbar";
import { Banner } from "@/components/ui/Banner";
import { ApiError } from "@/lib/api";
import {
  DEFAULT_FILTERS,
  type FilterState,
  applyFilters,
  collectFilterOptions,
  commonMergeMethods,
  hasActiveFilters,
} from "@/lib/filters";
import { useAuth, useMerge, usePullRequests } from "@/lib/hooks";
import type { MergeMethod, MergePayload, MergeResult, PullRequest } from "@/lib/types";

/** Stable identity for a pull request across a merge round trip. */
function keyOf(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

export function Dashboard() {
  const { query: authQuery, signInMutation, signOutMutation } = useAuth();
  const authenticated = authQuery.data?.authenticated === true;

  const { query: pullsQuery, refresh, isRefreshing } = usePullRequests(authenticated);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [mergeMethod, setMergeMethod] = useState<MergeMethod>("merge");
  const [pendingMerge, setPendingMerge] = useState<PullRequest[] | null>(null);
  const [mergingIds, setMergingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Pull requests this session merged. GitHub's open-PR list is eventually
  // consistent, so a merged pull request often comes back as open on the very
  // next read; keeping the ids here hides those rows until GitHub agrees.
  const [mergedIds, setMergedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [results, setResults] = useState<ReadonlyMap<string, MergeResult>>(() => new Map());
  const [summary, setSummary] = useState<MergePayload | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const fetchedPullRequests = useMemo(
    () => pullsQuery.data?.pullRequests ?? [],
    [pullsQuery.data],
  );

  // Stop suppressing a merged pull request once GitHub stops reporting it as
  // open, so the set cannot grow for the lifetime of the tab.
  useEffect(() => {
    setMergedIds((current) => {
      if (current.size === 0) return current;
      const present = new Set(fetchedPullRequests.map((pullRequest) => pullRequest.id));
      const next = new Set<string>();
      for (const id of current) if (present.has(id)) next.add(id);
      return next.size === current.size ? current : next;
    });
  }, [fetchedPullRequests]);

  const allPullRequests = useMemo(
    () =>
      mergedIds.size === 0
        ? fetchedPullRequests
        : fetchedPullRequests.filter((pullRequest) => !mergedIds.has(pullRequest.id)),
    [fetchedPullRequests, mergedIds],
  );

  const visiblePullRequests = useMemo(
    () => applyFilters(allPullRequests, filters),
    [allPullRequests, filters],
  );

  const options = useMemo(() => collectFilterOptions(allPullRequests), [allPullRequests]);

  const byId = useMemo(() => {
    const map = new Map<string, PullRequest>();
    for (const pullRequest of allPullRequests) map.set(pullRequest.id, pullRequest);
    return map;
  }, [allPullRequests]);

  // Drop selections whose pull request disappeared or stopped being mergeable
  // after a refresh, so the bulk action never targets something stale.
  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set<string>();
      for (const id of current) {
        const pullRequest = byId.get(id);
        if (pullRequest?.mergeability.canMerge) next.add(id);
      }
      return next.size === current.size ? current : next;
    });
  }, [byId]);

  const selectedPullRequests = useMemo(
    () =>
      [...selectedIds]
        .map((id) => byId.get(id))
        .filter((pullRequest): pullRequest is PullRequest => Boolean(pullRequest)),
    [selectedIds, byId],
  );

  const allowedMergeMethods = useMemo(
    () =>
      commonMergeMethods(
        selectedPullRequests.length > 0 ? selectedPullRequests : visiblePullRequests,
      ),
    [selectedPullRequests, visiblePullRequests],
  );

  const mergeMutation = useMerge();

  const toggleSelected = useCallback((id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (selected: boolean) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const pullRequest of visiblePullRequests) {
          if (!pullRequest.mergeability.canMerge) continue;
          if (selected) next.add(pullRequest.id);
          else next.delete(pullRequest.id);
        }
        return next;
      });
    },
    [visiblePullRequests],
  );

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const runMerge = useCallback(
    async (targets: PullRequest[]) => {
      if (targets.length === 0) return;

      setMergeError(null);
      setSummary(null);
      setMergingIds(new Set(targets.map((pullRequest) => pullRequest.id)));

      // The API answers with owner/repo/number, so keep a lookup back to ids.
      const idByKey = new Map<string, string>();
      for (const pullRequest of targets) {
        idByKey.set(
          keyOf(pullRequest.repository.owner, pullRequest.repository.name, pullRequest.number),
          pullRequest.id,
        );
      }

      let mergeAnswered = false;

      try {
        const payload = await mergeMutation.mutateAsync({
          items: targets.map((pullRequest) => ({
            owner: pullRequest.repository.owner,
            repo: pullRequest.repository.name,
            number: pullRequest.number,
            headSha: pullRequest.headSha || undefined,
          })),
          mergeMethod,
        });

        setResults((current) => {
          const next = new Map(current);
          for (const result of payload.results) {
            const id = idByKey.get(keyOf(result.owner, result.repo, result.number));
            if (id) next.set(id, result);
          }
          return next;
        });

        setSummary(payload);
        mergeAnswered = true;

        const justMerged = new Set(
          payload.results
            .filter((result) => result.status === "merged")
            .map((result) => idByKey.get(keyOf(result.owner, result.repo, result.number)))
            .filter((id): id is string => Boolean(id)),
        );
        if (justMerged.size > 0) {
          // Take the merged rows out of the table straight away rather than
          // waiting on the refresh, and keep them out until GitHub's open list
          // catches up. Dropping them from the selection stops a second click
          // from retrying a pull request that is already merged.
          setMergedIds((current) => new Set([...current, ...justMerged]));
          setSelectedIds((current) => {
            const next = new Set(current);
            for (const id of justMerged) next.delete(id);
            return next;
          });
        }
      } catch (error) {
        if (error instanceof ApiError && error.requiresAuth) {
          await authQuery.refetch();
        }
        setMergeError(
          error instanceof Error ? error.message : "The merge request could not be sent.",
        );
      } finally {
        // Close the dialog as soon as GitHub has answered. The refresh below
        // re-walks every repository and can take a while; leaving the modal up
        // for that makes a finished merge look like a hung one.
        setMergingIds(new Set());
        setPendingMerge(null);
      }

      if (mergeAnswered) {
        await refresh().catch(() => {
          // A failed background refresh must not mask the merge outcome; the
          // user can hit Refresh manually.
        });
      }
    },
    [authQuery, mergeMethod, mergeMutation, refresh],
  );

  const retryFailed = useCallback(() => {
    if (!summary) return;
    const failedIds = summary.results
      .filter((result) => result.status === "failed")
      .map((result) => {
        const match = allPullRequests.find(
          (pullRequest) =>
            pullRequest.repository.owner === result.owner &&
            pullRequest.repository.name === result.repo &&
            pullRequest.number === result.number,
        );
        return match ?? null;
      })
      .filter((pullRequest): pullRequest is PullRequest => Boolean(pullRequest));

    if (failedIds.length > 0) setPendingMerge(failedIds);
  }, [allPullRequests, summary]);

  const handleSignIn = useCallback(
    (token: string) => {
      signInMutation.mutate(token);
    },
    [signInMutation],
  );

  const authError =
    (signInMutation.error instanceof Error ? signInMutation.error.message : null) ??
    authQuery.data?.error ??
    null;

  if (authQuery.isLoading) {
    return (
      <div
        role="status"
        aria-label="Checking GitHub authentication"
        className="flex min-h-dvh items-center justify-center bg-canvas text-sm text-fg-muted"
      >
        Checking your GitHub credentials...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <TokenGate
        onSubmit={handleSignIn}
        isSubmitting={signInMutation.isPending}
        error={authError}
      />
    );
  }

  const pullsError = pullsQuery.error;
  const isInitialLoad = pullsQuery.isLoading;

  return (
    <div className="min-h-dvh bg-canvas">
      <Header
        auth={authQuery.data ?? null}
        rateLimit={pullsQuery.data?.rateLimit ?? null}
        fetchedAt={pullsQuery.data?.fetchedAt ?? null}
        isRefreshing={isRefreshing || pullsQuery.isFetching}
        onRefresh={() => {
          void refresh();
        }}
        onSignOut={() => signOutMutation.mutate()}
        isSigningOut={signOutMutation.isPending}
        canRefresh={!isInitialLoad}
      />

      <main className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-6 sm:px-6">
        {pullsError ? (
          <Banner
            tone="error"
            title="Could not load pull requests"
            onRetry={() => {
              void refresh();
            }}
          >
            {pullsError.message}
          </Banner>
        ) : null}

        {mergeError ? (
          <Banner tone="error" title="Merge request failed" onDismiss={() => setMergeError(null)}>
            {mergeError}
          </Banner>
        ) : null}

        {pullsQuery.data?.warnings?.length ? (
          <Banner tone="warning" title="Some repositories were skipped">
            <ul className="list-inside list-disc space-y-0.5">
              {pullsQuery.data.warnings.slice(0, 5).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Banner>
        ) : null}

        {summary ? (
          <MergeSummary
            payload={summary}
            onDismiss={() => setSummary(null)}
            onRetryFailed={retryFailed}
          />
        ) : null}

        <Toolbar
          filters={filters}
          onFiltersChange={setFilters}
          repositories={options.repositories}
          authors={options.authors}
          totalCount={allPullRequests.length}
          visibleCount={visiblePullRequests.length}
          selectedCount={selectedIds.size}
          filtersActive={hasActiveFilters(filters)}
          onClearFilters={() => setFilters(DEFAULT_FILTERS)}
          mergeMethod={mergeMethod}
          onMergeMethodChange={setMergeMethod}
          allowedMergeMethods={allowedMergeMethods}
          onMergeSelected={() => setPendingMerge(selectedPullRequests)}
          onClearSelection={clearSelection}
          isMerging={mergeMutation.isPending}
        />

        {isInitialLoad ? (
          <TableSkeleton />
        ) : visiblePullRequests.length === 0 ? (
          <EmptyState
            title={
              allPullRequests.length === 0
                ? "No open pull requests"
                : "Nothing matches these filters"
            }
            description={
              allPullRequests.length === 0
                ? `Scanned ${pullsQuery.data?.repositoriesScanned ?? 0} repositories and found nothing waiting on you. Enjoy it.`
                : `${allPullRequests.length} open pull requests are loaded, but none match the current filters.`
            }
            actionLabel={hasActiveFilters(filters) ? "Clear filters" : undefined}
            onAction={hasActiveFilters(filters) ? () => setFilters(DEFAULT_FILTERS) : undefined}
          />
        ) : (
          <PullRequestTable
            pullRequests={visiblePullRequests}
            selectedIds={selectedIds}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleAll}
            onMerge={(pullRequest) => setPendingMerge([pullRequest])}
            mergingIds={mergingIds}
            results={results}
          />
        )}

        {pullsQuery.data ? (
          <p className="pb-6 text-center text-xs text-fg-subtle">
            {pullsQuery.data.repositoriesWithOpenPullRequests} of{" "}
            {pullsQuery.data.repositoriesScanned} repositories have open pull requests
            {pullsQuery.data.cached ? " · served from a short-lived cache" : ""}
          </p>
        ) : null}
      </main>

      {pendingMerge && pendingMerge.length > 0 ? (
        <ConfirmMergeDialog
          pullRequests={pendingMerge}
          mergeMethod={mergeMethod}
          isMerging={mergeMutation.isPending}
          onConfirm={() => {
            void runMerge(pendingMerge);
          }}
          onCancel={() => setPendingMerge(null)}
        />
      ) : null}
    </div>
  );
}
