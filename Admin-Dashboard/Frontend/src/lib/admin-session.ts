export const ADMIN_SESSION_COOKIE = "admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
export const ADMIN_CACHE_PREFIX = "admin-cache:";

export function clearAdminClientCache() {
  if (typeof window === "undefined") return;

  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(ADMIN_CACHE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}
