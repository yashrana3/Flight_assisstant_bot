"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Edit2, Save, X, Lightbulb } from "lucide-react";
import { travelPreferenceSchema, type TravelPreferenceValues } from "@/lib/validations";

interface TravelPreferencesProps {
  userId?: string;
}

const SELECT_STYLE = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
  backgroundPosition: "right 0.75rem center",
  backgroundRepeat: "no-repeat" as const,
  backgroundSize: "1em 1em",
  paddingRight: "2.5rem",
};

const selectClass =
  "flex h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent transition-colors appearance-none cursor-pointer";

export function TravelPreferences({ userId }: TravelPreferencesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { isSubmitting, isDirty },
  } = useForm<TravelPreferenceValues>({
    resolver: zodResolver(travelPreferenceSchema),
    defaultValues: {
      preferred_airlines: [],
      flight_timing: [],
      seat_preference: "Window",
      cabin_class: "Economy",
      travel_style: "Balanced",
      layover_preference: "Max 1 Stop",
      max_layover_time: "4 hours",
      airport_preference: [],
      special_assistance: "None",
      meal_preference: "Vegetarian",
    },
  });

  // Load saved preferences
  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(`/api/user/profile?user_id=${userId}`);
        if (!res.ok) return;
        const data = await res.json();
        const p = data.preferences;
        if (p) {
          reset({
            seat_preference: p.seat_preference ?? "Window",
            meal_preference: p.meal_preference ?? "Vegetarian",
            cabin_class: p.cabin_class ?? "Economy",
            preferred_airlines: p.preferred_airlines ?? [],
            travel_style: p.travel_style ?? "Balanced",
            flight_timing: p.flight_timing ?? [],
            layover_preference: p.layover_preference ?? "Max 1 Stop",
            max_layover_time: p.max_layover_time ?? "4 hours",
            airport_preference: p.airport_preference ?? [],
            special_assistance: p.special_assistance ?? "None",
          });
        }
      } catch {
        // Non-fatal: keep defaults
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [userId, reset]);

  const onSave = async (values: TravelPreferenceValues) => {
    if (!userId) {
      toast.error("Cannot save — user ID is missing.");
      return;
    }
    const toastId = toast.loading("Saving preferences…");
    try {
      const res = await fetch(`/api/user/profile?user_id=${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Save failed");
      toast.success("Travel preferences saved!", { id: toastId });
      setIsEditing(false);
      window.dispatchEvent(new Event("profile-updated"));
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save preferences.",
        { id: toastId }
      );
    }
  };

  const watchedAirlines = watch("preferred_airlines") ?? [];
  const watchedTiming = watch("flight_timing") ?? [];
  const watchedAirports = watch("airport_preference") ?? [];
  const watchedClass = watch("cabin_class") ?? "Economy";
  const watchedStyle = watch("travel_style") ?? "Balanced";

  if (isLoading) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 mt-6 mb-6 animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mt-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E5E7EB]">
        <h2 className="text-[#0A2140] text-base font-semibold">Travel Preferences</h2>
        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center text-[#0B5FFF] hover:text-[#0047CC] hover:bg-[#F0F4FF] gap-1.5 sm:gap-2 h-8 sm:h-9 text-sm px-3 rounded-md transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        ) : (
          <div className="flex gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => { reset(); setIsEditing(false); }}
              className="flex items-center text-[#6B7280] hover:text-[#374151] hover:bg-[#F9FAFB] h-8 sm:h-9 text-sm px-2 sm:px-3 rounded-md transition-colors"
            >
              <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-1" />
              <span className="hidden sm:inline">Cancel</span>
            </button>
            <button
              type="button"
              onClick={handleSubmit(onSave)}
              disabled={isSubmitting || !isDirty}
              className={`flex items-center gap-1.5 sm:gap-2 h-8 sm:h-9 text-sm px-2 sm:px-3 rounded-md transition-colors text-white ${
                isSubmitting || !isDirty
                  ? "bg-[#93C5FD] cursor-default"
                  : "bg-[#0B5FFF] hover:bg-[#0047CC] cursor-pointer"
              }`}
            >
              <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{isSubmitting ? "Saving…" : "Save"}</span>
            </button>
          </div>
        )}
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5">
        <div className="space-y-4 sm:space-y-5">
          {/* Preferred Airlines */}
          <Row label="Preferred Airlines">
            {isEditing ? (
              <TagInput
                tags={watchedAirlines}
                placeholder="Add airline…"
                onChange={(tags) => setValue("preferred_airlines", tags, { shouldDirty: true })}
              />
            ) : (
              <Display value={watchedAirlines.join(", ")} />
            )}
          </Row>

          <Divider />

          {/* Flight Timing */}
          <Row label="Flight Timing">
            {isEditing ? (
              <div className="flex flex-wrap gap-2">
                {["Morning", "Afternoon", "Evening", "Night"].map((t) => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={watchedTiming.includes(t)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...watchedTiming, t]
                          : watchedTiming.filter((x) => x !== t);
                        setValue("flight_timing", next, { shouldDirty: true });
                      }}
                      className="rounded border-[#E5E7EB] text-[#1D4ED8] focus:ring-[#1D4ED8]"
                    />
                    <span className="text-sm text-[#374151]">{t}</span>
                  </label>
                ))}
              </div>
            ) : (
              <Display value={watchedTiming.join(", ")} />
            )}
          </Row>

          <Divider />

          {/* Seat Preference */}
          <Row label="Seat Preference">
            {isEditing ? (
              <select {...register("seat_preference")} className={selectClass} style={SELECT_STYLE}>
                <option value="Window">Window</option>
                <option value="Aisle">Aisle</option>
                <option value="Middle">Middle</option>
                <option value="No preference">No preference</option>
              </select>
            ) : (
              <Display value={watch("seat_preference")} />
            )}
          </Row>

          <Divider />

          {/* Class of Service */}
          <Row label="Class of Service">
            {isEditing ? (
              <div className="flex flex-wrap gap-2">
                {["Economy", "Premium Economy", "Business", "First"].map((cls) => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setValue("cabin_class", cls as TravelPreferenceValues["cabin_class"], { shouldDirty: true })}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition-colors font-medium ${
                      watchedClass === cls
                        ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#D1D5DB]"
                    }`}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            ) : (
              <Display value={watchedClass} />
            )}
          </Row>

          <Divider />

          {/* Travel Style */}
          <Row label="Travel Style">
            {isEditing ? (
              <div className="flex flex-col sm:flex-row gap-2">
                {["Budget Optimized", "Balanced", "Comfort Optimized"].map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => setValue("travel_style", style as TravelPreferenceValues["travel_style"], { shouldDirty: true })}
                    className={`px-3 sm:px-4 py-2 rounded-lg border text-xs sm:text-sm transition-colors font-medium ${
                      watchedStyle === style
                        ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#D1D5DB]"
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            ) : (
              <Display value={watchedStyle} />
            )}
          </Row>

          <Divider />

          {/* Layover Preference */}
          <Row label="Layover Preference">
            {isEditing ? (
              <select {...register("layover_preference")} className={selectClass} style={SELECT_STYLE}>
                <option value="Direct flights only">Direct flights only</option>
                <option value="Max 1 Stop">Maximum 1 stop</option>
                <option value="Max 2 Stops">Maximum 2 stops</option>
                <option value="No preference">No preference</option>
              </select>
            ) : (
              <Display value={watch("layover_preference")} />
            )}
          </Row>

          <Divider />

          {/* Max Layover Time */}
          <Row label="Max Layover Time">
            {isEditing ? (
              <select {...register("max_layover_time")} className={selectClass} style={SELECT_STYLE}>
                <option value="2 hours">No longer than 2 hours</option>
                <option value="4 hours">No longer than 4 hours</option>
                <option value="6 hours">No longer than 6 hours</option>
                <option value="No restriction">No restriction</option>
              </select>
            ) : (
              <Display value={watch("max_layover_time")} />
            )}
          </Row>

          <Divider />

          {/* Airport Preference */}
          <Row label="Airport Preference">
            {isEditing ? (
              <TagInput
                tags={watchedAirports}
                placeholder="Add airport code (e.g. JFK)…"
                onChange={(tags) => setValue("airport_preference", tags, { shouldDirty: true })}
              />
            ) : (
              <Display value={watchedAirports.join(", ")} />
            )}
          </Row>

          <Divider />

          {/* Special Assistance */}
          <Row label="Special Assistance">
            {isEditing ? (
              <select {...register("special_assistance")} className={selectClass} style={SELECT_STYLE}>
                <option value="None">None</option>
                <option value="Wheelchair assistance">Wheelchair assistance</option>
                <option value="Extra legroom required">Extra legroom required</option>
                <option value="Traveling with infant">Traveling with infant</option>
                <option value="Medical assistance">Medical assistance</option>
              </select>
            ) : (
              <Display value={watch("special_assistance")} />
            )}
          </Row>

          <Divider />

          {/* Meal Preference */}
          <Row label="Meal Preference">
            {isEditing ? (
              <select {...register("meal_preference")} className={selectClass} style={SELECT_STYLE}>
                <option value="No preference">No preference</option>
                <option value="Vegetarian">Vegetarian</option>
                <option value="Vegan">Vegan</option>
                <option value="Halal">Halal</option>
                <option value="Kosher">Kosher</option>
                <option value="Gluten-free">Gluten-free</option>
              </select>
            ) : (
              <Display value={watch("meal_preference")} />
            )}
          </Row>
        </div>
      </div>

      {/* AI Insight */}
      <div className="mx-4 sm:mx-6 mb-4 sm:mb-5 bg-[#FAFAFA] border border-[#E5E7EB] rounded-lg p-3 sm:p-4">
        <div className="flex gap-2 sm:gap-3">
          <Lightbulb className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#6B7280] flex-shrink-0 mt-0.5" />
          <p className="text-[#6B7280] text-xs sm:text-sm">
            <span className="text-[#374151] font-medium">AI Insight:</span>{" "}
            Your preferences will be used to personalise flight recommendations in the AI chat.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable sub-components ────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
      <div className="sm:w-48 flex-shrink-0">
        <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">{label}</p>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#F3F4F6]" />;
}

function Display({ value }: { value?: string | null }) {
  return (
    <p className={`text-[13px] font-medium ${value ? "text-[#111827]" : "text-[#9CA3AF]"}`}>
      {value || "—"}
    </p>
  );
}

function TagInput({
  tags,
  placeholder,
  onChange,
}: {
  tags: string[];
  placeholder: string;
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
  };

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] text-[#3730A3] px-2.5 py-0.5 text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            className="ml-0.5 hover:text-red-500 transition-colors"
            aria-label={`Remove ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
        }}
        onBlur={addTag}
        placeholder={placeholder}
        className="min-w-[140px] flex-1 h-8 border border-[#E5E7EB] rounded-md px-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] text-[#374151]"
      />
    </div>
  );
}
