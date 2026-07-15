import { resolveFunctionCallGraph } from "@mcpops/shared";
import { prisma } from "@mcpops/db";
import { finalizeProjectDeployment } from "./project-deployment.js";
import {
  attachCurrentFunctionVersions,
  bundleFunction,
  type BuildFailure,
} from "./function-bundler.js";
import {
  asRecord,
  deploymentChecksum,
  snapshotReviewedQueries,
  validateCachePolicy,
  validateEndpointAccessPolicy,
  validateInsecureTlsHosts,
  validatePrivateHosts,
  validateResponseMappingDefinition,
  validateRuntimeEnvironment,
  type ExtendedDeploymentSnapshot,
} from "./builder-validation.js";
import {
  collectRequiredAuthPolicyIds,
  referencedAuthSecretNames,
  snapshotReferencedAuthPolicies,
  validateAuthSecretReferences,
} from "./auth-policy-validation.js";
import { ensureCollectionIndexes } from "./collection-indexes.js";

export async function buildDeployment(
  deploymentId: string,
  actorId?: string,
  options: { finalAttempt?: boolean } = {},
): Promise<void> {
  const deployment = await prisma.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
    include: {
      endpoint: {
        include: {
          project: true,
          environment: true,
          mcpToolBindings: true,
          httpRouteBindings: true,
          defaultAuthPolicy: true,
          authPolicyAssignments: {
            include: { authPolicy: true },
            orderBy: { position: "asc" },
          },
          networkPolicy: true,
        },
      },
    },
  });
  const endpoint = deployment.endpoint;
  let activated = false;
  let artifactStored = false;
  let failureFunctions: BuildFailure[] = [];
  try {
    if (deployment.projectDeploymentId)
      await prisma.projectDeployment.updateMany({
        where: { id: deployment.projectDeploymentId, status: "queued" },
        data: { status: "building" },
      });
    if (
      (endpoint.kind === "mcp" && endpoint.httpRouteBindings.length > 0) ||
      (endpoint.kind === "http" && endpoint.mcpToolBindings.length > 0)
    )
      throw new Error("Runtime endpoint contains bindings for the wrong protocol");
    const projectFunctions = await prisma.function.findMany({
      where: { projectId: endpoint.projectId, enabled: true },
      include: { grants: true },
    });
    const currentVersions = await prisma.functionVersion.findMany({
      where: {
        OR: projectFunctions.map((fn) => ({
          functionId: fn.id,
          version: fn.version,
        })),
      },
    });
    const versionedProjectFunctions = attachCurrentFunctionVersions(
      projectFunctions,
      currentVersions,
    );
    const entryFunctionIds = new Set([
      ...(endpoint.kind === "mcp" ? endpoint.mcpToolBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => binding.functionId),
      ...(endpoint.kind === "http" ? endpoint.httpRouteBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => binding.functionId),
    ]);
    const { functions: selectedFunctions, calls: functionCalls } =
      resolveFunctionCallGraph(versionedProjectFunctions, entryFunctionIds);
    const requiredFunctionSecrets = [
      ...new Set(
        selectedFunctions.flatMap((fn) => fn.grants.map((grant) => grant.secretName)),
      ),
    ];
    if (requiredFunctionSecrets.length) {
      const configured = await prisma.secret.findMany({
        where: {
          projectId: endpoint.projectId,
          environmentId: endpoint.environmentId,
          name: { in: requiredFunctionSecrets },
        },
        select: { name: true },
      });
      const available = new Set(configured.map((secret) => secret.name));
      const missing = requiredFunctionSecrets.filter((name) => !available.has(name));
      if (missing.length) {
        failureFunctions = selectedFunctions
          .filter((fn) => fn.grants.some((grant) => missing.includes(grant.secretName)))
          .map((fn) => ({
            id: fn.id,
            name: fn.name,
            slug: fn.slug,
            version: fn.versions[0]?.version ?? 0,
          }));
        throw new Error(
          `Required function secrets are not configured in ${endpoint.environment.name}: ${missing.join(", ")}`,
        );
      }
    }
    failureFunctions = [];
    const libraries = await prisma.projectLibrary.findMany({
      where: { projectId: endpoint.projectId },
    });
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: "building" },
    });
    await prisma.deploymentLog.create({
      data: {
        deploymentId,
        level: "info",
        message: `Building ${selectedFunctions.length} reusable functions`,
      },
    });
    const requiredPolicyIds = collectRequiredAuthPolicyIds(
      endpoint.authPolicyAssignments.map((item) => item.authPolicyId),
      endpoint.mcpToolBindings,
      endpoint.httpRouteBindings,
    );
    const policyRows = requiredPolicyIds.length
      ? await prisma.authPolicy.findMany({
          where: {
            id: { in: requiredPolicyIds },
            projectId: endpoint.projectId,
          },
        })
      : [];
    const authPolicies = snapshotReferencedAuthPolicies(
      endpoint.projectId,
      requiredPolicyIds,
      policyRows,
    );
    const authSecretNames = referencedAuthSecretNames(authPolicies);
    const availableAuthSecrets = authSecretNames.length
      ? await prisma.secret.findMany({
          where: {
            projectId: endpoint.projectId,
            environmentId: endpoint.environmentId,
            name: { in: authSecretNames },
          },
          select: { name: true },
        })
      : [];
    validateAuthSecretReferences(
      authSecretNames,
      availableAuthSecrets.map((secret) => secret.name),
    );
    const reviewedQueryFeatureEnabled =
      process.env.ENABLE_REVIEWED_DB_QUERIES === "true";
    const reviewedQueryRows = await prisma.functionQueryGrant.findMany({
      where: {
        enabled: true,
        functionId: { in: selectedFunctions.map((fn) => fn.id) },
      },
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
    if (reviewedQueryRows.length && !reviewedQueryFeatureEnabled) {
      const affectedIds = new Set(reviewedQueryRows.map((row) => row.functionId));
      failureFunctions = selectedFunctions
        .filter((fn) => affectedIds.has(fn.id))
        .map((fn) => ({
          id: fn.id,
          name: fn.name,
          slug: fn.slug,
          version: fn.versions[0]?.version ?? 0,
        }));
      throw new Error(
        "Reviewed database query grants require ENABLE_REVIEWED_DB_QUERIES=true",
      );
    }
    failureFunctions = [];
    const reviewedQueries = reviewedQueryFeatureEnabled
      ? snapshotReviewedQueries(
          endpoint.projectId,
          endpoint.environmentId,
          reviewedQueryRows,
        )
      : [];
    const collectionGrantRows = await prisma.functionCollectionGrant.findMany({
      where: {
        enabled: true,
        functionId: { in: selectedFunctions.map((fn) => fn.id) },
      },
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
        definition.projectId !== endpoint.projectId ||
        !version
      )
        throw new Error("Collection grant references an unavailable collection");
      const permissions = grant.permissions.filter(
        (permission): permission is "read" | "write" | "delete" =>
          permission === "read" || permission === "write" || permission === "delete",
      );
      if (permissions.length === 0 || permissions.length !== grant.permissions.length)
        throw new Error(`Collection ${definition.slug} has invalid permissions`);
      return {
        grantId: grant.id,
        functionId: grant.functionId,
        collectionId: definition.id,
        slug: definition.slug,
        schemaVersionId: version.id,
        schemaVersion: version.version,
        schema: version.schema as Record<string, unknown>,
        indexes: version.indexes as Array<{
          name: string;
          kind: "btree" | "gin";
          fields: string[];
          unique: boolean;
        }>,
        permissions,
      };
    });
    await ensureCollectionIndexes(collections);
    const functions = [];
    for (const fn of selectedFunctions) {
      const version = fn.versions[0];
      if (!version) throw new Error(`Function ${fn.name} has no source version`);
      failureFunctions = [
        {
          id: fn.id,
          name: fn.name,
          slug: fn.slug,
          version: version.version,
        },
      ];
      const result = await bundleFunction({
        code: version.code,
        inputSchema: fn.inputSchema,
        outputSchema: fn.outputSchema,
        sourcefile: `${fn.slug}.ts`,
        libraries: libraries.map((library) => ({
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
        description: fn.description,
        code: version.code,
        compiledCode: result.code,
        checksum: version.checksum,
        inputSchema: fn.inputSchema as Record<string, unknown>,
        outputSchema: fn.outputSchema as Record<string, unknown>,
        timeoutMs: fn.timeoutMs,
        riskLevel: fn.riskLevel,
        enabled: fn.enabled,
        requiredPermissions: fn.requiredPermissions as string[],
        secretGrants: fn.grants.map((grant) => grant.secretName),
        secretRefs: fn.grants.map((grant) => ({
          id: grant.secretId ?? `name:${grant.secretName}`,
          name: grant.secretName,
        })),
        cachePolicy: validateCachePolicy(fn.cachePolicy),
      });
      await prisma.deploymentLog.create({
        data: {
          deploymentId,
          level: "info",
          message: `Validated and bundled ${fn.name}@${version.version}`,
          metadata: { checksum: version.checksum, warnings: result.warnings },
        },
      });
      failureFunctions = [];
    }
    const runtimeConfig = asRecord(deployment.runtimeConfig);
    const env = validateRuntimeEnvironment(runtimeConfig.env);
    const endpointAccessPolicy = validateEndpointAccessPolicy(
      runtimeConfig.endpointAccessPolicy,
    );
    const snapshot: ExtendedDeploymentSnapshot = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      project: {
        id: endpoint.project.id,
        slug: endpoint.project.slug,
        name: endpoint.project.name,
      },
      environment: {
        id: endpoint.environment.id,
        slug: endpoint.environment.slug,
        name: endpoint.environment.name,
      },
      endpoint: {
        id: endpoint.id,
        slug: endpoint.slug,
        name: endpoint.name,
        kind: endpoint.kind,
      },
      functions,
      functionCalls,
      mcpBindings: (endpoint.kind === "mcp" ? endpoint.mcpToolBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => ({
          id: binding.id,
          functionId: binding.functionId,
          toolName: binding.toolName,
          title: binding.title,
          description: binding.description,
          enabled: binding.enabled,
        })),
      httpBindings: (endpoint.kind === "http" ? endpoint.httpRouteBindings : [])
        .filter((binding) => binding.enabled)
        .map((binding) => ({
          id: binding.id,
          functionId: binding.functionId,
          method: binding.method,
          path: binding.path,
          inputMapping: binding.inputMapping,
          responseMapping: validateResponseMappingDefinition(binding.responseMapping),
          enabled: binding.enabled,
        })),
      libraries: libraries.map((library) => ({
        id: library.id,
        name: library.name,
        importPath: library.importPath,
        version: library.version,
        code: library.code,
      })),
      authPolicies,
      ...(requiredPolicyIds[0] ? { defaultAuthPolicyId: requiredPolicyIds[0] } : {}),
      capabilities: {
        reviewedDatabaseQueries: { enabled: reviewedQueryFeatureEnabled },
      },
      reviewedQueries,
      collections,
      endpointAccessPolicy,
      env,
      ...(endpoint.networkPolicy
        ? {
            networkPolicy: {
              allowedHosts: endpoint.networkPolicy.allowedHosts as string[],
              allowedMethods: endpoint.networkPolicy.allowedMethods as string[],
              allowedPorts: endpoint.networkPolicy.allowedPorts as number[],
              maxResponseBytes: endpoint.networkPolicy.maxResponseBytes,
              allowPrivateHosts: validatePrivateHosts(
                endpoint.networkPolicy.allowPrivateHosts as string[],
                endpoint.networkPolicy.allowedHosts as string[],
              ),
              allowInsecureTlsHosts: validateInsecureTlsHosts(
                endpoint.networkPolicy.allowInsecureTlsHosts as string[],
                endpoint.networkPolicy.allowedHosts as string[],
              ),
            },
          }
        : {}),
    };
    const sum = deploymentChecksum(snapshot);
    await prisma.$transaction(async (tx) => {
      if (deployment.projectDeploymentId) {
        await tx.deployment.update({
          where: { id: deploymentId },
          data: {
            snapshot: snapshot as never,
            checksum: sum,
            status: "deploying",
          },
        });
        await tx.deploymentLog.create({
          data: {
            deploymentId,
            level: "info",
            message: `Endpoint artifact ${deployment.version} built for project deployment`,
            metadata: { checksum: sum },
          },
        });
        return;
      }
      if (endpoint.activeDeploymentId)
        await tx.deployment.update({
          where: { id: endpoint.activeDeploymentId },
          data: { status: "rolled_back" },
        });
      await tx.deployment.update({
        where: { id: deploymentId },
        data: {
          snapshot: snapshot as never,
          checksum: sum,
          status: "active",
          completedAt: new Date(),
        },
      });
      await tx.runtimeEndpoint.update({
        where: { id: endpoint.id },
        data: { activeDeploymentId: deploymentId, status: "deployed" },
      });
      await tx.deploymentLog.create({
        data: {
          deploymentId,
          level: "info",
          message: `Deployment ${deployment.version} activated`,
          metadata: { checksum: sum },
        },
      });
      await tx.auditEvent.create({
        data: {
          projectId: endpoint.projectId,
          environmentId: endpoint.environmentId,
          endpointId: endpoint.id,
          actorType: actorId ? "user" : "system",
          actorId,
          action: "deployment.activated",
          targetType: "deployment",
          targetId: deploymentId,
          metadata: { version: deployment.version, checksum: sum },
        },
      });
    });
    artifactStored = true;
    activated = !deployment.projectDeploymentId;
    if (deployment.projectDeploymentId) {
      await finalizeProjectDeployment(deployment.projectDeploymentId);
      activated = true;
    }
  } catch (error) {
    if (activated) throw error;
    if (artifactStored && deployment.projectDeploymentId && !options.finalAttempt)
      throw error;
    const message = error instanceof Error ? error.message : "Build failed";
    const failureOperations = [
      prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: "failed", completedAt: new Date() },
      }),
      prisma.deploymentLog.create({
        data: {
          deploymentId,
          level: "error",
          message,
          metadata: failureFunctions.length
            ? {
                functions: failureFunctions.map((fn) => ({
                  functionId: fn.id,
                  functionName: fn.name,
                  functionSlug: fn.slug,
                  functionVersion: fn.version,
                })),
              }
            : undefined,
        },
      }),
      ...(deployment.projectDeploymentId
        ? []
        : [
            prisma.runtimeEndpoint.update({
              where: { id: endpoint.id },
              data: { status: "failed" },
            }),
          ]),
    ];
    await prisma.$transaction(failureOperations);
    if (deployment.projectDeploymentId)
      await finalizeProjectDeployment(deployment.projectDeploymentId);
    throw error;
  }
}
