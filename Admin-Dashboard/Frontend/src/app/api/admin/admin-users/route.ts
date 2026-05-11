import { NextRequest, NextResponse } from "next/server";

import { createAdminUser, getAdminUsers, getRouteError } from "@/backend/admin-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAdminUsers());
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json(
      await createAdminUser({
        username: String(body?.username ?? ""),
        full_name: String(body?.fullName ?? ""),
        email: String(body?.email ?? ""),
        password: String(body?.password ?? ""),
      }),
    );
  } catch (err) {
    const { status, detail } = getRouteError(err);
    return NextResponse.json({ detail }, { status });
  }
}
