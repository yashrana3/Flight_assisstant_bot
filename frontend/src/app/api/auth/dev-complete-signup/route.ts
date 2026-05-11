import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const TEST_OTP = process.env.TEST_OTP;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * POST /api/auth/dev-complete-signup
 *
 * DEV ONLY — bypasses Clerk email verification using TEST_OTP.
 *
 * Clerk only creates the User object once a sign-up is COMPLETE. While the
 * sign-up is in "missing_requirements" state (email unverified), getUserList
 * returns nothing. So we fall back to creating the user directly via the
 * admin API, which immediately creates a verified User record and abandons
 * the pending sign-up attempt (it will expire on its own).
 *
 * 1. Validates code === TEST_OTP.
 * 2. Looks up Clerk user by email. If not found (pending sign-up), creates them.
 * 3. Returns a short-lived sign-in ticket so the frontend can activate
 *    a session without a password re-entry.
 *
 * Returns 403 in production.
 */
export async function POST(request: NextRequest) {
  if (IS_PRODUCTION) {
    return NextResponse.json({ detail: "Not available in production." }, { status: 403 });
  }

  if (!TEST_OTP) {
    return NextResponse.json({ detail: "TEST_OTP is not configured." }, { status: 500 });
  }

  const body = await request.json();
  const { code, email } = body as { code?: string; email?: string };

  if (!code || !email) {
    return NextResponse.json({ detail: "code and email are required." }, { status: 400 });
  }

  if (code !== TEST_OTP) {
    return NextResponse.json({ detail: "Invalid test code." }, { status: 400 });
  }

  try {
    const client = await clerkClient();

    // Step 1: try to find an existing Clerk user by email
    const lookupUser = async () => {
      const { data } = await client.users.getUserList({ emailAddress: [email], limit: 1 });
      return data[0] ?? null;
    };

    let user = await lookupUser();

    if (!user) {
      // User doesn't exist yet — the sign-up is still in "missing_requirements".
      // Create the user directly via admin API; the pending sign-up will expire.
      try {
        user = await client.users.createUser({
          emailAddress: [email],
          skipPasswordRequirement: true,
        });
      } catch (createErr: unknown) {
        // If createUser fails (e.g. Clerk says email is taken by the pending
        // sign-up), retry the lookup — the user may now be queryable.
        console.warn("dev-complete-signup: createUser failed, retrying lookup:", createErr);
        user = await lookupUser();
      }
    }

    if (!user) {
      return NextResponse.json(
        {
          detail:
            "Could not locate or create your Clerk account. " +
            "Wait a moment and try again, or check the Clerk Dashboard.",
        },
        { status: 404 }
      );
    }

    // If the user already existed, ensure their email is marked verified
    const emailObj =
      user.emailAddresses.find((e) => e.emailAddress === email) ??
      user.emailAddresses[0];

    if (emailObj && emailObj.verification?.status !== "verified") {
      await client.emailAddresses.updateEmailAddress(emailObj.id, {
        verified: true,
        primary: true,
      });
    }

    // Sync the Clerk user ID into our DB (handles the case where a previous
    // failed sign-up left a stale clerkId like "local_<uuid>")
    await prisma.user.updateMany({
      where: { email },
      data: { clerkId: user.id, status: "ACTIVE" },
    });

    // Issue a short-lived sign-in ticket (5 min) so the frontend can
    // activate the session without asking for the password again
    const signInToken = await client.signInTokens.createSignInToken({
      userId: user.id,
      expiresInSeconds: 300,
    });

    return NextResponse.json({ ticket: signInToken.token });
  } catch (err) {
    console.error("dev-complete-signup error:", err);
    return NextResponse.json(
      { detail: "Failed to complete sign-up bypass." },
      { status: 500 }
    );
  }
}
