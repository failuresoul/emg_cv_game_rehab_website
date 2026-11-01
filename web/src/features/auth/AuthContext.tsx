import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";

import { api } from "@/lib/api";
import type { User } from "@/types/user";

import { clearToken, getToken, saveToken } from "./storage";

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const meQueryKey = (token: string | null) => ["auth", "me", token];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(getToken);

  const meQuery = useQuery({
    queryKey: meQueryKey(token),
    queryFn: async (): Promise<User | null> => {
      try {
        const response = await api.get<User>("/auth/me");
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

  async function login(email: string, password: string) {
    const response = await api.post<LoginResponse>(
      "/auth/login",
      new URLSearchParams({ username: email.trim(), password }),
    );
    const { access_token: newToken, user: loggedInUser } = response.data;
    saveToken(newToken);
    queryClient.setQueryData(meQueryKey(newToken), loggedInUser);
    setToken(newToken);
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
        logout,
      }}
    >
      {children}
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
