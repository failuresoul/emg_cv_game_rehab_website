import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, Fragment, type ReactNode, useContext, useState } from "react";

import { setBengaliDigits, setLanguage } from "@/i18n";
import { readStoredLanguage, storeLanguage } from "@/i18n/preference";
import { api } from "@/lib/api";
import type { Language, LoginResponse, Me, PatientProfile, PatientRegister } from "@/types/api";

import { clearToken, getToken, saveToken } from "./storage";

interface AuthContextValue {
  user: Me | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: PatientRegister) => Promise<void>;
  logout: () => void;
  /** The interface language now. */
  language: Language;
  /** Patients: saved to their profile (their reports follow it). Others: kept in this browser. */
  changeLanguage: (language: Language) => Promise<void>;
  /** Patients only: numbers in Bengali digits in the Bangla interface. */
  changeBengaliDigits: (on: boolean) => Promise<void>;
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
  const [visitorLanguage, setVisitorLanguage] = useState<Language>(readStoredLanguage);

  // Set during render so that every t() below this provider uses the right language.
  const profile = user?.patient_profile ?? null;
  const language: Language = profile ? profile.language : visitorLanguage;
  const bengaliDigits = profile?.bengali_digits === true;
  setLanguage(language);
  setBengaliDigits(bengaliDigits);

  async function updateProfile(
    change: Partial<Pick<PatientProfile, "language" | "bengali_digits">>,
  ) {
    const updated = (await api.patch<PatientProfile>("/patient/profile", change)).data;
    queryClient.setQueryData<Me | null>(meQueryKey(token), (me) =>
      me?.patient_profile ? { ...me, patient_profile: { ...me.patient_profile, ...updated } } : me,
    );
    // Pages that show the profile (home, profile) read it again.
    void queryClient.invalidateQueries({ queryKey: ["patient"] });
  }

  async function changeLanguage(next: Language) {
    // Remembered in this browser for everyone, so the login page keeps it after logging out.
    storeLanguage(next);
    setVisitorLanguage(next);
    if (profile) await updateProfile({ language: next });
  }

  async function changeBengaliDigits(on: boolean) {
    if (profile) await updateProfile({ bengali_digits: on });
  }

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
        language,
        changeLanguage,
        changeBengaliDigits,
      }}
    >
      {/* The key redraws the whole app when the language or the digits change. */}
      <Fragment key={`${language}-${bengaliDigits ? "bn-digits" : "latin"}`}>{children}</Fragment>
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

/** The auth context, or null outside AuthProvider (such as a page rendered on its own in a test). */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
