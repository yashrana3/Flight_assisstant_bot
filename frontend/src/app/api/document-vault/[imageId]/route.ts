import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getCurrentDbUser } from "@/lib/current-db-user";

const allowedDocTypes = ["Passport", "Visa", "Insurance", "Booking"] as const;

const updateSchema = z.object({
  docType: z.enum(allowedDocTypes),
  fileName: z.string().min(1).max(255),
});

type RouteContext = {
  params: Promise<{
    imageId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { imageId } = await context.params;

  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const updated = await prisma.documentVaultImage.updateMany({
      where: { id: imageId, userId: currentDbUser.id },
      data: {
        docType: parsed.data.docType,
        fileName: parsed.data.fileName,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ detail: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/document-vault/[imageId] error:", err);
    return NextResponse.json(
      { detail: "Failed to update document." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { imageId } = await context.params;

  try {
    const removed = await prisma.documentVaultImage.deleteMany({
      where: { id: imageId, userId: currentDbUser.id },
    });
    if (removed.count === 0) {
      return NextResponse.json({ detail: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/document-vault/[imageId] error:", err);
    return NextResponse.json(
      { detail: "Failed to delete document." },
      { status: 500 },
    );
  }
}

