import { PrismaClient } from "@prisma/client";

const globalDatabase = globalThis as unknown as { mcpOpsPrisma?: PrismaClient };

/** A single process-local client avoids exhausting connections during dev hot reloads. */
export const prisma =
  globalDatabase.mcpOpsPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.mcpOpsPrisma = prisma;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
