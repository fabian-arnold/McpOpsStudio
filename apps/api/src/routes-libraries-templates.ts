import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { functionTemplates, projectLibrarySchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { checksum, sessionContext, parse, requestId } from "./helpers.js";
import { loadTemplateInstallContext } from "./api-view-helpers.js";
import { validateProjectLibrary } from "./control-plane-validation.js";
import {
  previewTemplateInstallation,
  templateInstallSelectionSchema,
} from "./template-install.js";

export async function registerLibrariesTemplatesRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/libraries", async (request) => {
    const session = sessionContext(request);
    const rows = await prisma.projectLibrary.findMany({
      where: { projectId: session.projectId },
      orderBy: [{ importPath: "asc" }, { version: "desc" }],
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows)
      if (!latest.has(row.importPath)) latest.set(row.importPath, row);
    return [...latest.values()].map((row) => ({
      ...row,
      importExample: `import { ${Array.isArray(row.exportedFunctions) && typeof row.exportedFunctions[0] === "string" ? row.exportedFunctions[0] : "utility"} } from ${JSON.stringify(row.importPath)};`,
      versionCount: rows.filter((candidate) => candidate.importPath === row.importPath)
        .length,
    }));
  });
  app.get("/api/libraries/:libraryId/versions", async (request, reply) => {
    const session = sessionContext(request);
    const { libraryId } = request.params as { libraryId: string };
    const library = await prisma.projectLibrary.findFirst({
      where: { id: libraryId, projectId: session.projectId },
      select: { importPath: true },
    });
    if (!library)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Library not found",
          requestId: requestId(request),
        },
      });
    return prisma.projectLibrary.findMany({
      where: { projectId: session.projectId, importPath: library.importPath },
      orderBy: { version: "desc" },
    });
  });
  app.post("/api/libraries", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const parsed = parse(projectLibrarySchema, request.body);
    const input = {
      ...parsed,
      description: parsed.description ?? "",
      exportedFunctions: parsed.exportedFunctions ?? [],
    };
    await validateProjectLibrary(input.importPath, input.code);
    const latest = await prisma.projectLibrary.aggregate({
      where: { projectId: session.projectId, importPath: input.importPath },
      _max: { version: true },
    });
    const created = await prisma.projectLibrary.create({
      data: {
        projectId: session.projectId,
        ...input,
        version: (latest._max.version ?? 0) + 1,
      },
    });
    await prisma.auditEvent.create({
      data: {
        projectId: session.projectId,
        actorType: "user",
        actorId: session.userId,
        action: "project_library.version_created",
        targetType: "project_library",
        targetId: created.id,
        metadata: {
          name: created.name,
          importPath: created.importPath,
          version: created.version,
          exportedFunctions: created.exportedFunctions,
        },
      },
    });
    return reply.status(201).send(created);
  });
  app.get("/api/templates", async () => functionTemplates);
  app.post("/api/templates/install", async (request, reply) => {
    sessionContext(request);
    return reply.status(410).send({
      error: {
        code: "ENDPOINT_RETIRED",
        message: "Use the endpoint-scoped template preview and install endpoints.",
        requestId: requestId(request),
      },
    });
  });
  app.post(
    "/api/runtime-endpoints/:endpointId/templates/:templateId/preview",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId, templateId } = request.params as {
        endpointId: string;
        templateId: string;
      };
      const selection = parse(templateInstallSelectionSchema, request.body ?? {});
      const loaded = await loadTemplateInstallContext(
        session.projectId,
        endpointId,
        templateId,
      );
      if (!loaded)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Runtime endpoint or template not found",
            requestId: requestId(request),
          },
        });
      return previewTemplateInstallation(loaded.template, selection, loaded.context);
    },
  );

  app.post(
    "/api/runtime-endpoints/:endpointId/templates/:templateId/install",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId, templateId } = request.params as {
        endpointId: string;
        templateId: string;
      };
      const selection = parse(templateInstallSelectionSchema, request.body ?? {});
      const loaded = await loadTemplateInstallContext(
        session.projectId,
        endpointId,
        templateId,
      );
      if (!loaded)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Runtime endpoint or template not found",
            requestId: requestId(request),
          },
        });
      const existing = await prisma.function.findFirst({
        where: { projectId: session.projectId, slug: loaded.template.id },
        select: { id: true },
      });
      if (existing)
        return reply.status(409).send({
          error: {
            code: "ALREADY_EXISTS",
            message: "This template is already installed",
            requestId: requestId(request),
          },
        });
      const preview = previewTemplateInstallation(
        loaded.template,
        selection,
        loaded.context,
      );
      if (!preview.installable)
        return reply.status(422).send({
          error: {
            code: "TEMPLATE_CONFIGURATION_REQUIRED",
            message: "Template requirements are not satisfied.",
            requestId: requestId(request),
          },
          preview,
        });
      const template = loaded.template;
      const selectedSecrets = template.secrets
        .map((name) => ({ name, id: selection.secretGrants[name] }))
        .filter(
          (secret): secret is { name: string; id: string } =>
            typeof secret.id === "string",
        );
      const fn = await prisma.$transaction(async (tx) => {
        const created = await tx.function.create({
          data: {
            projectId: session.projectId,
            name: template.name,
            slug: template.id,
            description: template.description,
            code: template.code,
            inputSchema: template.inputSchema,
            outputSchema: template.outputSchema,
            timeoutMs: 30_000,
            enabled: preview.enabledAfterInstall,
            riskLevel: template.riskLevel,
            requiredPermissions: template.permissions,
            version: 1,
          } as never,
        });
        await tx.functionVersion.create({
          data: {
            functionId: created.id,
            version: 1,
            code: template.code,
            checksum: checksum(template.code),
            validationResult: {
              valid: false,
              state: "template_draft",
              templateId,
              fixtures: template.fixtures,
              documentation: template.documentation,
              availability: template.availability,
            },
            createdByUserId: session.userId,
          } as never,
        });
        if (selectedSecrets.length)
          await tx.secretGrant.createMany({
            data: selectedSecrets.map((secret) => ({
              functionId: created.id,
              secretId: secret.id,
              secretName: secret.name,
              accessMode: "read",
            })),
          });
        if (template.bindings.mcp && loaded.endpoint.kind === "mcp")
          await tx.mcpToolBinding.create({
            data: {
              endpointId,
              functionId: created.id,
              toolName: template.bindings.mcp,
              title: template.name,
              description: template.description,
              enabled: preview.enabledAfterInstall,
            },
          });
        if (template.bindings.http && loaded.endpoint.kind === "http")
          await tx.httpRouteBinding.create({
            data: {
              endpointId,
              functionId: created.id,
              method: template.bindings.http.method as never,
              path: template.bindings.http.path,
              enabled: preview.enabledAfterInstall,
            },
          });
        await tx.auditEvent.create({
          data: {
            projectId: session.projectId,
            environmentId: loaded.endpoint.environmentId,
            endpointId,
            functionId: created.id,
            actorType: "user",
            actorId: session.userId,
            action: "template.installed",
            targetType: "function",
            targetId: created.id,
            metadata: {
              templateId,
              enabled: preview.enabledAfterInstall,
              secretReferences: template.secrets,
              bindingTypes: Object.keys(template.bindings),
              networkPolicyMutated: false,
            },
          },
        });
        if (template.id === "webhook" && selection.authPolicyId)
          await tx.runtimeEndpoint.update({
            where: { id: endpointId },
            data: { defaultAuthPolicyId: selection.authPolicyId },
          });
        return created;
      });
      return reply
        .status(201)
        .send({ function: fn, enabled: fn.enabled, preview, template });
    },
  );
}
