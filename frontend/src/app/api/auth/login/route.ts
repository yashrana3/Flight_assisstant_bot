import { NextRequest, NextResponse } from "next/server";
import { signInSchema } from "@/lib/validations";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
      return NextResponse.json({ detail: firstError }, { status: 400 });
    }

    const { email, password } = parsed.data;
    void email;
    void password;
    return NextResponse.json(
      { detail: "Use Clerk sign-in. Legacy email/password login is disabled." },
      { status: 400 }
    );
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json(
      { detail: "Login failed. Please try again." },
      { status: 500 }
    );
  }
}
