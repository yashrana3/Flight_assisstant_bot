import { randomUUID } from "crypto";

import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const DB_USER_CACHE_TTL_MS = Number(process.env.DB_USER_CACHE_TTL_MS ?? 15000);
const DB_USER_SELECT = {
  id: true,
  clerkId: true,
  email: true,
  firstName: true,
  lastName: true,
  fullName: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type DbUserLite = Prisma.UserGetPayload<{ select: typeof DB_USER_SELECT }>;

const dbUserCache = new Map<string, { expiresAt: number; user: DbUserLite }>();
const dbUserInFlight = new Map<string, Promise<DbUserLite | null>>();

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? null;
}

function normalizeText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitName(clerkUser: NonNullable<Awaited<ReturnType<typeof currentUser>>>) {
  const firstFromClerk = normalizeText(clerkUser.firstName);
  const fullName = normalizeText(clerkUser.fullName);
  const firstFromFull = normalizeText(fullName?.split(/\s+/)[0] ?? null);

  return {
    firstName: firstFromClerk ?? firstFromFull,
  };
}

export async function getCurrentDbUser(options?: {
  createIfMissing?: boolean;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const inFlightKey = `${clerkId}:${options?.createIfMissing ? "create" : "readonly"}`;

  const now = Date.now();
  const cached = dbUserCache.get(clerkId);
  if (cached && cached.expiresAt > now) {
    return cached.user;
  }

  const existingInFlight = dbUserInFlight.get(inFlightKey);
  if (existingInFlight) {
    const inFlightUser = await existingInFlight;
    if (inFlightUser) {
      dbUserCache.set(clerkId, {
        expiresAt: Date.now() + DB_USER_CACHE_TTL_MS,
        user: inFlightUser,
      });
    }
    return inFlightUser;
  }

  const resolveUserPromise = (async () => {
    const existingByClerkId = await prisma.user.findUnique({
      where: { clerkId },
      select: DB_USER_SELECT,
    });
    if (existingByClerkId) {
      dbUserCache.set(clerkId, {
        expiresAt: now + DB_USER_CACHE_TTL_MS,
        user: existingByClerkId,
      });
      return existingByClerkId;
    }

    let clerkUser: Awaited<ReturnType<typeof currentUser>> | null = null;
    try {
      clerkUser = await currentUser();
    } catch {
      clerkUser = null;
    }

    let email: string | null = null;
    let firstName: string | null = null;
    let lastName: string | null = null;

    if (clerkUser) {
      email = normalizeEmail(clerkUser.emailAddresses[0]?.emailAddress);
      const split = splitName(clerkUser);
      firstName = split.firstName;
      lastName = normalizeText(clerkUser.lastName);
    } else {
      try {
        const client = await clerkClient();
        const u = await client.users.getUser(clerkId);
        const addr =
          u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ??
          u.emailAddresses[0];
        email = normalizeEmail(addr?.emailAddress);
        firstName = normalizeText(u.firstName ?? undefined);
        lastName = normalizeText(u.lastName ?? undefined);
      } catch {
        return prisma.user.findUnique({
          where: { clerkId },
          select: DB_USER_SELECT,
        });
      }
    }

    if (!email) {
      return prisma.user.findUnique({
        where: { clerkId },
        select: DB_USER_SELECT,
      });
    }

    let user = existingByClerkId;

    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive",
          },
        },
        select: DB_USER_SELECT,
      });
    }

    if (!user) {
      if (!options?.createIfMissing) return null;

      const nowDate = new Date();
      user = await prisma.user.create({
        data: {
          id: randomUUID(),
          clerkId,
          email,
          firstName,
          lastName,
          fullName: [firstName, lastName].filter(Boolean).join(" ") || null,
          role: "USER",
          status: "ACTIVE",
          createdAt: nowDate,
          updatedAt: nowDate,
        },
        select: DB_USER_SELECT,
      });
      return user;
    }

    const updates: Prisma.UserUpdateInput = {};

    if (user.clerkId !== clerkId) {
      updates.clerkId = clerkId;
    }

    if (user.email !== email) {
      updates.email = email;
    }

    if (!normalizeText(user.firstName) && firstName) {
      updates.firstName = firstName;
    }

    if (!normalizeText(user.lastName) && lastName) {
      updates.lastName = lastName;
    }

    const resolvedFullName = normalizeText([firstName, lastName].filter(Boolean).join(" "));
    if (!normalizeText(user.fullName) && resolvedFullName) {
      updates.fullName = resolvedFullName;
    }

    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: updates,
        select: DB_USER_SELECT,
      });
    }

    return user;
  })();

  dbUserInFlight.set(inFlightKey, resolveUserPromise);
  try {
    const resolvedUser = await resolveUserPromise;
    if (resolvedUser) {
      dbUserCache.set(clerkId, {
        expiresAt: Date.now() + DB_USER_CACHE_TTL_MS,
        user: resolvedUser,
      });
    }
    return resolvedUser;
  } finally {
    dbUserInFlight.delete(inFlightKey);
  }
}
