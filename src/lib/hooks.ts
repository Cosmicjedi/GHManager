"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  type AuthResponse,
  type MergeRequestPayload,
  getAuthStatus,
  getPullRequests,
  mergePullRequests,
  signIn,
  signOut,
} from "@/lib/api";
import type { MergePayload, PullRequestsPayload } from "@/lib/types";

export const AUTH_QUERY_KEY = ["auth"] as const;
export const PULLS_QUERY_KEY = ["pull-requests"] as const;

/**
 * An open tab re-reads the server cache once a minute. The server keeps that
 * cache warm in the background, so this normally costs one cheap round trip -
 * no GitHub traffic - and the page stays current without anyone clicking
 * Refresh.
 */
export const PULLS_POLL_INTERVAL_MS = 60_000;

/** Current auth status, plus sign in / sign out mutations. */
export function useAuth() {
  const queryClient = useQueryClient();

  const query = useQuery<AuthResponse>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: getAuthStatus,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const signInMutation = useMutation<AuthResponse, Error, string>({
    mutationFn: signIn,
    onSuccess: (status) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, status);
      queryClient.removeQueries({ queryKey: PULLS_QUERY_KEY });
    },
  });

  const signOutMutation = useMutation<AuthResponse, Error, void>({
    mutationFn: signOut,
    onSuccess: (status) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, status);
      queryClient.removeQueries({ queryKey: PULLS_QUERY_KEY });
    },
  });

  return { query, signInMutation, signOutMutation };
}

/** Open pull requests across every accessible repository. */
export function usePullRequests(enabled: boolean) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Growing partial payload while a streamed scan is in flight, null otherwise.
  // The dashboard renders it when there is no settled data yet, so the first
  // load shows rows as they are found instead of a skeleton for the whole scan.
  const [progress, setProgress] = useState<PullRequestsPayload | null>(null);

  const query = useQuery<PullRequestsPayload>({
    queryKey: PULLS_QUERY_KEY,
    queryFn: async () => {
      try {
        return await getPullRequests({ onProgress: setProgress });
      } finally {
        setProgress(null);
      }
    },
    enabled,
    refetchInterval: PULLS_POLL_INTERVAL_MS,
  });

  /** Force a server-side refetch that bypasses the short-lived cache. */
  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const payload = await getPullRequests({ refresh: true, onProgress: setProgress });
      queryClient.setQueryData(PULLS_QUERY_KEY, payload);
      return payload;
    } finally {
      setProgress(null);
      setIsRefreshing(false);
    }
  }, [queryClient]);

  return { query, refresh, isRefreshing, progress };
}

/** Merge one or many pull requests. */
export function useMerge(options: { onSettled?: (payload: MergePayload) => void } = {}) {
  return useMutation<MergePayload, Error, MergeRequestPayload>({
    mutationFn: mergePullRequests,
    onSuccess: (payload) => {
      options.onSettled?.(payload);
    },
  });
}

export type Theme = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "ghmanager-theme";

/** Persisted light/dark/system preference, applied to the document element. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") setThemeState(stored);
    } catch {
      // Private browsing can throw on localStorage access; the system default
      // is already correct in that case.
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (next === "system") {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
        document.documentElement.removeAttribute("data-theme");
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
        document.documentElement.setAttribute("data-theme", next);
      }
    } catch {
      if (next === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", next);
    }
  }, []);

  return [theme, setTheme];
}
