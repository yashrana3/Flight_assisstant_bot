import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signUpStep1Schema } from "@/lib/validations";
import { z } from "zod";

const registerSchema = signUpStep1Schema.extend({
  // Password is ignored because authentication is handled by Clerk.
  password: z.string().min(1, "Password is required").optional(),
  clerk_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.errors[0]?.message ?? "Invalid input";
      return NextResponse.json({ detail: firstError }, { status: 400 });
    }

    const { full_name, email, password, clerk_id } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = full_name.trim();
    const firstName = trimmedName.split(/\s+/)[0] ?? "";

    const existing = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
      },
      select: { id: true, clerkId: true },
    });

    if (existing) {
      // Idempotent behavior: sign-up may be completed in Clerk first, then this
      // endpoint is called to sync into our DB. If the user already exists, we
      // treat it as success and (optionally) update the Clerk ID if provided.
      if (clerk_id && existing.clerkId !== clerk_id) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { clerkId: clerk_id },
          select: { id: true },
        });
      }

      return NextResponse.json(
        { message: "Account already exists", user_id: existing.id },
        { status: 200 }
      );
    }

    // Generate a unique ID (Prisma won't auto-generate since @id is String without @default)
    const { randomUUID } = await import("crypto");

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: normalizedEmail,
        firstName,
        lastName: null,
        clerkId: clerk_id ?? `local_${randomUUID()}`,
        fullName: trimmedName,
        role: "USER",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    return NextResponse.json(
      { message: "Account created successfully", user_id: user.id },
      { status: 201 }
    );
  } catch (err) {
    console.error("Register error:", err);
    return NextResponse.json(
      { detail: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}
