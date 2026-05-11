/**
 * Signup step 2: verify the phone OTP stored in the DB.
 * In non-production environments the TEST_OTP env variable is accepted as a
 * universal bypass — useful for automated testing and local dev.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { otpSchema } from "@/lib/validations";
import { z } from "zod";

const TEST_OTP = process.env.TEST_OTP;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const requestSchema = z.object({
  email: z.string().email("Invalid email"),
  phone: z.string().min(7, "Invalid phone"),
  otp: otpSchema.shape.otp,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
      return NextResponse.json({ detail: firstError }, { status: 400 });
    }

    const { email, phone, otp } = parsed.data;

    // Non-production: TEST_OTP bypasses DB lookup
    if (!IS_PRODUCTION && TEST_OTP && otp === TEST_OTP) {
      // Clean up any lingering OTP records for this pair
      await prisma.signupOtp.deleteMany({ where: { email, phone } }).catch(() => null);
      return NextResponse.json({ ok: true, message: "OTP verified" });
    }

    const record = await prisma.signupOtp.findFirst({
      where: { email, phone },
      orderBy: { created_at: "desc" },
    });

    if (!record) {
      return NextResponse.json(
        { detail: "OTP not found. Please request a new code." },
        { status: 404 }
      );
    }

    if (record.expires_at < new Date()) {
      await prisma.signupOtp.delete({ where: { id: record.id } });
      return NextResponse.json(
        { detail: "OTP has expired. Please request a new code." },
        { status: 400 }
      );
    }

    if (record.otp_code !== otp) {
      return NextResponse.json(
        { detail: "Invalid OTP. Please try again." },
        { status: 400 }
      );
    }

    // Verified — delete the record so it cannot be reused
    await prisma.signupOtp.delete({ where: { id: record.id } });

    return NextResponse.json({ ok: true, message: "OTP verified" });
  } catch (err) {
    console.error("verify-signup-otp error:", err);
    return NextResponse.json(
      { detail: "Verification failed. Please try again." },
      { status: 500 }
    );
  }
}
