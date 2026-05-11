import type { NextRequest } from "next/server";

import { toRangeDays } from "@/lib/admin-range";

export function getRangeDaysFromRequest(request: NextRequest): number {
  const raw =
    request.nextUrl.searchParams.get("range") ??
    request.nextUrl.searchParams.get("days");

  if (!raw) return 7;
  if (/^\d+$/.test(raw)) {
    return toRangeDays(`${raw}d`);
  }
  return toRangeDays(raw);
}

