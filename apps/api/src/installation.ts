import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import { deploymentJobOptions } from "./deployment-queue.js";
import argon2 from "argon2";
import { Prisma, prisma } from "@mcpops/db";
import { encryptSecret, installationSetupSchema } from "@mcpops/shared";
import { issueSession } from "./auth.js";
import { requestId } from "./helpers.js";

const installationId = "installation";

export function registerInstallationRoutes(
  app: FastifyInstance,
  deploymentQueue: Queue,
): void {
  app.get("/api/setup/status", async () => ({
    required: !(await installationCompleted()),
  }));

  app.post(
    "/api/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      if (await installationCompleted())
        return reply.status(409).send({
          error: {
            code: "SETUP_ALREADY_COMPLETED",
            message: "Installation setup has already been completed",
            requestId: requestId(request),
          },
        });

      const input = installationSetupSchema.parse(request.body);
      const expectedCode = process.env.MCP_OPS_SETUP_CODE;
      if (!expectedCode || !sameSecret(input.setupCode, expectedCode))
        return reply.status(403).send({
          error: {
            code: "SETUP_CODE_INVALID",
            message: "The one-time setup code is invalid",
            requestId: requestId(request),
          },
        });

      const publicUrl = new URL(input.publicUrl).origin;
      const passwordHash = await argon2.hash(input.ownerPassword, {
        type: argon2.argon2id,
      });
      const created = await prisma.$transaction(
        async (tx) => {
          await tx.installation.create({
            data: { id: installationId, publicUrl },
          });
          const user = await tx.user.create({
            data: {
              email: input.ownerEmail.toLowerCase(),
              passwordHash,
              role: "owner",
              active: true,
              mustChangePassword: false,
            },
          });
          const project = await tx.project.create({
            data: {
              name: input.projectName,
              slug: input.projectSlug,
              description:
                input.starter === "notes-demo"
                  ? "Persistence-backed Note App starter"
                  : "",
            },
          });
          const development = await tx.environment.create({
            data: {
              projectId: project.id,
              name: "Development",
              slug: "development",
              capturePayloads: true,
              logLevel: "debug",
              logRetentionDays: 7,
              logRetentionMaxEntries: 50000,
              logRetentionMaxBytes: 52428800,
              baseUrl: publicUrl,
            },
          });
          const production = await tx.environment.create({
            data: {
              projectId: project.id,
              name: "Production",
              slug: "production",
              logLevel: "info",
              logRetentionDays: 30,
              logRetentionMaxEntries: 200000,
              logRetentionMaxBytes: 262144000,
              baseUrl: publicUrl,
            },
          });

          let deployment:
            { id: string; status: string; childIds: string[] } | undefined;
          if (input.starter === "notes-demo")
            deployment = await createNotesDemo(tx, {
              projectId: project.id,
              userId: user.id,
              developmentId: development.id,
              productionId: production.id,
            });

          await tx.auditEvent.create({
            data: {
              projectId: project.id,
              environmentId: development.id,
              actorType: "user",
              actorId: user.id,
              action: "installation.initialized",
              targetType: "installation",
              targetId: installationId,
              metadata: { starter: input.starter, publicUrl },
            },
          });
          return { user, project, deployment };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (created.deployment)
        for (const deploymentId of created.deployment.childIds)
          await deploymentQueue.add(
            "build",
            {
              deploymentId,
              projectId: created.project.id,
              actorId: created.user.id,
            },
            deploymentJobOptions(deploymentId),
          );

      const csrfToken = issueSession(reply, {
        userId: created.user.id,
        projectId: created.project.id,
        role: created.user.role,
        email: created.user.email,
        sessionVersion: created.user.sessionVersion,
      });
      return reply.status(201).send({
        user: {
          id: created.user.id,
          email: created.user.email,
          role: created.user.role,
          mustChangePassword: false,
          project: created.project,
        },
        csrfToken,
        starter: input.starter,
        deployment: created.deployment
          ? {
              id: created.deployment.id,
              status: created.deployment.status,
            }
          : null,
      });
    },
  );
}

async function installationCompleted(): Promise<boolean> {
  const [installation, userCount] = await Promise.all([
    prisma.installation.findUnique({
      where: { id: installationId },
      select: { id: true },
    }),
    prisma.user.count(),
  ]);
  return Boolean(installation) || userCount > 0;
}

function sameSecret(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

async function createNotesDemo(
  tx: Prisma.TransactionClient,
  ids: {
    projectId: string;
    userId: string;
    developmentId: string;
    productionId: string;
  },
): Promise<{ id: string; status: string; childIds: string[] }> {
  const policy = await tx.authPolicy.create({
    data: {
      projectId: ids.projectId,
      name: "Note App demo access",
      type: "basic_auth",
      config: {
        header: "authorization",
        scheme: "Basic",
        username: "DEMO",
        secretRef: "DEMO_BASIC_PASSWORD",
        permissions: ["notes.read", "notes.write"],
      },
    },
  });
  for (const environmentId of [ids.developmentId, ids.productionId])
    await tx.secret.create({
      data: {
        projectId: ids.projectId,
        environmentId,
        name: "DEMO_BASIC_PASSWORD",
        encryptedValue: encryptSecret("DEMO"),
      },
    });
  await tx.storageNamespace.createMany({
    data: [ids.developmentId, ids.productionId].map((environmentId) => ({
      projectId: ids.projectId,
      environmentId,
      name: "default",
    })),
  });

  const functions = new Map<string, { id: string }>();
  for (const definition of noteFunctions) {
    const fn = await tx.function.create({
      data: {
        projectId: ids.projectId,
        name: definition.title,
        slug: definition.slug,
        description: definition.description,
        code: definition.code,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        timeoutMs: 5_000,
        enabled: true,
        riskLevel: definition.riskLevel,
        requiredPermissions: definition.permissions,
        version: 1,
      },
    });
    await tx.functionVersion.create({
      data: {
        functionId: fn.id,
        version: 1,
        code: definition.code,
        checksum: createHash("sha256").update(definition.code).digest("hex"),
        validationResult: { valid: true, starter: "notes-demo" },
        createdByUserId: ids.userId,
      },
    });
    functions.set(definition.slug, fn);
  }

  const endpoints = [];
  for (const kind of ["mcp", "http"] as const) {
    const endpoint = await tx.runtimeEndpoint.create({
      data: {
        projectId: ids.projectId,
        environmentId: ids.developmentId,
        name: "Note App",
        slug: "note-app",
        description: "Persistence-backed starter using known DEMO credentials",
        kind,
        status: "draft",
        runtimeVersion: "1",
        runtimeConfig: {
          timeoutMs: 30_000,
          maxConcurrentRequests: 20,
          env: {},
          endpointAccessPolicy: {
            mode: "authenticated",
            allowedSubjects: [],
          },
        },
        defaultAuthPolicyId: policy.id,
      },
    });
    endpoints.push(endpoint);
    await tx.endpointAuthPolicy.create({
      data: { endpointId: endpoint.id, authPolicyId: policy.id, position: 0 },
    });
    await tx.networkPolicy.create({
      data: {
        projectId: ids.projectId,
        endpointId: endpoint.id,
        allowedHosts: [],
        allowedMethods: [],
        allowedPorts: [],
        allowPrivateHosts: [],
      },
    });
  }
  const mcp = endpoints.find((endpoint) => endpoint.kind === "mcp")!;
  const http = endpoints.find((endpoint) => endpoint.kind === "http")!;
  for (const binding of [
    { slug: "save_note", toolName: "save_note", title: "Save note" },
    { slug: "get_note", toolName: "get_note", title: "Get note" },
  ])
    await tx.mcpToolBinding.create({
      data: {
        endpointId: mcp.id,
        functionId: functions.get(binding.slug)!.id,
        toolName: binding.toolName,
        title: binding.title,
        description: `${binding.title} in integrated persistence`,
      },
    });
  await tx.httpRouteBinding.createMany({
    data: [
      {
        endpointId: http.id,
        functionId: functions.get("save_note")!.id,
        method: "PUT",
        path: "/v1/notes/:id",
        inputMapping: {
          id: "path.id",
          title: "body.title",
          body: "body.body",
        },
      },
      {
        endpointId: http.id,
        functionId: functions.get("get_note")!.id,
        method: "GET",
        path: "/v1/notes/:id",
        inputMapping: { id: "path.id" },
      },
    ],
  });

  const projectDeployment = await tx.projectDeployment.create({
    data: {
      projectId: ids.projectId,
      environmentId: ids.developmentId,
      version: 1,
      status: "queued",
    },
  });
  const childIds = [];
  for (const endpoint of endpoints) {
    const child = await tx.deployment.create({
      data: {
        endpointId: endpoint.id,
        projectDeploymentId: projectDeployment.id,
        version: 1,
        status: "queued",
        snapshot: {},
        runtimeConfig: {
          env: {},
          endpointAccessPolicy: {
            mode: "authenticated",
            allowedSubjects: [],
          },
          network: { allowPrivateHosts: [] },
          timeoutMs: 30_000,
          maxConcurrentRequests: 20,
          requestedBy: ids.userId,
        },
        checksum: "pending",
      },
    });
    childIds.push(child.id);
    await tx.deploymentLog.create({
      data: {
        deploymentId: child.id,
        level: "info",
        message: "Note App starter deployment queued",
        metadata: { projectDeploymentId: projectDeployment.id },
      },
    });
  }
  await tx.auditEvent.create({
    data: {
      projectId: ids.projectId,
      environmentId: ids.developmentId,
      actorType: "user",
      actorId: ids.userId,
      action: "project_deployment.queued",
      targetType: "project_deployment",
      targetId: projectDeployment.id,
      metadata: { version: 1, starter: "notes-demo" },
    },
  });
  return { id: projectDeployment.id, status: projectDeployment.status, childIds };
}

const objectSchema = (
  properties: Record<string, Prisma.InputJsonValue>,
  required: string[],
): Prisma.InputJsonObject => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

const noteSchema = objectSchema(
  {
    id: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    updatedAt: { type: "string" },
  },
  ["id", "title", "body", "updatedAt"],
);

const noteFunctions = [
  {
    slug: "note_store",
    title: "Note store",
    description: "Internal persistence owner for the Note App starter",
    riskLevel: "write" as const,
    permissions: [],
    inputSchema: objectSchema(
      {
        action: { type: "string", enum: ["get", "save"] },
        id: { type: "string", minLength: 1, maxLength: 120 },
        title: { type: "string", maxLength: 200 },
        body: { type: "string", maxLength: 10_000 },
      },
      ["action", "id"],
    ),
    outputSchema: objectSchema(
      { found: { type: "boolean" }, note: { anyOf: [noteSchema, { type: "null" }] } },
      ["found", "note"],
    ),
    code: `export default async function handler(ctx: RuntimeContext, input: FunctionInput) {
  const key = "note:" + input.id;
  if (input.action === "save") {
    const note = { id: input.id, title: input.title ?? "", body: input.body ?? "", updatedAt: new Date().toISOString() };
    await ctx.storage.set(key, note);
    return { found: true, note };
  }
  const note = await ctx.storage.get(key);
  return { found: note !== null, note };
}`,
  },
  {
    slug: "save_note",
    title: "Save note",
    description: "Create or replace one note in integrated persistence",
    riskLevel: "write" as const,
    permissions: ["notes.write"],
    inputSchema: objectSchema(
      {
        id: { type: "string", minLength: 1, maxLength: 120 },
        title: { type: "string", maxLength: 200 },
        body: { type: "string", maxLength: 10_000 },
      },
      ["id", "title", "body"],
    ),
    outputSchema: noteSchema,
    code: `export default async function handler(ctx: RuntimeContext, input: FunctionInput) {
  const result = await ctx.functions.call("note_store", { action: "save", id: input.id, title: input.title, body: input.body });
  return result.note;
}`,
  },
  {
    slug: "get_note",
    title: "Get note",
    description: "Read one note from integrated persistence",
    riskLevel: "read" as const,
    permissions: ["notes.read"],
    inputSchema: objectSchema(
      { id: { type: "string", minLength: 1, maxLength: 120 } },
      ["id"],
    ),
    outputSchema: objectSchema(
      { found: { type: "boolean" }, note: { anyOf: [noteSchema, { type: "null" }] } },
      ["found", "note"],
    ),
    code: `export default async function handler(ctx: RuntimeContext, input: FunctionInput) {
  return ctx.functions.call("note_store", { action: "get", id: input.id });
}`,
  },
];
