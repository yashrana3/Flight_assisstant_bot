import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getCurrentDbUser } from "@/lib/current-db-user";

const allowedDocTypes = ["Passport", "Visa", "Insurance", "Booking"] as const;
type AllowedDocType = (typeof allowedDocTypes)[number];

const uploadSchema = z.object({
  docType: z.enum(allowedDocTypes),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(50).optional().nullable(),
  imageBase64: z.string().min(1),
});

function stripDataUrlPrefix(value: string): string {
  const commaIdx = value.indexOf(",");
  if (value.startsWith("data:") && commaIdx !== -1) return value.slice(commaIdx + 1);
  return value;
}

function safeDecodeBase64SizeBytes(base64: string): number {
  const clean = base64.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export async function GET() {
  let currentDbUser = null;
  try {
    currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  } catch {
    currentDbUser = null;
  }

  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.documentVaultImage.findMany({
    where: { userId: currentDbUser.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      docType: true,
      fileName: true,
      mimeType: true,
      imageBase64: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    images: rows.map((r) => ({
      id: r.id,
      docType: r.docType as AllowedDocType,
      fileName: r.fileName,
      mimeType: r.mimeType,
      imageBase64: r.imageBase64,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  let currentDbUser = null;
  try {
    currentDbUser = await getCurrentDbUser({ createIfMissing: true });
  } catch {
    currentDbUser = null;
  }

  if (!currentDbUser) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const payload = parsed.data;
    const imageBase64 = stripDataUrlPrefix(payload.imageBase64);

    const decodedSizeBytes = safeDecodeBase64SizeBytes(imageBase64);
    if (decodedSizeBytes > 100 * 1024) {
      return NextResponse.json(
        { detail: "File too large. Max allowed size is 100KB." },
        { status: 400 },
      );
    }

    if (!payload.mimeType || !payload.mimeType.startsWith("image/jpeg")) {
      return NextResponse.json(
        { detail: "Invalid file type. Only JPEG (.jpg/.jpeg) is allowed." },
        { status: 400 },
      );
    }

    const created = await prisma.documentVaultImage.create({
      data: {
        userId: currentDbUser.id,
        docType: payload.docType,
        fileName: payload.fileName,
        mimeType: payload.mimeType ?? null,
        imageBase64,
      },
      select: {
        id: true,
        docType: true,
        fileName: true,
        mimeType: true,
        imageBase64: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      image: {
        id: created.id,
        docType: created.docType as AllowedDocType,
        fileName: created.fileName,
        mimeType: created.mimeType,
        imageBase64: created.imageBase64,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    console.error("POST /api/document-vault error:", err);
    return NextResponse.json(
      { detail: "Failed to save document image." },
      { status: 500 },
    );
  }
}
