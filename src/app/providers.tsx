"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  // Created lazily inside state so each browser session gets exactly one
  // client and it is never shared across server requests.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Pull request data is expensive to fetch and rarely changes
            // second to second, so refetching on every window focus would
            // burn GraphQL points for nothing.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry an auth failure - the token is simply wrong.
              if (error instanceof ApiError && error.requiresAuth) return false;
              if (error instanceof ApiError && error.status === 401) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
