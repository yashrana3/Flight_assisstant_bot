/**
 * Signup step 1: generate OTP, store in DB, and (in production) send via SMS.
 * In non-production environments the TEST_OTP env variable is stored directly
 * so developers can use a fixed code (default: 1234) without an SMS provider.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const requestSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters").max(100),
  email: z.string().email("Enter a valid email address"),
  phone: z.string().min(7, "Invalid phone").max(50),
});

const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS ?? 300);
const TEST_OTP = process.env.TEST_OTP;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function generateOtp(): string {
  // Cryptographically-safe random integer in [100000, 999999]
  const array = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(array);
    return String(100000 + (array[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Wire in your SMS provider (Twilio, AWS SNS, etc.) here. */
async function sendOtpViaSms(phone: string, otp: string): Promise<void> {
  if (!IS_PRODUCTION) {
    console.log(`[OTP][DEV] Code for ${phone}: ${otp}`);
    return;
  }
  // TODO: integrate SMS provider in production
  // Example: await twilioClient.messages.create({ to: phone, from: process.env.TWILIO_FROM, body: `Your Book With AI code: ${otp}` });
  console.error("[OTP] No SMS provider configured for production!");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate with Zod (reusing the same schema as the client)
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
      return NextResponse.json({ detail: firstError }, { status: 400 });
    }

    const { full_name, email, phone } = parsed.data;

    // Determine which OTP to store
    const otp = !IS_PRODUCTION && TEST_OTP ? TEST_OTP : generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Remove any previous OTP for this email+phone pair, then insert new one
    await prisma.$transaction([
      prisma.signupOtp.deleteMany({ where: { email, phone } }),
      prisma.signupOtp.create({
        data: { email, phone, otp_code: otp, expires_at: expiresAt },
      }),
    ]);

    // Fire & forget SMS (non-blocking)
    sendOtpViaSms(phone, otp).catch((err) =>
      console.error("[OTP] SMS send error:", err)
    );

    // Log name for debugging (never logged in production)
    if (!IS_PRODUCTION) {
      console.log(`[OTP][DEV] Signup attempt for: ${full_name} <${email}>`);
    }

    return NextResponse.json({ ok: true, message: "OTP sent to phone" });
  } catch (err) {
    console.error("send-signup-otp error:", err);
    return NextResponse.json(
      { detail: "Failed to send OTP. Please try again." },
      { status: 500 }
    );
  }
}
