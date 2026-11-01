import axios from "axios";

import { clearToken, getToken } from "@/features/auth/storage";

// AuthContext handles a 401 from these itself, keeping the user's remembered target page.
const AUTH_URLS = ["/auth/login", "/auth/me"];

export const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !AUTH_URLS.includes(error.config?.url ?? "")
    ) {
      clearToken();
      window.location.assign("/login");
    }
    return Promise.reject(error);
  },
);
