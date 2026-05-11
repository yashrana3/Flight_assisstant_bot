"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, Info } from "lucide-react";
import { useProfileCompletion } from "./ProfileCompletionProvider";

export function ProfileCompletionBanner() {
  const pathname = usePathname();
  const { loading, needsProfileCompletion, missingFields, goToProfile } = useProfileCompletion();

  const preview = useMemo(() => missingFields.slice(0, 3).join(", "), [missingFields]);

  if (pathname === "/profile" || loading || !needsProfileCompletion) return null;

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white">
      <div className="max-w-[1400px] mx-auto px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 text-white/90 flex-shrink-0" />
          <div className="text-[13px] leading-5">
            <p className="font-semibold">
              Complete your profile to unlock a better experience.
            </p>
            <p className="text-white/90">
              Missing: <span className="font-medium">{preview}</span>
              {missingFields.length > 3 ? ` +${missingFields.length - 3} more` : ""}.{" "}
              Click your profile icon (top right) or use the button.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={goToProfile}
          className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-[13px] font-semibold transition-colors"
        >
          Complete profile
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
