import type { Prisma, PrismaClient } from "@prisma/client";

const GLOBAL_TENANT_SCOPE = "__global__";

export type StorageScope = {
  namespaceId: string;
  functionId: string;
  tenantId?: string;
};

export function scopedStorageRepository(client: PrismaClient, scope: StorageScope) {
  const tenantScope = scope.tenantId ?? GLOBAL_TENANT_SCOPE;
  const identity = (key: string) => ({
    namespaceId_functionId_tenantScope_key: {
      namespaceId: scope.namespaceId,
      functionId: scope.functionId,
      tenantScope,
      key,
    },
  });

  return {
    async get(key: string): Promise<Prisma.JsonValue | null> {
      const entry = await client.storageEntry.findUnique({ where: identity(key) });
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt <= new Date()) {
        await client.storageEntry.delete({ where: { id: entry.id } });
        return null;
      }
      return entry.value;
    },
    set(key: string, value: Prisma.InputJsonValue, ttlSeconds?: number) {
      const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
      return client.storageEntry.upsert({
        where: identity(key),
        create: { ...scope, tenantScope, key, value, expiresAt },
        update: { value, expiresAt },
      });
    },
    delete(key: string) {
      return client.storageEntry.deleteMany({
        where: {
          namespaceId: scope.namespaceId,
          functionId: scope.functionId,
          tenantScope,
          key,
        },
      });
    },
  };
}
