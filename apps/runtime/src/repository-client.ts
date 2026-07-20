import { prisma } from "@mcpops/db";

export type Delegate = {
  findFirst(args: unknown): Promise<unknown>;
  findMany?(args: unknown): Promise<unknown>;
  findUnique?(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update?(args: unknown): Promise<unknown>;
  updateMany?(args: unknown): Promise<{ count: number }>;
  upsert?(args: unknown): Promise<unknown>;
  delete?(args: unknown): Promise<unknown>;
  deleteMany?(args: unknown): Promise<unknown>;
};
export type RuntimePrisma = {
  runtimeEndpoint: Delegate;
  secret: Delegate;
  functionExecution: Delegate;
  auditEvent: Delegate;
  storageNamespace: Delegate;
  storageEntry: Delegate;
  environment: Delegate;
};
export const client = prisma as unknown as RuntimePrisma;
