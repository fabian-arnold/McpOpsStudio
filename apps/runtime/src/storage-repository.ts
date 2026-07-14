import type { LoadedEndpoint } from "./domain.js";
import { client } from "./repository-client.js";

export async function storageGet(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  key: string,
): Promise<unknown> {
  const namespace = await ensureStorageNamespace(endpoint);
  const row = (await client.storageEntry.findFirst({
    where: {
      namespaceId: namespace.id,
      functionId,
      tenantScope,
      key,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })) as { value: unknown } | null;
  return row?.value ?? null;
}
export async function storageList(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  pattern: string,
  limit: number,
): Promise<Array<{ key: string; value: unknown }>> {
  const namespace = await ensureStorageNamespace(endpoint);
  if (!client.storageEntry.findMany) throw new Error("Storage adapter is unavailable");
  return (await client.storageEntry.findMany({
    where: {
      namespaceId: namespace.id,
      functionId,
      tenantScope,
      ...storagePatternFilter(pattern),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { key: true, value: true },
    orderBy: { key: "asc" },
    take: limit,
  })) as Array<{ key: string; value: unknown }>;
}
export async function storageSet(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const namespace = await ensureStorageNamespace(endpoint);
  if (!client.storageEntry.upsert) throw new Error("Storage adapter is unavailable");
  await client.storageEntry.upsert({
    where: {
      namespaceId_functionId_tenantScope_key: {
        namespaceId: namespace.id,
        functionId,
        tenantScope,
        key,
      },
    },
    create: {
      namespaceId: namespace.id,
      functionId,
      tenantScope,
      key,
      value,
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null,
    },
    update: {
      value,
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null,
    },
  });
}
export async function storageDelete(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  key: string,
): Promise<void> {
  const namespace = await ensureStorageNamespace(endpoint);
  const found = (await client.storageEntry.findFirst({
    where: { namespaceId: namespace.id, functionId, tenantScope, key },
    select: { id: true },
  })) as { id: string } | null;
  if (found && client.storageEntry.delete)
    await client.storageEntry.delete({ where: { id: found.id } });
}
export async function storageDeleteMany(
  endpoint: LoadedEndpoint,
  functionId: string,
  tenantScope: string,
  pattern: string,
  limit: number,
): Promise<number> {
  const namespace = await ensureStorageNamespace(endpoint);
  if (!client.storageEntry.findMany || !client.storageEntry.deleteMany)
    throw new Error("Storage adapter is unavailable");
  const rows = (await client.storageEntry.findMany({
    where: {
      namespaceId: namespace.id,
      functionId,
      tenantScope,
      ...storagePatternFilter(pattern),
    },
    select: { id: true },
    orderBy: { key: "asc" },
    take: limit,
  })) as Array<{ id: string }>;
  if (rows.length === 0) return 0;
  const result = (await client.storageEntry.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  })) as { count: number };
  return result.count;
}

export function storagePatternFilter(pattern: string): {
  key?: string | { startsWith?: string; endsWith?: string };
} {
  const wildcard = pattern.indexOf("*");
  if (wildcard < 0) return { key: pattern };
  const startsWith = pattern.slice(0, wildcard);
  const endsWith = pattern.slice(wildcard + 1);
  return startsWith || endsWith
    ? {
        key: {
          ...(startsWith ? { startsWith } : {}),
          ...(endsWith ? { endsWith } : {}),
        },
      }
    : {};
}
async function ensureStorageNamespace(
  endpoint: LoadedEndpoint,
): Promise<{ id: string }> {
  const existing = (await client.storageNamespace.findFirst({
    where: {
      projectId: endpoint.project.id,
      environmentId: endpoint.environment.id,
      name: "default",
    },
    select: { id: true },
  })) as { id: string } | null;
  if (existing) return existing;
  return client.storageNamespace.create({
    data: {
      projectId: endpoint.project.id,
      environmentId: endpoint.environment.id,
      name: "default",
    },
    select: { id: true },
  }) as Promise<{ id: string }>;
}
export function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
