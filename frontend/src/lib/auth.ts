/**
 * Backend auth helpers.
 *
 * Clerk manages the user session in the browser. To call FastAPI endpoints
 * that still require a legacy JWT Bearer token, we exchange the Clerk session
 * for a backend-signed JWT via /api/auth/backend-token and cache it in
 * sessionStorage for the duration of the tab session.
 *
 * Use the `useBackendAuth` hook in components that call the FastAPI backend.
 * Use `getAuthHeaders()` only in non-hook contexts where you have already
 * ensured the token is cached.
 */

const BACKEND_TOKEN_KEY = "bwa_backend_token";

/** Read the cached backend JWT from sessionStorage (browser only). */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(BACKEND_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Return an Authorization header object, or empty if no token cached. */
export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Clear the cached backend token (call on sign-out). */
export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(BACKEND_TOKEN_KEY);
  } catch {
    // ignore
  }
}

/**
 * Fetch a backend JWT by exchanging the current Clerk session.
 * Returns the token string on success, null on failure.
 */
async function fetchBackendToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/backend-token");
    if (!res.ok) return null;
    const data = await res.json();
    if (data.token) {
      sessionStorage.setItem(BACKEND_TOKEN_KEY, data.token);
      return data.token as string;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── React hook ──────────────────────────────────────────────────────────────

/**
 * Hook that provides a backend-compatible JWT for FastAPI calls.
 *
 * On first render it checks sessionStorage; if nothing is cached it
 * exchanges the Clerk session for a backend JWT via /api/auth/backend-token.
 *
 * Usage:
 *   const { headers, loading } = useBackendAuth();
 *   const res = await fetch("/api/trips", { headers });
 */
export function useBackendAuth(): {
  token: string | null;
  loading: boolean;
  headers: Record<string, string>;
} {
  // Dynamically require React hooks to keep this file importable from
  // server components (they just won't call the hook).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useState, useEffect } = require("react") as typeof import("react");

  const [token, setToken] = useState<string | null>(() => getAuthToken());
  const [loading, setLoading] = useState<boolean>(!token);

  useEffect(() => {
    if (token) {
      setLoading(false);
      return;
    }
    fetchBackendToken().then((t) => {
      setToken(t);
      setLoading(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    token,
    loading,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}
