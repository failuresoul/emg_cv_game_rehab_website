import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, Fragment, type ReactNode, useContext, useState } from "react";

import { setLanguage } from "@/i18n";
import { api } from "@/lib/api";
import type { LoginResponse, Me, PatientRegister } from "@/types/api";

import { clearToken, getToken, saveToken } from "./storage";

interface AuthContextValue {
  user: Me | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: PatientRegister) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const meQueryKey = (token: string | null) => ["auth", "me", token];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(getToken);

  const meQuery = useQuery({
    queryKey: meQueryKey(token),
    queryFn: async (): Promise<Me | null> => {
      try {
        const response = await api.get<Me>("/auth/me");
        return response.data;
      } catch {
        clearToken();
        return null;
      }
    },
    enabled: token !== null,
    staleTime: Infinity,
    retry: false,
  });

  const user = token !== null ? (meQuery.data ?? null) : null;

  // Set during render so that every t() below this provider uses the right language.
  const language = user?.patient_profile?.language ?? "en";
  setLanguage(language);

  // The new token triggers /auth/me, which also brings the patient's language.
  function startSession({ access_token: newToken }: LoginResponse) {
    saveToken(newToken);
    setToken(newToken);
  }

  async function login(email: string, password: string) {
    const response = await api.post<LoginResponse>(
      "/auth/login",
      new URLSearchParams({ username: email.trim(), password }),
    );
    startSession(response.data);
  }

  async function register(payload: PatientRegister) {
    const response = await api.post<LoginResponse>("/auth/register", payload);
    startSession(response.data);
  }

  function logout() {
    clearToken();
    queryClient.clear();
    // A full reload drops all in-memory state and leaves no remembered target page.
    window.location.assign("/login");
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token: user ? token : null,
        isLoading: token !== null && meQuery.isPending,
        login,
        register,
        logout,
      }}
    >
      {/* The key redraws the whole app when the language changes. */}
      <Fragment key={language}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
