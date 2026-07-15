import { prisma } from "@mcpops/db";
import { bundleFunction } from "@mcpops/sandbox";
import { resolveFunctionCallGraph, testInvocationSchema } from "@mcpops/shared";
import type { PlatformSession } from "./auth.js";
import { projectRepository } from "./repository.js";

export async function executeDevelopmentFunctionTest(
  session: PlatformSession,
  functionId: string,
  inputValue: unknown,
): Promise<{ status: number; body: unknown }> {
  const body = testInvocationSchema.parse(inputValue);
  const fn = await projectRepository(session.projectId).projectFunction(functionId);
  if (!fn)
    throw Object.assign(new Error("Function not found"), {
      code: "NOT_FOUND",
      statusCode: 404,
    });
  const cronBinding =
    body.source === "cron" && body.cronBindingId
      ? await prisma.cronBinding.findFirst({
          where: {
            id: body.cronBindingId,
            projectId: session.projectId,
            functionId,
            deletedAt: null,
          },
          include: { networkPolicy: true },
        })
      : null;
  if (body.source === "cron" && !cronBinding)
    throw Object.assign(new Error("Select a cron binding for this Function."), {
      code: "INVALID_CRON_BINDING",
      statusCode: 400,
    });
  const endpoint = await prisma.runtimeEndpoint.findFirst({
    where: {
      projectId: session.projectId,
      activeDeploymentId: { not: null },
      environment: { slug: "development" },
      ...(cronBinding ? { environmentId: cronBinding.environmentId } : {}),
      ...(body.endpointId ? { id: body.endpointId } : {}),
    },
    select: { id: true },
  });
  if (!endpoint)
    throw Object.assign(
      new Error(
        "Deploy the Project to development once, then select a development endpoint for runtime capabilities.",
      ),
      { code: "DEVELOPMENT_RUNTIME_UNAVAILABLE", statusCode: 409 },
    );
  const availableFunctions = await prisma.function.findMany({
    where: { projectId: session.projectId, enabled: true },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, grants: true },
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
          { code: "FUNCTION_NOT_SAVED", statusCode: 409 },
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
        ...(cronBinding
          ? {
              input: {},
              caller: {
                subject: cronBinding.serviceSubject,
                permissions: cronBinding.permissionGrants,
                claims: { service: true, simulated: true },
              },
              cronBinding: {
                id: cronBinding.id,
                name: cronBinding.name,
                expression: cronBinding.expression,
                timezone: cronBinding.timezone,
                permissionGrants: cronBinding.permissionGrants,
                serviceSubject: cronBinding.serviceSubject,
                networkPolicy: cronBinding.networkPolicy,
              },
            }
          : {}),
        savedDevelopmentSnapshot: { functions: snapshotFunctions, calls },
      }),
      signal: AbortSignal.timeout(125_000),
    },
  );
  return { status: response.status, body: await response.json() };
}
