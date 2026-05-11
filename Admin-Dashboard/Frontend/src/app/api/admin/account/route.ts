import { NextRequest, NextResponse } from "next/server";

import { getRouteError, updateCurrentAdmin } from "@/backend/admin-api";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json(
      await updateCurrentAdmin({
        username: String(body?.username ?? ""),
        full_name: String(body?.fullName ?? ""),
        email: String(body?.email ?? ""),
        current_password: body?.currentPassword ? String(body.currentPassword) : undefined,
        new_password: body?.newPassword ? String(body.newPassword) : undefined,
      }),
    );
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
