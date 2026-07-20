import { Ajv } from "ajv";
import { prisma } from "@mcpops/db";
import { resolveFunctionCallGraph } from "@mcpops/shared";
import {
  attachCurrentFunctionVersions,
  bundleFunction,
  type BuildFailure,
} from "./function-bundler.js";
import {
  deploymentChecksum,
  validateCachePolicy,
  validateInsecureTlsHosts,
  validatePrivateHosts,
  validateRuntimeEnvironment,
  snapshotReviewedQueries,
} from "./builder-validation.js";
import { finalizeProjectDeployment } from "./project-deployment.js";
import { ensureCollectionIndexes } from "./collection-indexes.js";

const ajv = new Ajv({ allErrors: true, strict: false });

// One build scope owns validation and artifact persistence so a partial schedule
// slice can never become independently activatable.
// eslint-disable-next-line max-lines-per-function
export async function buildScheduleDeployment(
  scheduleDeploymentId: string,
): Promise<void> {
  const artifact = await prisma.scheduleDeployment.findUniqueOrThrow({
    where: { id: scheduleDeploymentId },
    include: {
      projectDeployment: true,
      project: { include: { environments: true, libraries: true } },
    },
  });
  let failureFunctions: BuildFailure[] = [];
  try {
    await prisma.$transaction([
      prisma.scheduleDeployment.update({
        where: { id: scheduleDeploymentId },
        data: { status: "building" },
      }),
      prisma.projectDeployment.updateMany({
        where: { id: artifact.projectDeploymentId, status: "queued" },
        data: { status: "building" },
      }),
    ]);
    const bindings = await prisma.cronBinding.findMany({
      where: { projectId: artifact.projectId, deletedAt: null },
      include: { networkPolicy: true },
      orderBy: [{ environmentId: "asc" }, { id: "asc" }],
    });
    const projectFunctions = await prisma.function.findMany({
      where: { projectId: artifact.projectId, enabled: true },
      include: { grants: true },
    });
    const versions = await prisma.functionVersion.findMany({
      where: {
        OR: projectFunctions.map((fn) => ({ functionId: fn.id, version: fn.version })),
      },
    });
    const versioned = attachCurrentFunctionVersions(projectFunctions, versions);
    const slices = [];
    for (const environment of artifact.project.environments) {
      const environmentBindings = bindings.filter(
        (binding) => binding.environmentId === environment.id,
      );
      const entryIds = new Set(
        environmentBindings
          .filter((binding) => binding.enabled)
          .map((binding) => binding.functionId),
      );
      const { functions: selected, calls } = resolveFunctionCallGraph(
        versioned,
        entryIds,
      );
      const requiredSecrets = [
        ...new Set(
          selected.flatMap((fn) => fn.grants.map((grant) => grant.secretName)),
        ),
      ];
      const availableSecrets = requiredSecrets.length
        ? await prisma.secret.findMany({
            where: {
              projectId: artifact.projectId,
              environmentId: environment.id,
              name: { in: requiredSecrets },
              encryptedValue: { not: null },
            },
            select: { name: true },
          })
        : [];
      const available = new Set(availableSecrets.map((secret) => secret.name));
      const missing = requiredSecrets.filter((name) => !available.has(name));
      if (missing.length) {
        failureFunctions = selected
          .filter((fn) => fn.grants.some((grant) => missing.includes(grant.secretName)))
          .map((fn) => ({
            id: fn.id,
            name: fn.name,
            slug: fn.slug,
            version: fn.versions[0]?.version ?? 0,
          }));
        throw new Error(
          `Required function secrets are not configured in ${environment.name}: ${missing.join(", ")}`,
        );
      }
      failureFunctions = [];
      const functions = [];
      for (const fn of selected) {
        const version = fn.versions[0];
        if (!version) throw new Error(`Function ${fn.name} has no source version`);
        if (entryIds.has(fn.id) && !ajv.compile(fn.inputSchema as object)({}))
          throw new Error(
            `Function ${fn.name} input schema does not accept the cron input {}`,
          );
        const result = await bundleFunction({
          code: version.code,
          inputSchema: fn.inputSchema,
          outputSchema: fn.outputSchema,
          sourcefile: `${fn.slug}.ts`,
          libraries: artifact.project.libraries.map((library) => ({
            importPath: library.importPath,
            code: library.code,
          })),
        });
        await prisma.functionVersion.update({
          where: { id: version.id },
          data: {
            compiledCode: result.code,
            sourceMap: result.sourceMap ?? null,
            validationResult: {
              valid: true,
              warnings: result.warnings,
              builtAt: new Date().toISOString(),
            },
          },
        });
        functions.push({
          id: fn.id,
          functionId: fn.id,
          versionId: version.id,
          version: version.version,
          name: fn.name,
          slug: fn.slug,
          enabled: fn.enabled,
          riskLevel: fn.riskLevel,
          requiredPermissions: fn.requiredPermissions as string[],
          secretGrants: fn.grants.map((grant) => grant.secretName),
          timeoutMs: fn.timeoutMs,
          inputSchema: fn.inputSchema,
          outputSchema: fn.outputSchema,
          cachePolicy: validateCachePolicy(fn.cachePolicy),
          compiledCode: result.code,
        });
      }
      const reviewedQueryFeatureEnabled =
        process.env.ENABLE_REVIEWED_DB_QUERIES === "true";
      const reviewedQueryRows = await prisma.functionQueryGrant.findMany({
        where: { enabled: true, functionId: { in: selected.map((fn) => fn.id) } },
        select: {
          id: true,
          functionId: true,
          queryDefinitionId: true,
          queryVersionId: true,
          queryDefinition: {
            select: {
              id: true,
              projectId: true,
              environmentId: true,
              queryId: true,
              connection: {
                select: {
                  id: true,
                  projectId: true,
                  environmentId: true,
                  secretId: true,
                  name: true,
                  enabled: true,
                  secret: {
                    select: { id: true, projectId: true, environmentId: true },
                  },
                },
              },
            },
          },
          queryVersion: {
            select: {
              id: true,
              queryDefinitionId: true,
              version: true,
              sql: true,
              parameterOrder: true,
              parameterSchema: true,
              resultSchema: true,
              timeoutMs: true,
              maxRows: true,
              maxBytes: true,
              enabled: true,
            },
          },
        },
      });
      if (reviewedQueryRows.length && !reviewedQueryFeatureEnabled)
        throw new Error(
          "Reviewed database query grants require ENABLE_REVIEWED_DB_QUERIES=true",
        );
      const reviewedQueries = reviewedQueryFeatureEnabled
        ? snapshotReviewedQueries(artifact.projectId, environment.id, reviewedQueryRows)
        : [];
      const collectionGrantRows = await prisma.functionCollectionGrant.findMany({
        where: { enabled: true, functionId: { in: selected.map((fn) => fn.id) } },
        include: {
          collection: {
            include: { versions: { orderBy: { version: "desc" }, take: 1 } },
          },
        },
      });
      const collections = collectionGrantRows.map((grant) => {
        const definition = grant.collection;
        const version = definition.versions[0];
        if (
          !definition.enabled ||
          definition.projectId !== artifact.projectId ||
          !version
        )
          throw new Error("Collection grant references an unavailable collection");
        const permissions = grant.permissions.filter(
          (permission): permission is "read" | "write" | "delete" =>
            permission === "read" || permission === "write" || permission === "delete",
        );
        return {
          grantId: grant.id,
          functionId: grant.functionId,
          collectionId: definition.id,
          slug: definition.slug,
          schemaVersionId: version.id,
          schemaVersion: version.version,
          schema: version.schema,
          indexes: version.indexes,
          permissions,
        };
      });
      await ensureCollectionIndexes(
        collections as Array<{
          collectionId: string;
          schema: Record<string, unknown>;
          indexes: unknown;
        }>,
      );
      const functionById = new Map(projectFunctions.map((fn) => [fn.id, fn]));
      slices.push({
        environment: {
          id: environment.id,
          slug: environment.slug,
          name: environment.name,
          capturePayloads: environment.capturePayloads,
          logLevel: environment.logLevel,
          logRetentionDays: environment.logRetentionDays,
          logRetentionMaxEntries: environment.logRetentionMaxEntries,
          logRetentionMaxBytes: environment.logRetentionMaxBytes,
        },
        env: validateRuntimeEnvironment(environment.variables),
        functions,
        functionCalls: calls,
        libraries: artifact.project.libraries.map((library) => ({
          id: library.id,
          name: library.name,
          importPath: library.importPath,
          version: library.version,
          code: library.code,
        })),
        capabilities: {
          reviewedDatabaseQueries: { enabled: reviewedQueryFeatureEnabled },
        },
        reviewedQueries,
        collections,
        bindings: environmentBindings.map((binding) => {
          const fn = functionById.get(binding.functionId);
          const permissions = Array.isArray(binding.permissionGrants)
            ? binding.permissionGrants.filter(
                (item): item is string => typeof item === "string",
              )
            : [];
          const missingPermissions =
            fn && Array.isArray(fn.requiredPermissions)
              ? (fn.requiredPermissions as unknown[]).filter(
                  (item): item is string =>
                    typeof item === "string" && !permissions.includes(item),
                )
              : [];
          if (missingPermissions.length)
            throw new Error(
              `Cron binding ${binding.name} is missing service permissions: ${missingPermissions.join(", ")}`,
            );
          const policy = binding.networkPolicy;
          return {
            id: binding.id,
            name: binding.name,
            functionId: binding.functionId,
            expression: binding.expression,
            timezone: binding.timezone,
            enabled: binding.enabled,
            serviceSubject: binding.serviceSubject,
            permissionGrants: permissions,
            networkPolicy: policy
              ? {
                  allowedHosts: policy.allowedHosts as string[],
                  allowedMethods: policy.allowedMethods as string[],
                  allowedPorts: policy.allowedPorts as number[],
                  maxResponseBytes: policy.maxResponseBytes,
                  allowPrivateHosts: validatePrivateHosts(
                    policy.allowPrivateHosts as string[],
                    policy.allowedHosts as string[],
                  ),
                  allowInsecureTlsHosts: validateInsecureTlsHosts(
                    policy.allowInsecureTlsHosts as string[],
                    policy.allowedHosts as string[],
                  ),
                }
              : {},
          };
        }),
      });
    }
    const snapshot = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      project: {
        id: artifact.project.id,
        slug: artifact.project.slug,
        name: artifact.project.name,
      },
      slices,
    };
    const checksum = deploymentChecksum(snapshot);
    await prisma.scheduleDeployment.update({
      where: { id: scheduleDeploymentId },
      data: { snapshot: snapshot as never, checksum, status: "deploying" },
    });
    await finalizeProjectDeployment(artifact.projectDeploymentId);
  } catch (error) {
    const failure = scheduleDeploymentFailure(error, failureFunctions);
    await prisma.$transaction([
      prisma.scheduleDeployment.update({
        where: { id: scheduleDeploymentId },
        data: { status: "failed", completedAt: new Date() },
      }),
      prisma.projectDeployment.updateMany({
        where: {
          id: artifact.projectDeploymentId,
          failureCause: null,
        },
        data: failure,
      }),
    ]);
    await finalizeProjectDeployment(artifact.projectDeploymentId);
    throw error;
  }
}

export function scheduleDeploymentFailure(
  error: unknown,
  functions: BuildFailure[],
): { failureCause: string; failureMetadata?: { functions: object[] } } {
  const failureCause = (error instanceof Error ? error.message : "Build failed").slice(
    0,
    8_000,
  );
  return {
    failureCause,
    ...(functions.length
      ? {
          failureMetadata: {
            functions: functions.map((fn) => ({
              functionId: fn.id,
              functionName: fn.name,
              functionSlug: fn.slug,
              functionVersion: fn.version,
            })),
          },
        }
      : {}),
  };
}
