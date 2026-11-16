const TOKEN_KEY = "muvi_token";
/** The key before Day 20 (the internal code name): a login saved under it is moved over once. */
const LEGACY_TOKEN_KEY = "motionlab_token";

export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token !== null) return token;
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy !== null) {
    localStorage.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
  return legacy;
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}
