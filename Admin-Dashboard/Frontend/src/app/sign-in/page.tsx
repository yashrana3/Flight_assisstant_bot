"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { clearAdminClientCache } from "@/lib/admin-session";

type SetupStatusResponse = {
  needsSetup: boolean;
  detail?: string;
};

export default function AdminSignInPage() {
  const router = useRouter();
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    fullName: "",
    email: "",
  });

  useEffect(() => {
    clearAdminClientCache();

    const load = async () => {
      try {
        const response = await fetch("/api/admin/auth/setup-status", { cache: "no-store" });
        const payload = (await response.json()) as SetupStatusResponse;
        if (!response.ok) {
          throw new Error(payload.detail || "Could not load admin setup status.");
        }
        setNeedsSetup(Boolean(payload.needsSetup));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load admin setup status.");
      } finally {
        setLoadingSetup(false);
      }
    };

    void load();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (!form.username.trim() || !form.password.trim()) {
        throw new Error("Username and password are required.");
      }

      const endpoint = needsSetup ? "/api/admin/auth/bootstrap" : "/api/admin/auth/sign-in";
      const body = needsSetup
        ? {
            username: form.username,
            password: form.password,
            fullName: form.fullName,
            email: form.email,
          }
        : {
            username: form.username,
            password: form.password,
          };

      if (needsSetup) {
        if (!form.fullName.trim() || !form.email.trim()) {
          throw new Error("Full name and email are required for the first super admin.");
        }
        if (form.password !== form.confirmPassword) {
          throw new Error("Passwords do not match.");
        }
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error("Authentication failed.");
      }

      // Full navigation so the browser reliably sends the new httpOnly cookie on the
      // first dashboard load (client router transitions can race cookie application).
      if (typeof window !== "undefined") {
        window.location.assign("/");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md items-center justify-center px-4">
      <div className="w-full rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="mb-6 text-center text-lg font-semibold text-gray-900">
          Book with ai admin panel
        </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {needsSetup ? (
                <>
                  <label className="block text-sm text-gray-700">
                    Full Name
                    <input
                      value={form.fullName}
                      onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder="Super Admin"
                    />
                  </label>
                  <label className="block text-sm text-gray-700">
                    Email
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      placeholder="admin@bookwithai.ai"
                    />
                  </label>
                </>
              ) : null}

              <label className="block text-sm text-gray-700">
                Username
                <input
                  value={form.username}
                  onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="username"
                />
              </label>

              <label className="block text-sm text-gray-700">
                Password
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="••••••••"
                />
              </label>

              {needsSetup ? (
                <label className="block text-sm text-gray-700">
                  Confirm Password
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(event) => setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    placeholder="••••••••"
                  />
                </label>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting || loadingSetup}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? "Please wait..."
                  : needsSetup
                    ? "Create Super Admin"
                    : "Sign In"}
              </button>
            </form>
      </div>
    </div>
  );
}
