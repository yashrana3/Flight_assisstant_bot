"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  Plus,
  TrendingUp,
  ChevronDown,
  X,
  Lightbulb,
  Send,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import AuthRequiredCard from "@/components/AuthRequiredCard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CUSTOM_LOYALTY_PROGRAM_VALUE,
  findLoyaltyProgramOption,
  findLoyaltyProgramOptionByProgram,
  LOYALTY_PROGRAM_OPTIONS,
} from "@/lib/loyalty-program-options";

interface LoyaltyCard {
  id: string;
  airline: string;
  programName: string;
  memberNumber: string;
  currentMiles: number;
  tierStatus: string;
  nextTier: string;
  milesToNextTier: number;
  plannedOrigin?: string;
  plannedDestination?: string;
  plannedFlightNumber?: string;
  travelerName?: string;
  travelerEmail?: string;
  travelerPhone?: string;
  notes?: string;
  recommendationMessage?: string;
}

interface LoyaltyActivityItem {
  id: string;
  date: string;
  description: string;
  type: "earned" | "redeemed" | string;
  miles: number;
  balance: number;
}

interface LoyaltyFormData {
  selectedProgram: string;
  airline: string;
  programName: string;
  memberNumber: string;
  currentMiles: string;
  tierStatus: string;
  nextTier: string;
}

type SelectOption = {
  value: string;
  label: string;
};

const loyaltyCards: LoyaltyCard[] = [];
const BASE_TIER_OPTIONS = ["Bronze", "Silver", "Gold", "Platinum"];
const PROGRAM_SELECT_OPTIONS: SelectOption[] = [
  ...LOYALTY_PROGRAM_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  })),
  {
    value: CUSTOM_LOYALTY_PROGRAM_VALUE,
    label: "Custom program",
  },
];

function getTierBadgeStyle(tier: string) {
  switch (tier) {
    case "Brown":
    case "Bronze":
      return "bg-[#F9EDE3] text-[#8A5A2B] border-[#E9C7A8]";
    case "Silver":
      return "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]";
    case "Gold":
      return "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]";
    case "Platinum":
      return "bg-[#F1F5F9] text-[#475569] border-[#E2E8F0]";
    default:
      return "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]";
  }
}

function mapProgramToCard(program: Record<string, unknown>): LoyaltyCard {
  return {
    id: String(program.id ?? ""),
    airline: String(program.airline ?? ""),
    programName: String(program.program_name ?? ""),
    memberNumber: String(program.member_number ?? ""),
    currentMiles: Number(program.current_miles ?? 0),
    tierStatus: String(program.tier_status ?? ""),
    nextTier: String(program.next_tier ?? ""),
    milesToNextTier: Number(program.miles_to_next_tier ?? 0),
    plannedOrigin: String(program.planned_origin ?? ""),
    plannedDestination: String(program.planned_destination ?? ""),
    plannedFlightNumber: String(program.planned_flight_number ?? ""),
    travelerName: String(program.traveler_name ?? ""),
    travelerEmail: String(program.traveler_email ?? ""),
    travelerPhone: String(program.traveler_phone ?? ""),
    notes: String(program.notes ?? ""),
    recommendationMessage: String(program.recommendation_message ?? ""),
  };
}

function createEmptyFormData(): LoyaltyFormData {
  return {
    selectedProgram: "",
    airline: "",
    programName: "",
    memberNumber: "",
    currentMiles: "0",
    tierStatus: "Silver",
    nextTier: "Gold",
  };
}

function buildFormDataFromCard(card: LoyaltyCard): LoyaltyFormData {
  const matchingProgram = findLoyaltyProgramOptionByProgram(card.airline, card.programName);

  return {
    selectedProgram: matchingProgram?.value ?? CUSTOM_LOYALTY_PROGRAM_VALUE,
    airline: card.airline,
    programName: card.programName,
    memberNumber: card.memberNumber,
    currentMiles: String(card.currentMiles),
    tierStatus: card.tierStatus || "Silver",
    nextTier: card.nextTier || "Gold",
  };
}

function getTierOptions(value: string): SelectOption[] {
  const options =
    value && !BASE_TIER_OPTIONS.includes(value)
      ? [...BASE_TIER_OPTIONS, value]
      : BASE_TIER_OPTIONS;
  return options.map((option) => ({ value: option, label: option }));
}

export default function LoyaltyPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [cards, setCards] = useState<LoyaltyCard[]>(loyaltyCards);
  const [activitiesByProgram, setActivitiesByProgram] = useState<Record<string, LoyaltyActivityItem[]>>({});
  const [activityLoadingProgram, setActivityLoadingProgram] = useState<string | null>(null);
  const [isAddProgramOpen, setIsAddProgramOpen] = useState(false);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingProgramId, setDeletingProgramId] = useState<string | null>(null);
  const [formData, setFormData] = useState<LoyaltyFormData>(createEmptyFormData());

  useEffect(() => {
    if (!isSignedIn) return;
    const loadPrograms = async () => {
      try {
        const res = await fetch("/api/loyalty/programs", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const programs = Array.isArray(data.programs) ? data.programs : [];
        setCards(programs.map((program: Record<string, unknown>) => mapProgramToCard(program)));
      } catch {
        // Keep local mock cards when API load fails
      }
    };
    loadPrograms();
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !expandedCardId) return;
    const loadActivities = async () => {
      setActivityLoadingProgram(expandedCardId);
      try {
        const res = await fetch(
          `/api/loyalty/activities?program_id=${encodeURIComponent(expandedCardId)}&limit=5`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          if (res.status !== 401) {
            setActivitiesByProgram((prev) => ({ ...prev, [expandedCardId]: [] }));
          }
          return;
        }
        const data = await res.json();
        const activities = Array.isArray(data.activities) ? data.activities : [];
        setActivitiesByProgram((prev) => ({
          ...prev,
          [expandedCardId]: activities.map((a: Record<string, unknown>) => ({
            id: String(a.id ?? ""),
            date: String(a.date ?? ""),
            description: String(a.description ?? ""),
            type: String(a.type ?? "earned"),
            miles: Number(a.miles ?? 0),
            balance: Number(a.balance ?? 0),
          })),
        }));
      } catch {
        setActivitiesByProgram((prev) => ({ ...prev, [expandedCardId]: [] }));
      } finally {
        setActivityLoadingProgram((curr) => (curr === expandedCardId ? null : curr));
      }
    };
    loadActivities();
  }, [expandedCardId, isSignedIn]);

  const openAddProgram = () => {
    setEditingProgramId(null);
    setFormData(createEmptyFormData());
    setIsAddProgramOpen(true);
  };

  const openEditProgram = (card: LoyaltyCard) => {
    setEditingProgramId(card.id);
    setFormData(buildFormDataFromCard(card));
    setIsAddProgramOpen(true);
  };

  const deleteProgram = async (card: LoyaltyCard) => {
    const label = card.programName || card.airline || "this program";
    if (
      !window.confirm(
        `Remove ${label} from your saved programs? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeletingProgramId(card.id);
    try {
      const res = await fetch(`/api/loyalty/programs/${encodeURIComponent(card.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : "Failed to delete program",
        );
      }
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      setActivitiesByProgram((prev) => {
        const next = { ...prev };
        delete next[card.id];
        return next;
      });
      if (expandedCardId === card.id) {
        setExpandedCardId(null);
      }
      if (editingProgramId === card.id) {
        closeProgramDialog();
      }
      toast.success("Program removed.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete program.");
    } finally {
      setDeletingProgramId(null);
    }
  };

  const closeProgramDialog = () => {
    setIsAddProgramOpen(false);
    setEditingProgramId(null);
    setFormData(createEmptyFormData());
  };

  const handleProgramSelectionChange = (value: string) => {
    if (value === CUSTOM_LOYALTY_PROGRAM_VALUE) {
      setFormData((current) => ({
        ...current,
        selectedProgram: value,
      }));
      return;
    }

    const selectedProgram = findLoyaltyProgramOption(value);
    if (!selectedProgram) {
      setFormData((current) => ({
        ...current,
        selectedProgram: value,
      }));
      return;
    }

    setFormData((current) => ({
      ...current,
      selectedProgram: value,
      airline: selectedProgram.airline,
      programName: selectedProgram.programName,
    }));
  };

  const saveProgram = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.selectedProgram) {
      toast.error("Choose a loyalty program.");
      return;
    }

    if (formData.selectedProgram === CUSTOM_LOYALTY_PROGRAM_VALUE && !formData.airline.trim()) {
      toast.error("Airline name is required.");
      return;
    }

    if (formData.selectedProgram === CUSTOM_LOYALTY_PROGRAM_VALUE && !formData.programName.trim()) {
      toast.error("Program name is required.");
      return;
    }
    if (!formData.memberNumber.trim()) {
      toast.error("Membership number is required.");
      return;
    }

    const currentMilesNum = Number(formData.currentMiles || "0");
    if (!Number.isFinite(currentMilesNum) || currentMilesNum < 0) {
      toast.error("Current miles must be a valid number.");
      return;
    }
    if (formData.tierStatus.trim() === formData.nextTier.trim()) {
      toast.error("Choose a different tier to upgrade to.");
      return;
    }
    setIsSaving(true);
    const chosenProgram =
      formData.selectedProgram === CUSTOM_LOYALTY_PROGRAM_VALUE
        ? null
        : findLoyaltyProgramOption(formData.selectedProgram);
    const payload = {
      airline: (chosenProgram?.airline ?? formData.airline).trim(),
      program_name: (chosenProgram?.programName ?? formData.programName).trim(),
      member_number: formData.memberNumber.trim(),
      current_miles: currentMilesNum,
      tier_status: formData.tierStatus.trim(),
      next_tier: formData.nextTier.trim(),
    };
    try {
      const isEditing = Boolean(editingProgramId);
      const res = await fetch(
        isEditing ? `/api/loyalty/programs/${editingProgramId}` : "/api/loyalty/programs",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail ?? "Failed to save loyalty program");
      }
      const updatedCard = mapProgramToCard(data.program as Record<string, unknown>);
      setCards((prev) =>
        isEditing
          ? prev.map((card) => (card.id === updatedCard.id ? updatedCard : card))
          : [updatedCard, ...prev],
      );
      setExpandedCardId(updatedCard.id);
      toast.success(isEditing ? "Program updated successfully." : "Program saved successfully.");
      closeProgramDialog();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save loyalty program.");
    } finally {
      setIsSaving(false);
    }
  };

  const isEditingProgram = Boolean(editingProgramId);
  const isCustomProgram = formData.selectedProgram === CUSTOM_LOYALTY_PROGRAM_VALUE;
  const currentTierOptions = getTierOptions(formData.tierStatus);
  const nextTierOptions = getTierOptions(formData.nextTier);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
        <div className="max-w-[1200px] mx-auto px-6 py-8 pb-24 lg:pb-8">
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-8 text-center text-[#6B7280]">
            Loading loyalty programs...
          </div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <AuthRequiredCard
        title="Log in to view loyalty & miles"
        description="Your airline memberships and milestones belong to your account. Sign in to manage them here."
        redirectUrl="/loyalty"
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
      <div className="max-w-[1200px] mx-auto px-6 py-8 pb-24 lg:pb-8">
        <div style={{ animation: "fadeIn 0.5s ease-out" }}>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-[#0A2140] mb-2" style={{ fontSize: "24px", fontWeight: "600" }}>
                Loyalty & Miles
              </h1>
              <p className="text-[#6B7280] text-sm sm:text-base">
                Manage your frequent flyer programs and rewards.
              </p>
            </div>
            <button
              onClick={openAddProgram}
              className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-white flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border-none w-full sm:w-auto justify-center"
            >
              <Plus className="w-4 h-4" />
              Add Program
            </button>
          </div>

          <h2 className="text-[#111827] mb-4" style={{ fontSize: "16px", fontWeight: "500" }}>
            Frequent Flyer Programs
          </h2>

          <div className="space-y-3">
            {cards.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-white p-8 text-center">
                <p className="text-[#0A2140] text-base font-medium mb-2">
                  No loyalty programs saved yet
                </p>
                <p className="text-[#6B7280] text-sm mb-4">
                  Add your airline memberships here so you can track miles and tier progress.
                </p>
                <button
                  type="button"
                  onClick={openAddProgram}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white hover:bg-[#1E40AF] border-none cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Add your first program
                </button>
              </div>
            )}

            {cards.map((card, index) => {
              const isExpanded = expandedCardId === card.id;
              const progressPercentage =
                (card.currentMiles /
                  Math.max(card.currentMiles + card.milesToNextTier, 1)) *
                100;
              const memberNumber = card.memberNumber.trim() || "Not added";
              const isMemberNumberMissing = !card.memberNumber.trim();

              return (
                <div
                  key={card.id}
                  className="bg-white rounded-lg border border-[#E5E7EB] hover:border-[#D1D5DB] transition-all overflow-hidden animate-slide-up"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div
                    className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                    onClick={() => setExpandedCardId(isExpanded ? null : card.id)}
                  >
                    <div className="hidden sm:flex sm:items-center sm:gap-4 sm:flex-1">
                      <div className="flex-shrink-0" style={{ width: "220px" }}>
                        <p className="text-[#0A2140]" style={{ fontSize: "15px", fontWeight: "600" }}>
                          {card.airline}
                        </p>
                        <p className="text-[#6B7280] text-sm">{card.programName || "Program"}</p>
                      </div>
                      <div className="flex-shrink-0" style={{ width: "160px" }}>
                        <p className="text-[#6B7280] text-xs mb-0.5">Membership #</p>
                        <p
                          className={`font-mono text-sm ${isMemberNumberMissing ? "text-[#9CA3AF]" : "text-[#374151]"}`}
                          style={{ fontWeight: "500" }}
                        >
                          {memberNumber}
                        </p>
                      </div>
                      <div className="flex-shrink-0" style={{ width: "120px" }}>
                        <p className="text-[#6B7280] text-xs mb-0.5">Miles</p>
                        <p className="text-[#0A2140]" style={{ fontSize: "16px", fontWeight: "600" }}>
                          {card.currentMiles.toLocaleString()}
                        </p>
                      </div>
                      <span
                        className={`${getTierBadgeStyle(card.tierStatus)} px-3 py-1 rounded-full text-[13px] border`}
                        style={{ fontWeight: "500" }}
                      >
                        {card.tierStatus}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 sm:hidden">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[#0A2140] truncate" style={{ fontSize: "14px", fontWeight: "600" }}>
                            {card.airline}
                          </p>
                          <p className="text-[#6B7280] text-xs truncate">
                            {card.programName || "Program"}
                          </p>
                        </div>
                        <span
                          className={`${getTierBadgeStyle(card.tierStatus)} px-2 py-0.5 rounded-full text-[11px] border`}
                          style={{ fontWeight: "500" }}
                        >
                          {card.tierStatus}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[#6B7280] text-[10px] mb-0.5">Membership #</p>
                          <p
                            className={`font-mono text-xs ${isMemberNumberMissing ? "text-[#9CA3AF]" : "text-[#374151]"}`}
                            style={{ fontWeight: "500" }}
                          >
                            {memberNumber}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[#6B7280] text-[10px] mb-0.5">Miles</p>
                          <p className="text-[#0A2140]" style={{ fontSize: "14px", fontWeight: "600" }}>
                            {card.currentMiles.toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-1.5 flex-shrink-0"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="h-9 w-9 p-0 text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6] rounded-md inline-flex items-center justify-center transition-colors cursor-pointer border-none bg-transparent"
                            aria-label={`Open menu for ${card.programName || card.airline}`}
                          >
                            <MoreVertical className="w-5 h-5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-44 bg-white border-[#E5E7EB] shadow-lg rounded-md p-1 z-50"
                        >
                          <DropdownMenuItem
                            className="flex items-center gap-2 cursor-pointer text-[#374151] hover:bg-[#F3F4F6] px-2 py-1.5 rounded-sm outline-none"
                            onSelect={() => {
                              openEditProgram(card);
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                            Edit program
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-[#E5E7EB]" />
                          <DropdownMenuItem
                            className="flex items-center gap-2 cursor-pointer text-[#DC2626] hover:bg-[#FEF2F2] focus:text-[#DC2626] px-2 py-1.5 rounded-sm outline-none"
                            disabled={deletingProgramId === card.id}
                            onSelect={() => {
                              void deleteProgram(card);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                            {deletingProgramId === card.id ? "Deleting…" : "Delete program"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <ChevronDown
                        className={`w-5 h-5 text-[#9CA3AF] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div
                      className="px-3 sm:px-5 pb-4 sm:pb-5 pt-2 border-t border-[#F3F4F6] bg-[#FAFBFC]"
                      style={{ animation: "fadeInUp 0.3s ease-out" }}
                    >
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[#6B7280] text-xs sm:text-sm">
                            Progress to{" "}
                            <span className="text-[#0A2140]" style={{ fontWeight: "600" }}>
                              {card.nextTier}
                            </span>
                          </p>
                          <p className="text-[#0A2140] text-xs sm:text-sm" style={{ fontWeight: "600" }}>
                            {card.milesToNextTier.toLocaleString()} miles to go
                          </p>
                        </div>
                        <div className="w-full h-2 bg-[#E5E7EB] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#1D4ED8] rounded-full transition-all duration-500"
                            style={{ width: `${progressPercentage}%` }}
                          />
                        </div>
                      </div>

                      {card.recommendationMessage && (
                        <div className="bg-[#FAFAFA] border border-[#E5E7EB] rounded-lg p-3 mb-4">
                          <div className="flex items-start gap-2">
                            <Lightbulb className="w-3.5 h-3.5 text-[#6B7280] flex-shrink-0 mt-0.5" />
                            <p className="text-[#6B7280] text-xs sm:text-sm">
                              <span className="text-[#374151] font-medium">AI Insight:</span>{" "}
                              {card.recommendationMessage}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mb-4">
                        <button className="text-[#1D4ED8] hover:bg-[#EFF6FF] px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border border-[#1D4ED8] bg-transparent flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5" />
                          Earn More Miles
                        </button>
                        <button className="text-[#374151] hover:bg-[#F3F4F6] px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer border border-[#E5E7EB] bg-transparent">
                          View Activity
                        </button>
                      </div>

                      <h3
                        className="text-[#374151] text-xs sm:text-sm mb-2"
                        style={{ fontWeight: "500" }}
                      >
                        Recent Activity
                      </h3>
                      <div className="space-y-2">
                        {activityLoadingProgram === card.id && (
                          <p className="text-[#9CA3AF] text-xs sm:text-sm">Loading activity...</p>
                        )}
                        {activityLoadingProgram !== card.id &&
                          (activitiesByProgram[card.id] ?? []).length === 0 && (
                            <p className="text-[#9CA3AF] text-xs sm:text-sm">
                              No activity yet. Save a program to start tracking membership updates.
                            </p>
                          )}
                        {activityLoadingProgram !== card.id &&
                          (activitiesByProgram[card.id] ?? []).map((activity, idx) => (
                            <div
                              key={activity.id || `${card.id}-${idx}`}
                              className="flex items-start justify-between py-2 border-b border-[#F3F4F6] last:border-0 gap-3"
                            >
                              <div className="flex-1 min-w-0">
                                <p
                                  className="text-[#374151] text-xs sm:text-sm mb-1 line-clamp-2"
                                  style={{ fontWeight: "500" }}
                                >
                                  {activity.description}
                                </p>
                                <p className="text-[#9CA3AF] text-[10px] sm:text-xs">
                                  {new Date(activity.date).toLocaleDateString("en-US", {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p
                                  className={`text-xs sm:text-sm mb-1 ${activity.type === "earned" ? "text-[#059669]" : "text-[#DC2626]"}`}
                                  style={{ fontWeight: "600" }}
                                >
                                  {activity.type === "earned" ? "+" : ""}
                                  {activity.miles.toLocaleString()}
                                </p>
                                <p className="text-[#9CA3AF] text-[10px] sm:text-xs">
                                  Balance: {activity.balance.toLocaleString()}
                                </p>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isAddProgramOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={closeProgramDialog}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[#0A2140] text-lg font-semibold">
                {isEditingProgram ? "Edit Loyalty Program" : "Add Loyalty Program"}
              </h3>
              <button
                type="button"
                onClick={closeProgramDialog}
                className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280] border-none cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={saveProgram} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField
                  label="Loyalty Program *"
                  value={formData.selectedProgram}
                  onChange={handleProgramSelectionChange}
                  options={PROGRAM_SELECT_OPTIONS}
                  placeholder="Select a program"
                />
                <InputField
                  label="Membership Number *"
                  value={formData.memberNumber}
                  onChange={(value) => setFormData((current) => ({ ...current, memberNumber: value }))}
                  placeholder="Add your membership number"
                />

                {isCustomProgram && (
                  <InputField
                    label="Airline *"
                    value={formData.airline}
                    onChange={(value) => setFormData((current) => ({ ...current, airline: value }))}
                    placeholder="Enter airline name"
                  />
                )}
                {isCustomProgram && (
                  <InputField
                    label="Program Name *"
                    value={formData.programName}
                    onChange={(value) => setFormData((current) => ({ ...current, programName: value }))}
                    placeholder="Enter loyalty program"
                  />
                )}

                <InputField
                  label="Current Miles"
                  type="number"
                  value={formData.currentMiles}
                  onChange={(value) => setFormData((current) => ({ ...current, currentMiles: value }))}
                />
                <SelectField
                  label="Current Tier"
                  value={formData.tierStatus}
                  onChange={(value) => setFormData((current) => ({ ...current, tierStatus: value }))}
                  options={currentTierOptions}
                />
                <SelectField
                  label="Upgrade To Tier"
                  value={formData.nextTier}
                  onChange={(value) => setFormData((current) => ({ ...current, nextTier: value }))}
                  options={nextTierOptions}
                />
              </div>

              <div className="bg-[#FAFAFA] border border-[#E5E7EB] rounded-lg p-3">
                <div className="flex gap-2">
                  <Lightbulb className="w-4 h-4 text-[#6B7280] flex-shrink-0 mt-0.5" />
                  <p className="text-[#6B7280] text-sm">
                    Choose an airline program from the list, add your membership number, and we'll generate a short upgrade recommendation when you submit.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeProgramDialog}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border-none cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-50 border-none cursor-pointer flex items-center gap-2"
                >
                  {isSaving
                    ? "Saving..."
                    : isEditingProgram
                      ? "Save Changes"
                      : "Save Program"}
                  {!isSaving && <Send className="w-4 h-4" />}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#374151] focus:border-[#1D4ED8] focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#374151] mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#374151] focus:border-[#1D4ED8] focus:outline-none bg-white"
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
