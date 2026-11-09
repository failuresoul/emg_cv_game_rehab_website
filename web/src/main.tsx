import "@/styles/index.css";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { router } from "@/app/router";
import { ErrorBoundary } from "@/components/ErrorPage";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/features/auth/AuthContext";
import { isSilent, reportApiError } from "@/lib/apiErrors";

const queryClient = new QueryClient({
  // Every failed request becomes a readable toast, unless it handles its own errors.
  queryCache: new QueryCache({
    onError: (error, query) => {
      // A first load that fails already shows its error and Try again on the page.
      if (isSilent(query.meta) || query.state.data === undefined) return;
      reportApiError(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (!isSilent(mutation.meta)) reportApiError(error);
    },
  }),
  defaultOptions: {
    queries: {
      // Client errors such as 404 will not change on retry, so show them straight away.
      retry: (failureCount, error) => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        const isClientError = status !== undefined && status >= 400 && status < 500;
        return !isClientError && failureCount < 2;
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <OfflineBanner />
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
