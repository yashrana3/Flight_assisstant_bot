"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";

type ProfileCompletionState = {
  loading: boolean;
  needsProfileCompletion: boolean;
  missingFields: string[];
  refresh: () => Promise<void>;
  goToProfile: () => void;
};

const Ctx = createContext<ProfileCompletionState | null>(null);
const PROFILE_CHECK_THROTTLE_MS = 15000;

const REQUIRED_FIELDS: Array<{
  key: string;
  label: string;
  isMissing: (profile: Record<string, unknown>) => boolean;
}> = [
  { key: "first_name", label: "First name", isMissing: (p) => !String(p.first_name ?? "").trim() },
  { key: "phone", label: "Phone", isMissing: (p) => !String(p.phone ?? "").trim() },
  { key: "date_of_birth", label: "Date of birth", isMissing: (p) => !String(p.date_of_birth ?? "").trim() },
  { key: "gender", label: "Gender", isMissing: (p) => !String(p.gender ?? "").trim() },
  { key: "nationality", label: "Nationality", isMissing: (p) => !String(p.nationality ?? "").trim() },
  { key: "address", label: "Address", isMissing: (p) => !String(p.address ?? "").trim() },
];

export function ProfileCompletionProvider({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const lastRefreshAtRef = useRef(0);

  const shouldEvaluate = useMemo(() => {
    // Only show onboarding prompt in the authenticated "main" app area.
    // Avoid flashing it on auth pages.
    return !pathname?.startsWith("/sign-") && pathname !== "/sso-callback";
  }, [pathname]);

  const refresh = useCallback(async () => {
    if (!shouldEvaluate) return;
    if (!isLoaded) return;
    if (!clerkUser) return;
    const now = Date.now();
    if (now - lastRefreshAtRef.current < PROFILE_CHECK_THROTTLE_MS) return;

    const email = clerkUser.emailAddresses?.[0]?.emailAddress;
    if (!email) return;

    lastRefreshAtRef.current = now;
    setLoading(true);
    try {
      const res = await fetch(`/api/user/profile-by-email?email=${encodeURIComponent(email)}`, {
        cache: "no-store",
      });

      if (res.status === 404) {
        setMissingFields(REQUIRED_FIELDS.map((f) => f.label));
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        // If the profile lookup fails, don’t block the UI with a banner.
        setMissingFields([]);
        return;
      }

      const missing = REQUIRED_FIELDS.filter((f) => f.isMissing(data)).map((f) => f.label);
      setMissingFields(missing);
    } finally {
      setLoading(false);
    }
  }, [shouldEvaluate, isLoaded, clerkUser]);

  useEffect(() => {
    refresh().catch(() => null);
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      lastRefreshAtRef.current = 0;
      refresh().catch(() => null);
    };
    window.addEventListener("profile-updated", handler);
    return () => window.removeEventListener("profile-updated", handler);
  }, [refresh]);

  const needsProfileCompletion = !loading && missingFields.length > 0;

  const goToProfile = useCallback(() => {
    router.push("/profile");
  }, [router]);

  const value: ProfileCompletionState = useMemo(
    () => ({ loading, needsProfileCompletion, missingFields, refresh, goToProfile }),
    [loading, needsProfileCompletion, missingFields, refresh, goToProfile]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfileCompletion() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProfileCompletion must be used within ProfileCompletionProvider");
  return ctx;
}

