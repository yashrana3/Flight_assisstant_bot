import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentDbUser } from "@/lib/current-db-user";

/**
 * GET /api/user/profile-by-email?email=<email>
 *
 * Looks up our Postgres user by email — used after Clerk authentication
 * to find the internal user_id for subsequent API calls.
 */
export async function GET(request: NextRequest) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requestedEmail = searchParams.get("email");
  if (
    requestedEmail &&
    requestedEmail.toLowerCase() !== currentDbUser.email.toLowerCase()
  ) {
    return NextResponse.json({ detail: "Forbidden" }, { status: 403 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: currentDbUser.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        imageUrl: true,
        phone: true,
        dateOfBirth: true,
        gender: true,
        nationality: true,
        address: true,
      },
    });

    if (!user) {
      return NextResponse.json({ detail: "User not found" }, { status: 404 });
    }

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
    });
  } catch (err) {
    console.error("GET /api/user/profile-by-email error:", err);
    return NextResponse.json(
      { detail: "Failed to load profile. Please try again." },
      { status: 500 }
    );
  }
}
