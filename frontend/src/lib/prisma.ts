import { PrismaClient } from "@prisma/client";

// Singleton pattern — prevents multiple PrismaClient instances in Next.js
// hot-reload (development) while using a single instance in production.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Avoid query-level logging in dev to reduce overhead/noise during high-traffic local sessions.
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
