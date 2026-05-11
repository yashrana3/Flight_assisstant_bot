"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { CHAT_CACHE_KEY, GUEST_AUTH_ACTION_KEY, GUEST_CHAT_COUNT_KEY, GUEST_CHAT_LIMIT_DISMISSED_KEY } from "@/lib/guest-chat";
import { useProfileCompletion } from "@/components/onboarding/ProfileCompletionProvider";
import {
  Home,
  Plane,
  Bell,
  User,
  Award,
  FileText,
  Bookmark,
  TrendingUp,
  Settings,
  LogIn,
  LogOut,
} from "lucide-react";

const guestProtectedRoutes = new Set(["/my-trips", "/deals", "/profile"]);
const ALERT_PRICE_CACHE_KEY = "bookwithai_alert_price_snapshot_v1";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/my-trips", label: "My Trips", icon: Plane },
  { href: "/deals", label: "Alerts", icon: Bell },
  { href: "/loyalty", label: "Loyalty & Miles", icon: Award },
  { href: "/itineraries", label: "Itineraries", icon: FileText },
  { href: "/saved", label: "Saved Flights", icon: Bookmark },
  { href: "/stats", label: "Travel Stats", icon: TrendingUp },
];

const profileMenuItems = [
  { href: "/profile", label: "My Profile", icon: User },
  { href: "/my-trips", label: "Saved Trips", icon: Plane },
  { href: "/loyalty", label: "Loyalty & Miles", icon: Award },
  { href: "/document-vault", label: "Document Vault", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];

function getGuestAuthHref(targetPath: string): string {
  return `/sign-in?redirect_url=${encodeURIComponent(targetPath)}`;
}

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const { needsProfileCompletion } = useProfileCompletion();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [alertNotificationCount, setAlertNotificationCount] = useState(0);
  /** First name from our DB profile (preferred for header label). */
  const [dbFirstName, setDbFirstName] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDropdownOpen) return;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, [isDropdownOpen]);

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded || !isSignedIn) {
      setAlertNotificationCount(0);
      return;
    }

    const loadAlertNotifications = async () => {
      try {
        const res = await fetch("/api/price-alerts?refresh=false", { cache: "no-store" });
        const data = await res.json().catch(() => null) as {
          alerts?: Array<{ id?: string; active?: boolean; currentPrice?: number | null }>;
        } | null;
        if (!res.ok || cancelled) return;

        const alerts = Array.isArray(data?.alerts) ? data!.alerts! : [];
        const currentSnapshot: Record<string, number | null> = {};
        for (const alert of alerts) {
          if (!alert?.id) continue;
          currentSnapshot[alert.id] =
            typeof alert.currentPrice === "number" ? alert.currentPrice : null;
        }

        let previousSnapshot: Record<string, number | null> = {};
        if (typeof window !== "undefined") {
          try {
            const raw = window.localStorage.getItem(ALERT_PRICE_CACHE_KEY);
            if (raw) previousSnapshot = JSON.parse(raw) as Record<string, number | null>;
          } catch {
            previousSnapshot = {};
          }
        }

        let count = 0;
        for (const alert of alerts) {
          if (!alert?.active || !alert?.id) continue;
          const prev = previousSnapshot[alert.id];
          const curr = currentSnapshot[alert.id];
          if (
            typeof prev === "number" &&
            typeof curr === "number" &&
            prev !== curr
          ) {
            count += 1;
          }
        }

        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(
              ALERT_PRICE_CACHE_KEY,
              JSON.stringify(currentSnapshot),
            );
          } catch {
            // Ignore localStorage write issues.
          }
        }
        if (!cancelled) {
          setAlertNotificationCount(count);
        }
      } catch {
        if (!cancelled) {
          setAlertNotificationCount(0);
        }
      }
    };

    void loadAlertNotifications();
    const interval = window.setInterval(() => {
      void loadAlertNotifications();
    }, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded || !isSignedIn) {
      setDbFirstName(null);
      return;
    }

    const loadProfileName = async () => {
      try {
        const res = await fetch("/api/user/profile", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const first =
          typeof data.first_name === "string" ? data.first_name.trim() : "";
        if (!cancelled) {
          setDbFirstName(first || null);
        }
      } catch {
        if (!cancelled) {
          setDbFirstName(null);
        }
      }
    };

    const handleProfileUpdated = () => {
      void loadProfileName();
    };

    void loadProfileName();
    window.addEventListener("profile-updated", handleProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("profile-updated", handleProfileUpdated);
    };
  }, [isLoaded, isSignedIn, user]);

  if (pathname === "/chat") return null;

  const clerkFirstFromFull =
    typeof user?.fullName === "string" && user.fullName.trim()
      ? user.fullName.trim().split(/\s+/)[0]
      : null;

  const displayName =
    dbFirstName ||
    (typeof user?.firstName === "string" && user.firstName.trim()
      ? user.firstName.trim()
      : null) ||
    clerkFirstFromFull ||
    user?.emailAddresses[0]?.emailAddress?.split("@")[0] ||
    "User";
  const currentPath = pathname || "/";
  const resolveNavHref = (href: string) =>
    !isSignedIn && guestProtectedRoutes.has(href)
      ? getGuestAuthHref(href)
      : href;

  const handleLogout = async () => {
    setIsDropdownOpen(false);
    const toastId = toast.loading("Signing out…");

    try {
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem("bookwithai_session_id");
        } catch {
          // Ignore session storage cleanup failures during logout.
        }

        try {
          window.localStorage.removeItem(CHAT_CACHE_KEY);
          window.localStorage.removeItem(GUEST_CHAT_COUNT_KEY);
          window.localStorage.removeItem(GUEST_CHAT_LIMIT_DISMISSED_KEY);
          window.localStorage.removeItem(GUEST_AUTH_ACTION_KEY);
        } catch {
          // Ignore local storage cleanup failures during logout.
        }
      }

      const redirectUrl = typeof window === "undefined"
        ? "/sign-in?logged_out=1"
        : new URL("/sign-in?logged_out=1", window.location.origin).toString();

      await signOut({ redirectUrl });
      toast.success("You've been signed out.", { id: toastId });
    } catch {
      toast.error("Sign-out failed. Please try again.", { id: toastId });
    }
  };

  return (
    <nav className="bg-white border-b border-[#E5E7EB]">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <Link
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0B5FFF] to-[#0047CC] flex items-center justify-center">
              <span className="text-white text-base font-semibold">B</span>
            </div>
            <div className="hidden md:block">
              <h1 className="text-[#0A2140] text-[18px] font-semibold">
                Book With AI
              </h1>
            </div>
          </Link>

          <div className="hidden lg:flex items-center gap-1">
            {navItems.slice(0, 3).map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              const href = resolveNavHref(item.href);
              return (
                <Link
                  key={item.href}
                  href={href}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-[#EEF2FF] text-[#0B5FFF]"
                      : "text-[#6B7280] hover:text-[#0A2140]"
                  }`}
                >
                  <span className="relative inline-flex">
                    <Icon className="w-4 h-4" />
                    {item.href === "/deals" && alertNotificationCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#EF4444] text-white text-[10px] leading-4 text-center font-semibold">
                        {alertNotificationCount > 9 ? "9+" : alertNotificationCount}
                      </span>
                    )}
                  </span>
                  <span className="hidden xl:inline">{item.label}</span>
                </Link>
              );
            })}
          </div>

          {isSignedIn ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md hover:bg-[#F3F4F6] transition-colors cursor-pointer border-none bg-transparent ${
                  needsProfileCompletion
                    ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-white animate-pulse"
                    : ""
                }`}
                aria-label="Open profile menu"
                aria-expanded={isDropdownOpen}
                data-onboarding="profile-menu"
              >
                <div className="w-8 h-8 rounded-full bg-[#E5E7EB] flex items-center justify-center">
                  <span className="text-[#374151] text-sm font-semibold">
                    {isLoaded && displayName ? displayName.charAt(0).toUpperCase() : "U"}
                  </span>
                </div>
                <span className="hidden sm:inline text-[#374151] text-sm font-medium">
                  {isLoaded ? displayName : "User"}
                </span>
              </button>

              {isDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-[#E5E7EB] py-2 z-50">
                  <>
                    {profileMenuItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsDropdownOpen(false)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[#374151] hover:bg-[#F9FAFB] transition-colors"
                        >
                          <Icon className="w-4 h-4 text-[#6B7280]" />
                          <span className="text-sm font-medium">{item.label}</span>
                        </Link>
                      );
                    })}

                    <div className="my-2 border-t border-[#E5E7EB]" />

                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[#DC2626] hover:bg-[#FEF2F2] transition-colors cursor-pointer border-none bg-transparent"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="text-sm font-medium">Sign out</span>
                    </button>
                  </>
                </div>
              )}
            </div>
          ) : (
            <Link
              href={getGuestAuthHref(currentPath)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2.5 text-sm font-medium text-white no-underline hover:bg-[#1E40AF] transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Login</span>
            </Link>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 lg:hidden bg-white border-t border-[#E5E7EB] z-50">
        <div className="flex items-center justify-around py-2">
          {[
            { href: "/", icon: Home, label: "Home" },
            { href: "/my-trips", icon: Plane, label: "Trips" },
            { href: "/deals", icon: Bell, label: "Alerts" },
            { href: "/profile", icon: User, label: "Profile" },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const href = resolveNavHref(item.href);
            return (
              <Link
                key={item.href}
                href={href}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors ${
                  isActive ? "text-[#0B5FFF]" : "text-[#6B7280]"
                }`}
              >
                <span className="relative inline-flex">
                  <Icon className="w-5 h-5" />
                  {item.href === "/deals" && alertNotificationCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#EF4444] text-white text-[10px] leading-4 text-center font-semibold">
                      {alertNotificationCount > 9 ? "9+" : alertNotificationCount}
                    </span>
                  )}
                </span>
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
