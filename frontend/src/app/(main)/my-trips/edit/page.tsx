import { Suspense } from "react";
import TripAiEditorClient from "./TripAiEditorClient";

export const dynamic = "force-dynamic";

export default function TripAiEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center text-[#6B7280]">
          Loading…
        </div>
      }
    >
      <TripAiEditorClient />
    </Suspense>
  );
}
