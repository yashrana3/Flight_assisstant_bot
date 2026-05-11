"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const MIN_LOADER_MS = 500;
const FAILSAFE_LOADER_MS = 4000;

function normalizeUrl(url: string): URL | null {
  if (typeof window === "undefined") return null;

  try {
    return new URL(url, window.location.href);
  } catch {
    return null;
  }
}

export default function RouteTransitionLoader() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(false);
  const currentPathRef = useRef("");
  const targetPathRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const showTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const failsafeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    currentPathRef.current = pathname || "";
  }, [pathname]);

  useEffect(() => {
    const clearTimers = () => {
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (settleTimerRef.current) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      if (failsafeTimerRef.current) {
        window.clearTimeout(failsafeTimerRef.current);
        failsafeTimerRef.current = null;
      }
    };

    const stopLoader = () => {
      clearTimers();
      setIsVisible(false);
      targetPathRef.current = null;
      startedAtRef.current = 0;
    };

    const startLoader = (nextUrl: string | null) => {
      if (!nextUrl) return;
      const next = normalizeUrl(nextUrl);
      if (!next || typeof window === "undefined") return;
      if (next.origin !== window.location.origin) return;

      const nextPath = next.pathname;
      const currentPath = currentPathRef.current;
      if (!nextPath || nextPath === currentPath) return;

      targetPathRef.current = nextPath;
      startedAtRef.current = Date.now();
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current);
      }
      showTimerRef.current = window.setTimeout(() => {
        setIsVisible(true);
        showTimerRef.current = null;
      }, 0);

      if (failsafeTimerRef.current) {
        window.clearTimeout(failsafeTimerRef.current);
      }
      failsafeTimerRef.current = window.setTimeout(stopLoader, FAILSAFE_LOADER_MS);
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      startLoader(anchor.href);
    };

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = function pushState(data, unused, url) {
      if (typeof url === "string") {
        startLoader(url);
      } else if (url instanceof URL) {
        startLoader(url.toString());
      }
      return originalPushState(data, unused, url);
    };

    window.history.replaceState = function replaceState(data, unused, url) {
      if (typeof url === "string") {
        startLoader(url);
      } else if (url instanceof URL) {
        startLoader(url.toString());
      }
      return originalReplaceState(data, unused, url);
    };

    const handlePopState = () => {
      if (typeof window === "undefined") return;
      startLoader(window.location.href);
    };

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      clearTimers();
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("popstate", handlePopState);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const activePath = pathname || "";
    if (!targetPathRef.current) return;
    if (activePath !== targetPathRef.current) return;

    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(MIN_LOADER_MS - elapsed, 0);
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      setIsVisible(false);
      targetPathRef.current = null;
      startedAtRef.current = 0;
      if (failsafeTimerRef.current) {
        window.clearTimeout(failsafeTimerRef.current);
        failsafeTimerRef.current = null;
      }
    }, remaining);
  }, [isVisible, pathname]);

  if (!isVisible) return null;

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className="route-transition-loader"
    >
      <div className="route-transition-loader__bar" />
      <div className="route-transition-loader__panel">
        <div className="route-transition-loader__spinner" />
        <span className="route-transition-loader__label">Loading page...</span>
      </div>
    </div>
  );
}
