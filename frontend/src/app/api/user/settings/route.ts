import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { userSettingsSchema } from "@/lib/validations";
import { getCurrentDbUser } from "@/lib/current-db-user";

/**
 * GET /api/user/settings?user_id=<uuid>
 * Returns the user's settings or default values if not yet persisted.
 */
export async function GET(request: NextRequest) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }
  if (userId !== currentDbUser.id) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const settings = await prisma.userSettings.findUnique({
      where: { user_id: userId },
    });

    // Return DB record or sensible defaults
    return NextResponse.json(
      settings ?? {
        email_notif: true,
        price_alerts: true,
        sms_updates: false,
        push_notif: true,
        voice_input: true,
        notif_time: "morning",
        ai_style: "friendly",
        two_factor: false,
        language: "english",
        currency: "usd",
        date_format: "mdy",
        time_format: "12",
        theme: "light",
        text_size: "medium",
        high_contrast: false,
        keyboard_nav: true,
      }
    );
  } catch (err) {
    console.error("GET /api/user/settings error:", err);
    return NextResponse.json({ detail: "Failed to load settings." }, { status: 500 });
  }
}

/**
 * PATCH /api/user/settings?user_id=<uuid>
 * Upserts user settings (creates on first save).
 */
export async function PATCH(request: NextRequest) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json({ detail: "user_id is required" }, { status: 400 });
  }
  if (userId !== currentDbUser.id) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = userSettingsSchema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
    return NextResponse.json({ detail: firstError }, { status: 400 });
  }

  try {
    await prisma.userSettings.upsert({
      where: { user_id: userId },
      update: parsed.data,
      create: { user_id: userId, ...parsed.data },
    });

    return NextResponse.json({ ok: true, message: "Settings saved successfully" });
  } catch (err) {
    console.error("PATCH /api/user/settings error:", err);
    return NextResponse.json({ detail: "Failed to save settings." }, { status: 500 });
  }
}
