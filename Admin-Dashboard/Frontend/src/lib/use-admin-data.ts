"use client";

import { useCallback, useEffect, useState } from "react";

type UseAdminDataOptions = {
  refreshMs?: number;
  staleMs?: number;
};

type CacheEntry = {
  data: unknown;
  timestamp: number;
};

const DEFAULT_STALE_MS = 30_000;
const LOCAL_STORAGE_PREFIX = "admin-cache:";
const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();

function getLocalStorageKey(url: string): string {
  return `${LOCAL_STORAGE_PREFIX}${url}`;
}

function readPersistedCache(url: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getLocalStorageKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed?.timestamp !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedCache(url: string, entry: CacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getLocalStorageKey(url), JSON.stringify(entry));
  } catch {
    // Ignore quota/storage errors and keep in-memory cache only.
  }
}

export function useAdminData<T>(
  url: string,
  options?: UseAdminDataOptions,
) {
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
  const cached = responseCache.get(url) ?? readPersistedCache(url) ?? undefined;
  if (cached && !responseCache.has(url)) {
    responseCache.set(url, cached);
  }
  const isCacheFresh =
    cached != null && Date.now() - cached.timestamp <= staleMs;

  const [data, setData] = useState<T | null>(
    isCacheFresh ? (cached.data as T) : null,
  );
  const [loading, setLoading] = useState(!isCacheFresh);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (background = false) => {
    try {
      if (!background) {
        setLoading(true);
      }
      setError(null);
      let request = inflightRequests.get(url);

      if (!request) {
        request = (async () => {
          const response = await fetch(url, {
            cache: "no-store",
            credentials: "include",
          });
          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            if (response.status === 401) {
              responseCache.delete(url);
              try {
                window.localStorage.removeItem(getLocalStorageKey(url));
              } catch {
                /* ignore */
              }
            }
            throw new Error(
              payload?.detail || `Request failed with ${response.status}`,
            );
          }
          return payload;
        })();
        inflightRequests.set(url, request);
      }

      const payload = (await request) as T;
      const entry = { data: payload, timestamp: Date.now() };
      responseCache.set(url, entry);
      writePersistedCache(url, entry);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      inflightRequests.delete(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (!mounted) return;
      const shouldBackgroundLoad =
        responseCache.has(url) &&
        Date.now() - (responseCache.get(url)?.timestamp ?? 0) <= staleMs;
      await load(shouldBackgroundLoad);
    };

    void run();

    if (!options?.refreshMs) {
      return () => {
        mounted = false;
      };
    }

    const interval = window.setInterval(() => {
      void load();
    }, options.refreshMs);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [load, options?.refreshMs, staleMs, url]);

  return {
    data,
    loading,
    error,
    refresh: load,
    setData,
  };
}
