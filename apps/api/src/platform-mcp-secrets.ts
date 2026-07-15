import { z } from "zod";
import { prisma } from "@mcpops/db";
import { encryptSecret } from "@mcpops/shared";

type Actor = { userId: string; role: string; scopes: string[] };

const secretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,99}$/);
const secretCreateSchema = z.object({ name: secretNameSchema }).strict();
const secretValueSchema = z
  .object({
    secret: secretNameSchema,
    environment: z.string().min(1),
    value: z.string().min(1).max(16_384),
  })
  .strict();
const secretDeleteSchema = z.object({ secret: secretNameSchema }).strict();
const functionSchema = z.object({ function: z.string().min(1) }).strict();
const functionGrantsSchema = z
  .object({ function: z.string().min(1), secrets: z.array(secretNameSchema).max(100) })
  .strict();

export const secretToolNames = new Set([
  "secrets_list",
  "secret_create",
  "secret_set_value",
  "secret_delete",
  "function_secret_grants_get",
  "function_secret_grants_set",
]);

export async function callSecretTool(
  name: string,
  projectId: string,
  actor: Actor,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (name === "secrets_list") return listSecrets(projectId);
  if (name === "function_secret_grants_get")
    return getFunctionGrants(projectId, functionSchema.parse(args).function);
  requireWrite(actor);
  if (name === "secret_create")
    return createSecret(projectId, actor, secretCreateSchema.parse(args).name);
  if (name === "secret_set_value")
    return setSecretValue(projectId, actor, secretValueSchema.parse(args));
  if (name === "secret_delete")
    return deleteSecret(projectId, actor, secretDeleteSchema.parse(args).secret);
  if (name === "function_secret_grants_set") {
    requireRole(actor, ["owner", "admin", "developer"]);
    return setFunctionGrants(projectId, actor, functionGrantsSchema.parse(args));
  }
  throw error("UNKNOWN_TOOL", `Unknown Secret tool: ${name}`);
}

async function listSecrets(projectId: string) {
  const [rows, grants] = await Promise.all([
    prisma.secret.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        encryptedValue: true,
        createdAt: true,
        updatedAt: true,
        environment: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ name: "asc" }, { environmentId: "asc" }],
    }),
    prisma.secretGrant.groupBy({
      by: ["secretName"],
      where: { function: { projectId } },
      _count: { _all: true },
    }),
  ]);
  const grantCounts = new Map(grants.map((row) => [row.secretName, row._count._all]));
  const logical = new Map<
    string,
    { name: string; grantCount: number; environments: Record<string, unknown>[] }
  >();
  for (const row of rows) {
    const item = logical.get(row.name) ?? {
      name: row.name,
      grantCount: grantCounts.get(row.name) ?? 0,
      environments: [],
    };
    item.environments.push({
      id: row.id,
      environment: row.environment,
      hasValue: Boolean(row.encryptedValue),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    logical.set(row.name, item);
  }
  return output("Project Secrets", {
    secrets: [...logical.values()],
    containsSecretValues: false,
  });
}

async function createSecret(projectId: string, actor: Actor, name: string) {
  requireRole(actor, ["owner", "admin"]);
  const environments = await requiredEnvironments(projectId);
  if (await prisma.secret.count({ where: { projectId, name } }))
    throw error("SECRET_NAME_CONFLICT", "This logical Secret already exists", 409);
  const rows = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const environment of environments) {
      const row = await tx.secret.create({
        data: { projectId, environmentId: environment.id, name },
        select: { id: true, environmentId: true },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          environmentId: environment.id,
          actorType: "user",
          actorId: actor.userId,
          action: "secret.created",
          targetType: "secret",
          targetId: row.id,
          metadata: { name, source: "platform_mcp", hasValue: false },
        },
      });
      created.push({ ...row, environment: environment.slug, hasValue: false });
    }
    return created;
  });
  return output(`Created logical Secret ${name}`, {
    name,
    environments: rows,
    containsSecretValues: false,
  });
}

async function setSecretValue(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof secretValueSchema>,
) {
  requireRole(actor, ["owner", "admin"]);
  const environment = await findEnvironment(projectId, input.environment);
  const existing = await prisma.secret.findUnique({
    where: {
      projectId_environmentId_name: {
        projectId,
        environmentId: environment.id,
        name: input.secret,
      },
    },
    select: { id: true, encryptedValue: true },
  });
  if (!existing)
    throw error("NOT_FOUND", "Create the logical Secret before setting a value", 404);
  const rotated = Boolean(existing.encryptedValue);
  await prisma.$transaction([
    prisma.secret.update({
      where: { id: existing.id },
      data: { encryptedValue: encryptSecret(input.value) },
    }),
    prisma.auditEvent.create({
      data: {
        projectId,
        environmentId: environment.id,
        actorType: "user",
        actorId: actor.userId,
        action: rotated ? "secret.rotated" : "secret.value_set",
        targetType: "secret",
        targetId: existing.id,
        metadata: { name: input.secret, source: "platform_mcp" },
      },
    }),
  ]);
  return output(`${rotated ? "Rotated" : "Set"} ${input.secret}`, {
    name: input.secret,
    environment: { id: environment.id, name: environment.name, slug: environment.slug },
    hasValue: true,
    containsSecretValues: false,
  });
}

async function deleteSecret(projectId: string, actor: Actor, name: string) {
  requireRole(actor, ["owner", "admin"]);
  const rows = await prisma.secret.findMany({
    where: { projectId, name },
    include: { _count: { select: { databaseConnections: true } } },
  });
  if (!rows.length) throw error("NOT_FOUND", "Secret not found", 404);
  const grants = await prisma.secretGrant.count({
    where: { secretName: name, function: { projectId } },
  });
  if (grants || rows.some((row) => row._count.databaseConnections))
    throw error(
      "SECRET_IN_USE",
      "Remove all Function grants and database connections before deleting this Secret",
      409,
    );
  await prisma.$transaction(async (tx) => {
    await tx.secret.deleteMany({ where: { projectId, name } });
    for (const row of rows)
      await tx.auditEvent.create({
        data: {
          projectId,
          environmentId: row.environmentId,
          actorType: "user",
          actorId: actor.userId,
          action: "secret.deleted",
          targetType: "secret",
          targetId: row.id,
          metadata: { name, source: "platform_mcp" },
        },
      });
  });
  return output(`Deleted logical Secret ${name}`, { name, deleted: true });
}

async function getFunctionGrants(projectId: string, identifier: string) {
  const fn = await findFunction(projectId, identifier);
  const grants = await prisma.secretGrant.findMany({
    where: { functionId: fn.id },
    select: { secretName: true, accessMode: true },
    orderBy: { secretName: "asc" },
  });
  return output(`${fn.name} Secret grants`, {
    function: { id: fn.id, name: fn.name, slug: fn.slug },
    grants: grants.map((grant) => ({
      name: grant.secretName,
      accessMode: grant.accessMode,
    })),
  });
}

async function setFunctionGrants(
  projectId: string,
  actor: Actor,
  input: z.infer<typeof functionGrantsSchema>,
) {
  const fn = await findFunction(projectId, input.function);
  const names = [...new Set(input.secrets)];
  const secrets = await prisma.secret.findMany({
    where: { projectId, name: { in: names } },
    select: { id: true, name: true },
    orderBy: { environmentId: "asc" },
  });
  const byName = new Map(secrets.map((secret) => [secret.name, secret]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length)
    throw error(
      "INVALID_SECRET_GRANT",
      `Unknown logical Secrets: ${missing.join(", ")}`,
    );
  await prisma.$transaction(async (tx) => {
    await tx.secretGrant.deleteMany({ where: { functionId: fn.id } });
    if (names.length)
      await tx.secretGrant.createMany({
        data: names.map((name) => ({
          functionId: fn.id,
          secretName: name,
          accessMode: "read",
        })),
      });
    await tx.auditEvent.create({
      data: {
        projectId,
        functionId: fn.id,
        actorType: "user",
        actorId: actor.userId,
        action: "function.secret_grants_updated",
        targetType: "function",
        targetId: fn.id,
        metadata: { names, source: "platform_mcp" },
      },
    });
  });
  return output(`Updated ${fn.name} Secret grants`, {
    function: { id: fn.id, name: fn.name, slug: fn.slug },
    grants: names.map((name) => ({ name, accessMode: "read" })),
  });
}

async function requiredEnvironments(projectId: string) {
  const rows = await prisma.environment.findMany({
    where: { projectId, slug: { in: ["development", "production"] } },
    select: { id: true, name: true, slug: true },
  });
  if (
    !rows.some((row) => row.slug === "development") ||
    !rows.some((row) => row.slug === "production")
  )
    throw error(
      "SECRET_ENVIRONMENTS_MISSING",
      "Development and Production environments are required",
      409,
    );
  return rows.sort((left, right) => left.slug.localeCompare(right.slug));
}

async function findEnvironment(projectId: string, identifier: string) {
  const row = await prisma.environment.findFirst({
    where: {
      projectId,
      OR: identifierWhere(identifier, "slug", "name"),
    },
    select: { id: true, name: true, slug: true },
  });
  if (!row) throw error("NOT_FOUND", "Environment not found", 404);
  return row;
}

async function findFunction(projectId: string, identifier: string) {
  const row = await prisma.function.findFirst({
    where: {
      projectId,
      OR: identifierWhere(identifier, "slug", "name"),
    },
    select: { id: true, name: true, slug: true },
  });
  if (!row) throw error("NOT_FOUND", "Function not found", 404);
  return row;
}

function identifierWhere(identifier: string, ...textFields: string[]) {
  return [
    ...(z.string().uuid().safeParse(identifier).success ? [{ id: identifier }] : []),
    ...textFields.map((field) => ({ [field]: identifier })),
  ];
}

function requireWrite(actor: Actor) {
  if (!actor.scopes.includes("mcpops:write"))
    throw error("INSUFFICIENT_SCOPE", "OAuth scope mcpops:write is required", 403);
}
function requireRole(actor: Actor, roles: string[]) {
  if (!roles.includes(actor.role))
    throw error("FORBIDDEN", `Role ${actor.role} cannot perform this operation`, 403);
}
function error(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function output(summary: string, data: unknown) {
  return { ok: true, summary, data, warnings: [], diagnostics: [], nextActions: [] };
}
