"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import AuthRequiredCard from "@/components/AuthRequiredCard";

interface PriceAlertFromApi {
  id: string;
  origin: string;
  destination: string;
  route: string;
  airline: string | null;
  dateRange: string | null;
  active: boolean;
  currentPrice: number | null;
  lowestPrice: number | null;
  currency: string | null;
  bookUrl?: string | null;
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";

  const code = (currency ?? "USD").toUpperCase();
  try {
    const locale = code === "USD" ? "en-US" : "en-IN";
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    const fallbackSymbol = code === "INR" ? "₹" : code === "USD" ? "$" : `${code} `;
    const locale = code === "USD" ? "en-US" : "en-IN";
    return `${fallbackSymbol}${amount.toLocaleString(locale)}`;
  }
}

export default function EditDealAlertClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useUser();
  const alertId = searchParams.get("id");
  const isCreateMode = !alertId;

  const [alert, setAlert] = useState<PriceAlertFromApi | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loadingAlert, setLoadingAlert] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!isLoaded || !isSignedIn) {
      if (isLoaded && !isSignedIn) {
        setLoadingAlert(false);
      }
      return;
    }

    if (isCreateMode || !alertId) {
      setLoadingAlert(false);
      return;
    }

    const loadAlert = async () => {
      setLoadingAlert(true);
      try {
        const res = await fetch(`/api/price-alerts/${encodeURIComponent(alertId)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.detail ?? "Failed to load alert.");
        }
        if (!cancelled) {
          setAlert(data.alert);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load alert.",
        );
        router.push("/deals");
      } finally {
        if (!cancelled) {
          setLoadingAlert(false);
        }
      }
    };

    void loadAlert();

    return () => {
      cancelled = true;
    };
  }, [alertId, isCreateMode, router, isLoaded, isSignedIn]);

  const redirectUrl = alertId
    ? `/deals/edit?id=${encodeURIComponent(alertId)}`
    : "/deals/edit";

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
        <div className="max-w-[880px] mx-auto px-6 py-8 pb-24 lg:pb-12">
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[#6B7280]">
            Loading alert editor…
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <AuthRequiredCard
        title="Log in to edit alerts"
        description="Price alert editing is tied to your account, so guests need to sign in before creating or updating alerts."
        redirectUrl={redirectUrl}
      />
    );
  }

  const handleBack = () => {
    router.push("/deals");
  };

  const handleSubmit = async () => {
    if (!instruction.trim()) {
      toast.error("Tell the AI what alert you want to create or update.");
      return;
    }

    if (!isSignedIn) {
      router.push("/sign-up?redirect_url=/deals");
      return;
    }

    setSaving(true);
    const toastId = toast.loading(
      isCreateMode ? "Saving alert with AI…" : "Updating alert with AI…",
    );

    try {
      const endpoint = isCreateMode
        ? "/api/price-alerts/ai-create"
        : `/api/price-alerts/${encodeURIComponent(alertId as string)}/ai-edit`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? "AI save failed.");
      }

      toast.success(
        isCreateMode ? "Alert saved successfully." : "Alert updated successfully.",
        { id: toastId },
      );
      router.push("/deals");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "AI save failed.",
        { id: toastId },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleBook = () => {
    if (!alert?.bookUrl) {
      toast.error("This alert needs a departure date before it can open a booking page.");
      return;
    }

    window.location.assign(alert.bookUrl);
  };

  const pageTitle = isCreateMode ? "Add Alert" : "Edit Alert With AI";
  const pageSubtitle = isCreateMode
    ? "Describe the route, dates, and airline preferences and the assistant will save the alert."
    : "Tell the assistant what should change and it will update the alert in the database.";

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
      <div className="max-w-[880px] mx-auto px-6 py-8 pb-24 lg:pb-12">
        <button
          onClick={handleBack}
          className="mb-6 flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1E40AF] cursor-pointer bg-transparent border-none p-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Price Alerts
        </button>

        <div className="space-y-5" style={{ animation: "fadeIn 0.4s ease-out" }}>
          <div>
            <h1
              className="text-[#0A2140] mb-1 text-2xl sm:text-[28px]"
              style={{ fontWeight: 700 }}
            >
              {pageTitle}
            </h1>
            <p className="text-[#6B7280] text-sm sm:text-base">
              {pageSubtitle}
            </p>
          </div>

          <div className="rounded-2xl border border-[#DBEAFE] bg-[#EFF6FF] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#1D4ED8] text-white flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-[#1E3A8A] text-base sm:text-lg font-semibold">
                  Prompt the AI naturally
                </h2>
                <p className="text-[#3730A3] mt-1 text-sm leading-6">
                  Examples:{" "}
                  <span className="font-medium">
                    “Track Delhi to Dubai for Emirates in May 2026 and keep the alert active”
                  </span>{" "}
                  or{" "}
                  <span className="font-medium">
                    “Change this alert to BOM to SIN, any airline, flexible dates, and pause it”
                  </span>
                  .
                </p>
              </div>
            </div>
          </div>

          {!isCreateMode && loadingAlert && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-[#6B7280]">
              Loading alert details…
            </div>
          )}

          {!isCreateMode && !loadingAlert && alert && (
            <div className="rounded-2xl bg-white border border-[#E5E7EB] p-5 sm:p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div>
                  <h2
                    className="text-[#0A2140] mb-4 text-base sm:text-lg"
                    style={{ fontWeight: 600 }}
                  >
                    Current alert details
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[#6B7280]">Route</p>
                      <p className="text-[#111827] font-medium">{alert.route}</p>
                    </div>
                    <div>
                      <p className="text-[#6B7280]">Airline</p>
                      <p className="text-[#111827] font-medium">
                        {alert.airline || "Any airline"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#6B7280]">Dates</p>
                      <p className="text-[#111827] font-medium">
                        {alert.dateRange || "Any dates"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#6B7280]">Status</p>
                      <p className="text-[#111827] font-medium">
                        {alert.active ? "Active" : "Paused"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#6B7280]">Current price</p>
                      <p className="text-[#111827] font-medium">
                        {formatCurrency(alert.currentPrice, alert.currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#6B7280]">Lowest tracked</p>
                      <p className="text-[#111827] font-medium">
                        {formatCurrency(alert.lowestPrice, alert.currency)}
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleBook}
                  disabled={!alert.bookUrl}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F8FAFC] border border-[#E5E7EB] px-4 py-2 text-sm font-medium text-[#0A2140] hover:bg-[#F1F5F9] disabled:opacity-50 border-solid cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  Book
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white border border-[#E5E7EB] p-5 sm:p-6 shadow-sm">
            <label
              htmlFor="alert-ai-instruction"
              className="block text-[#0A2140] text-sm font-semibold mb-2"
            >
              What should the AI save?
            </label>
            <textarea
              id="alert-ai-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={7}
              placeholder={
                isCreateMode
                  ? "Describe the alert you want to create."
                  : "Describe exactly what should change on this alert."
              }
              className="w-full rounded-xl border border-[#E5E7EB] px-4 py-3 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] resize-none"
            />

            <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving || loadingAlert || !isLoaded}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {isCreateMode ? "Save With AI" : "Update With AI"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
