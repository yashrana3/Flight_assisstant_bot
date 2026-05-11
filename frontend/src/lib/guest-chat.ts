export const CHAT_CACHE_KEY = "bookwithai_cached_chats";
export const GUEST_CHAT_COUNT_KEY = "bookwithai_guest_chat_count_v2";
export const GUEST_CHAT_LIMIT = 10;
export const GUEST_CHAT_LIMIT_DISMISSED_KEY = "bookwithai_guest_limit_dismissed_v1";
export const GUEST_AUTH_ACTION_KEY = "bookwithai_guest_auth_action_v1";

export type GuestAuthAction = "sign_in" | "sign_up";

function readLocalStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageValue(key: string, value: string | null) {
  if (typeof window === "undefined") return;

  try {
    if (value === null) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // Ignore browser storage failures.
  }
}

export function readStoredBoolean(key: string): boolean {
  return readLocalStorageValue(key) === "true";
}

export function writeStoredBoolean(key: string, value: boolean) {
  writeLocalStorageValue(key, value ? "true" : null);
}

export function readGuestAuthAction(): GuestAuthAction | null {
  const value = readLocalStorageValue(GUEST_AUTH_ACTION_KEY);
  return value === "sign_in" || value === "sign_up" ? value : null;
}

export function writeGuestAuthAction(action: GuestAuthAction | null) {
  writeLocalStorageValue(GUEST_AUTH_ACTION_KEY, action);
}
