import { type FastifyInstance } from "fastify";
import { Ajv } from "ajv";
import { bundleFunction } from "@mcpops/sandbox";
import { prisma } from "@mcpops/db";
import {
  functionCreateSchema,
  redactSensitive,
  resolveFunctionCallGraph,
  testInvocationSchema,
} from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import { projectRepository } from "./repository.js";
import { record } from "./api-value-helpers.js";
import { functionView } from "./api-operation-helpers.js";

export async function registerFunctionDetailRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/functions/:functionId", async (request, reply) => {
    const session = sessionContext(request);
    const { functionId } = request.params as { functionId: string };
    const fn = await projectRepository(session.projectId).projectFunction(functionId);
    return fn
      ? functionView(fn, true)
      : reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Function not found",
            requestId: requestId(request),
          },
        });
  });
  app.get("/api/functions/:functionId/fixtures", async (request, reply) => {
    const session = sessionContext(request);
    const { functionId } = request.params as { functionId: string };
    const fn = await projectRepository(session.projectId).projectFunction(functionId);
    if (!fn)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Function not found",
          requestId: requestId(request),
        },
      });
    const validation = record(fn.versions[0]?.validationResult);
    const fixtureSet = record(validation.fixtures);
    const items = Array.isArray(fixtureSet.items) ? fixtureSet.items : [];
    return redactSensitive({
      version: typeof fixtureSet.version === "number" ? fixtureSet.version : 1,
      items,
    });
  });
  app.post("/api/functions/:functionId/validate", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer"]);
    const { functionId } = request.params as { functionId: string };
    if (
      functionId !== "new" &&
      !(await projectRepository(session.projectId).projectFunction(functionId))
    )
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Function not found",
          requestId: requestId(request),
        },
      });
    try {
      const draft = parse(functionCreateSchema, request.body);
      const ajv = new Ajv({ allErrors: true, strict: false });
      ajv.compile(draft.inputSchema);
      ajv.compile(draft.outputSchema);
      const libraries = await prisma.projectLibrary.findMany({
        where: { projectId: session.projectId },
        orderBy: { version: "desc" },
        distinct: ["importPath"],
      });
      const result = await bundleFunction({
        code: draft.code,
        projectLibraries: libraries.map((library) => ({
          importPath: library.importPath,
          code: library.code,
          version: library.version,
        })),
      });
      return {
        valid: true,
        diagnostics: [],
        checksum: result.checksum,
        imports: result.imports,
      };
    } catch (error) {
      return {
        valid: false,
        diagnostics: [
          {
            message: error instanceof Error ? error.message : "Validation failed",
          },
        ],
      };
    }
  });
  app.post("/api/functions/:functionId/test", async (request, reply) => {
    const session = sessionContext(request);
    requireRole(session, ["owner", "admin", "developer", "operator"]);
    const { functionId } = request.params as { functionId: string };
    if (functionId === "new")
      return reply.status(409).send({
        error: {
          code: "DRAFT_NOT_SAVED",
          message: "Save the Function to development before testing it.",
          requestId: requestId(request),
        },
      });
    const fn = await projectRepository(session.projectId).projectFunction(functionId);
    if (!fn)
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Function not found",
          requestId: requestId(request),
        },
      });
    const body = parse(testInvocationSchema, request.body);
    const endpoint = await prisma.runtimeEndpoint.findFirst({
      where: {
        projectId: session.projectId,
        activeDeploymentId: { not: null },
        environment: { slug: "development" },
        ...(body.endpointId ? { id: body.endpointId } : {}),
      },
      select: { id: true },
    });
    if (!endpoint)
      return reply.status(409).send({
        error: {
          code: "DEVELOPMENT_RUNTIME_UNAVAILABLE",
          message:
            "Deploy the Project to development once, then select a development endpoint for runtime capabilities.",
          requestId: requestId(request),
        },
      });

    const availableFunctions = await prisma.function.findMany({
      where: { projectId: session.projectId, enabled: true },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        grants: true,
      },
      orderBy: { name: "asc" },
    });
    const { functions: selectedFunctions, calls } = resolveFunctionCallGraph(
      availableFunctions,
      new Set([functionId]),
    );
    const libraries = await prisma.projectLibrary.findMany({
      where: { projectId: session.projectId },
      orderBy: { version: "desc" },
      distinct: ["importPath"],
    });
    const snapshotFunctions = await Promise.all(
      selectedFunctions.map(async (item) => {
        const version = item.versions[0];
        if (!version)
          throw Object.assign(
            new Error(`Function ${item.name} has no saved development version`),
            {
              statusCode: 409,
              code: "FUNCTION_NOT_SAVED",
            },
          );
        const built = await bundleFunction({
          code: version.code,
          projectLibraries: libraries.map((library) => ({
            importPath: library.importPath,
            code: library.code,
            version: library.version,
          })),
        });
        return {
          id: item.id,
          functionId: item.id,
          versionId: version.id,
          version: version.version,
          name: item.name,
          slug: item.slug,
          enabled: item.enabled,
          riskLevel: item.riskLevel,
          requiredPermissions: item.requiredPermissions,
          secretGrants: item.grants.map((grant) => grant.secretName),
          timeoutMs: item.timeoutMs,
          inputSchema: item.inputSchema,
          outputSchema: item.outputSchema,
          cachePolicy: item.cachePolicy,
          compiledCode: built.compiledCode,
        };
      }),
    );
    const base = process.env.RUNTIME_INTERNAL_URL ?? "http://localhost:8080";
    const response = await fetch(
      `${base}/internal/runtime-endpoints/${endpoint.id}/functions/${functionId}/test`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.INTERNAL_API_TOKEN
            ? { "x-internal-token": process.env.INTERNAL_API_TOKEN }
            : {}),
        },
        body: JSON.stringify({
          ...body,
          savedDevelopmentSnapshot: { functions: snapshotFunctions, calls },
        }),
        signal: AbortSignal.timeout(125_000),
      },
    );
    const result = await response.json();
    return reply.status(response.status).send(result);
  });
}
