import "@/styles/index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { router } from "@/app/router";
import { ToastProvider } from "@/components/ui/Toast";
import { AuthProvider } from "@/features/auth/AuthContext";

const queryClient = new QueryClient({
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
