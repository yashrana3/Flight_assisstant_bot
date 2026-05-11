import { Suspense } from "react";
import EditDealAlertClient from "./EditDealAlertClient";

export const dynamic = "force-dynamic";

export default function EditDealAlertPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center text-[#6B7280]">
          Loading…
        </div>
      }
    >
      <EditDealAlertClient />
    </Suspense>
  );
}
