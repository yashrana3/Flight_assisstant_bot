import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentDbUser } from "@/lib/current-db-user";

/**
 * GET /api/user/profile?user_id=<uuid>
 *
 * Protected by Clerk auth. Returns the full profile from our Postgres DB
 * via Prisma. No localhost fallback — if the DB is unreachable the request
 * fails with a clear error.
 */
export async function GET(request: NextRequest) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id") ?? currentDbUser.id;
  if (userId !== currentDbUser.id) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        travel_preferences: {
          orderBy: { updated_at: "desc" },
          take: 1,
        },
      },
    });

    if (!user) {
      return NextResponse.json({ detail: "User not found" }, { status: 404 });
    }

    const pref = user.travel_preferences[0] ?? null;

    return NextResponse.json({
      id: user.id,
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      phone: user.phone,
      date_of_birth: user.dateOfBirth
        ? user.dateOfBirth.toISOString().slice(0, 10)
        : null,
      gender: user.gender,
      nationality: user.nationality,
      address: user.address,
      avatar_url: user.imageUrl ?? null,
      preferences: pref
        ? {
            seat_preference: pref.seat_preference,
            meal_preference: pref.meal_preference,
            cabin_class: pref.cabin_class,
            preferred_airlines: pref.preferred_airlines ?? [],
            travel_style: pref.travel_style,
            flight_timing: pref.flight_timing ?? [],
            layover_preference: pref.layover_preference,
            max_layover_time: pref.max_layover_time,
            airport_preference: pref.airport_preference ?? [],
            special_assistance: pref.special_assistance,
          }
        : null,
    });
  } catch (err) {
    console.error("GET /api/user/profile error:", err);
    return NextResponse.json(
      { detail: "Failed to load profile. Please try again." },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/user/profile?user_id=<uuid>
 *
 * Updates personal info and/or travel preferences in one request.
 */
export async function PATCH(request: NextRequest) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id") ?? currentDbUser.id;
  if (userId !== currentDbUser.id) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  const {
    first_name,
    last_name,
    phone,
    date_of_birth,
    gender,
    nationality,
    address,
    avatar_url,
    // Travel preferences
    seat_preference,
    meal_preference,
    cabin_class,
    preferred_airlines,
    travel_style,
    flight_timing,
    layover_preference,
    max_layover_time,
    airport_preference,
    special_assistance,
  } = body;

  if (
    avatar_url !== undefined &&
    avatar_url !== null &&
    typeof avatar_url !== "string"
  ) {
    return NextResponse.json(
      { detail: "avatar_url must be a string or null." },
      { status: 400 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { id: userId },
        select: {
          firstName: true,
          lastName: true,
        },
      });

      // Update core user fields if provided
      const userUpdate: Record<string, unknown> = {};
      if (first_name !== undefined) userUpdate.firstName = first_name;
      if (last_name !== undefined) userUpdate.lastName = last_name;
      if (first_name !== undefined || last_name !== undefined) {
        const resolvedFirstName =
          first_name !== undefined ? first_name : existingUser?.firstName ?? null;
        const resolvedLastName =
          last_name !== undefined ? last_name : existingUser?.lastName ?? null;
        userUpdate.fullName =
          [resolvedFirstName, resolvedLastName].filter(Boolean).join(" ").trim() || null;
      }
      if (phone !== undefined) userUpdate.phone = phone;
      if (gender !== undefined) userUpdate.gender = gender;
      if (nationality !== undefined) userUpdate.nationality = nationality;
      if (address !== undefined) userUpdate.address = address;
      if (avatar_url !== undefined) {
        userUpdate.imageUrl =
          typeof avatar_url === "string" ? avatar_url.trim() || null : null;
      }
      if (date_of_birth !== undefined) {
        userUpdate.dateOfBirth = date_of_birth
          ? new Date(`${String(date_of_birth)}T00:00:00.000Z`)
          : null;
      }

      if (Object.keys(userUpdate).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userUpdate });
      }

      // Upsert travel preferences (DB has no unique on user_id — find latest row)
      const prefFields = {
        seat_preference,
        meal_preference,
        cabin_class,
        preferred_airlines,
        travel_style,
        flight_timing,
        layover_preference,
        max_layover_time,
        airport_preference,
        special_assistance,
      };
      const prefUpdate = Object.fromEntries(
        Object.entries(prefFields).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(prefUpdate).length > 0) {
        const existingPref = await tx.travelPreference.findFirst({
          where: { user_id: userId },
          orderBy: { updated_at: "desc" },
        });
        if (existingPref) {
          await tx.travelPreference.update({
            where: { id: existingPref.id },
            data: prefUpdate,
          });
        } else {
          await tx.travelPreference.create({
            data: {
              id: randomUUID(),
              user_id: userId,
              ...prefUpdate,
            },
          });
        }
      }
    });

    return NextResponse.json({ ok: true, message: "Profile updated successfully" });
  } catch (err) {
    console.error("PATCH /api/user/profile error:", err);
    return NextResponse.json(
      { detail: "Failed to update profile. Please try again." },
      { status: 500 },
    );
  }
}
