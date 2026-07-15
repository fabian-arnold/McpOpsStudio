import type { FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import type { FunctionExecutor } from "@mcpops/sandbox";
import { asSafeRuntimeError, type CallerIdentity } from "@mcpops/runtime-sdk";
import { authorizeEndpointAccess } from "./auth.js";
import { deploymentSnapshotSchema, type LoadedEndpoint } from "./domain.js";
import type { RuntimeInvoker } from "./invoke.js";
import type { RuntimeMetrics } from "./metrics.js";
import { loadEndpointById, logSettings } from "./repository.js";
import type { checkRuntimeReadiness } from "./readiness.js";
import {
  auditEndpointAccessDenial,
  correlation,
  findFunction,
  normalizeTestSource,
  object,
  requestAbortSignal,
  sendError,
  stringArray,
} from "./server-utils.js";

type Readiness = Awaited<ReturnType<typeof checkRuntimeReadiness>>;

export function registerInternalRoutes(
  app: FastifyInstance,
  dependencies: {
    executor: FunctionExecutor;
    internalApiToken?: string;
    invoker: RuntimeInvoker;
    metrics: RuntimeMetrics;
    readiness: () => Promise<Readiness>;
  },
): void {
  const { executor, internalApiToken, invoker, metrics, readiness } = dependencies;
  const options = { internalApiToken };
  app.get("/health", async () => ({
    status: "alive",
    component: "runtime",
    executor: executor.metadata,
    timestamp: new Date().toISOString(),
  }));
  app.get("/internal/capabilities", async (request, reply) => {
    if (
      options.internalApiToken &&
      request.headers["x-internal-token"] !== options.internalApiToken
    )
      return sendError(reply, {
        code: "UNAUTHENTICATED",
        message: "Internal authentication is required.",
        requestId: request.id,
      });
    return {
      executor: executor.metadata,
    };
  });
  app.get("/ready", async (_request, reply) => {
    const result = await readiness();
    return reply.code(result.ready ? 200 : 503).send({
      status: result.ready ? "ready" : "not_ready",
      checks: Object.fromEntries(
        Object.entries(result.checks).map(([name, ready]) => [
          name,
          ready ? "ok" : "unavailable",
        ]),
      ),
      activeDeployments: result.activeDeploymentCount,
      timestamp: new Date().toISOString(),
    });
  });
  app.get("/metrics", async (_request, reply) => {
    await readiness();
    return reply.type(metrics.contentType).send(await metrics.render());
  });
  app.get<{ Params: { endpointId: string } }>(
    "/internal/runtime-endpoints/:endpointId/manifest",
    async (request, reply) => {
      if (
        options.internalApiToken &&
        request.headers["x-internal-token"] !== options.internalApiToken
      )
        return sendError(reply, {
          code: "UNAUTHENTICATED",
          message: "Internal authentication is required.",
          requestId: request.id,
        });
      const endpoint = await loadEndpointById(request.params.endpointId);
      if (!endpoint)
        return reply.code(404).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Active endpoint not found.",
            requestId: request.id,
          },
        });
      return {
        endpoint: {
          id: endpoint.id,
          name: endpoint.name,
          slug: endpoint.slug,
          project: endpoint.project,
          environment: endpoint.environment,
        },
        deployment: endpoint.deployment,
        functions: endpoint.snapshot.functions.map(
          ({ compiledCode: _code, ...fn }) => fn,
        ),
        mcpBindings: endpoint.snapshot.mcpBindings,
        httpBindings: endpoint.snapshot.httpBindings,
        networkPolicy: endpoint.snapshot.networkPolicy,
      };
    },
  );
  app.post<{
    Params: { endpointId: string; functionId: string };
    Body: unknown;
  }>(
    "/internal/runtime-endpoints/:endpointId/functions/:functionId/test",
    async (request, reply) => {
      if (
        options.internalApiToken &&
        request.headers["x-internal-token"] !== options.internalApiToken
      )
        return sendError(reply, {
          code: "UNAUTHENTICATED",
          message: "Internal authentication is required.",
          requestId: request.id,
        });
      const endpoint = await loadEndpointById(request.params.endpointId);
      if (!endpoint)
        return reply.code(404).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Active endpoint not found.",
            requestId: request.id,
          },
        });
      const body = object(request.body);
      const simulatedCron = object(body.cronBinding);
      const simulatedNetworkPolicy = object(simulatedCron.networkPolicy);
      const savedDevelopmentSnapshot = object(body.savedDevelopmentSnapshot);
      const parsedSnapshot = deploymentSnapshotSchema.safeParse({
        ...endpoint.snapshot,
        functions: savedDevelopmentSnapshot.functions,
        functionCalls: savedDevelopmentSnapshot.calls,
        ...(typeof simulatedCron.id === "string"
          ? {
              networkPolicy: {
                allowedHosts: simulatedNetworkPolicy.allowedHosts,
                allowedMethods: simulatedNetworkPolicy.allowedMethods,
                allowedPorts: simulatedNetworkPolicy.allowedPorts,
                maxResponseBytes: simulatedNetworkPolicy.maxResponseBytes,
                allowPrivateHosts: simulatedNetworkPolicy.allowPrivateHosts,
                allowInsecureTlsHosts: simulatedNetworkPolicy.allowInsecureTlsHosts,
              },
            }
          : {}),
      });
      if (!parsedSnapshot.success)
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "The saved development Function snapshot is invalid.",
            requestId: request.id,
          },
        });
      const testEndpoint: LoadedEndpoint = {
        ...endpoint,
        snapshot: parsedSnapshot.data,
      };
      const fn = findFunction(testEndpoint, request.params.functionId);
      if (!fn?.enabled)
        return reply.code(404).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "Function has no saved development version.",
            requestId: request.id,
          },
        });
      const rawCaller = object(body.caller);
      const caller: CallerIdentity = {
        ...(typeof rawCaller.subject === "string"
          ? { subject: rawCaller.subject }
          : {}),
        ...(typeof rawCaller.email === "string" ? { email: rawCaller.email } : {}),
        permissions: stringArray(rawCaller.permissions),
        claims: object(rawCaller.claims ?? rawCaller),
      };
      try {
        authorizeEndpointAccess(
          caller,
          testEndpoint.snapshot.endpointAccessPolicy,
          request.id,
        );
      } catch (error) {
        await auditEndpointAccessDenial(testEndpoint, caller, request.id);
        return sendError(reply, asSafeRuntimeError(error, request.id));
      }
      const correlationId = correlation(request);
      const simulatedSource = normalizeTestSource(body.source);
      const result = await invoker.invoke({
        endpoint: testEndpoint,
        fn,
        source: "test",
        ...(simulatedSource ? { simulatedSource } : {}),
        input: body.input ?? {},
        caller,
        requestId: request.id,
        abortSignal: requestAbortSignal(request),
        ...(correlationId ? { correlationId } : {}),
        ...(typeof simulatedCron.id === "string"
          ? {
              rootTrigger: {
                type: "cron" as const,
                binding: {
                  id: simulatedCron.id,
                  name: String(simulatedCron.name),
                },
                scheduledAt: new Date().toISOString(),
                triggeredAt: new Date().toISOString(),
                expression: String(simulatedCron.expression),
                timezone: String(simulatedCron.timezone),
                origin: "manual" as const,
              },
            }
          : {}),
      });
      const metadata = {
        executionMode: "saved_development_version" as const,
        invocationSource: "test" as const,
        simulatedSource: simulatedSource ?? null,
        activeDeployment: {
          id: endpoint.deployment.id,
          version: endpoint.deployment.version,
          checksum: endpoint.deployment.checksum,
        },
        functionVersion: fn.version ?? null,
        functionVersionId: fn.versionId ?? null,
        executionId: result.executionId,
      };
      return result.ok
        ? {
            status: "success",
            output: result.output,
            durationMs: result.durationMs,
            requestId: request.id,
            logs: result.logs,
            ...metadata,
          }
        : {
            status: result.error.code === "TIMEOUT" ? "timeout" : "error",
            // This endpoint is reachable only through the authenticated control plane
            // and is the sole surface allowed to reveal sanitized connection diagnostics.
            error: result.error.toDiagnosticJSON(),
            durationMs: result.durationMs,
            requestId: request.id,
            logs: result.logs,
            ...metadata,
          };
    },
  );

  app.post<{ Params: { runId: string }; Body: unknown }>(
    "/internal/cron-runs/:runId/invoke",
    async (request, reply) => {
      if (
        options.internalApiToken &&
        request.headers["x-internal-token"] !== options.internalApiToken
      )
        return sendError(reply, {
          code: "UNAUTHENTICATED",
          message: "Internal authentication is required.",
          requestId: request.id,
        });
      const run = await prisma.scheduledRun.findUnique({
        where: { id: request.params.runId },
        include: {
          cronBinding: { select: { id: true } },
          scheduleDeployment: {
            include: {
              projectDeployment: {
                include: { environment: true, project: true },
              },
            },
          },
        },
      });
      if (!run || run.status !== "running")
        return reply.code(409).send({
          error: {
            code: "CRON_RUN_NOT_CLAIMED",
            message: "The scheduled run is not available for invocation.",
            requestId: request.id,
          },
        });
      const projectDeployment = run.scheduleDeployment.projectDeployment;
      if (
        projectDeployment.environment.activeProjectDeploymentId !== projectDeployment.id
      )
        return reply.code(409).send({
          error: {
            code: "STALE_SCHEDULE_DEPLOYMENT",
            message: "The schedule deployment is no longer active.",
            requestId: request.id,
          },
        });
      const snapshot = object(run.scheduleDeployment.snapshot);
      const slice = array(snapshot.slices)
        .map(object)
        .find((item) => object(item.environment).id === run.environmentId);
      const binding = array(slice?.bindings)
        .map(object)
        .find((item) => item.id === run.cronBindingId);
      if (!slice || !binding || binding.enabled !== true)
        return reply.code(409).send({
          error: {
            code: "CRON_BINDING_NOT_ACTIVE",
            message: "The cron binding is not present in the active snapshot.",
            requestId: request.id,
          },
        });
      const parsedSnapshot = deploymentSnapshotSchema.safeParse({
        functions: slice.functions,
        functionCalls: slice.functionCalls,
        mcpBindings: [],
        httpBindings: [],
        authPolicies: [],
        endpointAccessPolicy: {},
        networkPolicy: binding.networkPolicy,
        env: slice.env,
        libraries: slice.libraries,
        capabilities: slice.capabilities,
        reviewedQueries: slice.reviewedQueries,
        collections: slice.collections,
      });
      if (!parsedSnapshot.success)
        return reply.code(500).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "The active schedule artifact is invalid.",
            requestId: request.id,
          },
        });
      const environment = projectDeployment.environment;
      const settings = logSettings(environment);
      const pseudoEndpoint: LoadedEndpoint = {
        id: run.cronBindingId,
        name: String(binding.name ?? "Scheduled Function"),
        slug: run.cronBindingId,
        kind: "http",
        project: {
          id: projectDeployment.project.id,
          name: projectDeployment.project.name,
          slug: projectDeployment.project.slug,
        },
        environment: {
          id: environment.id,
          name: environment.name,
          slug: environment.slug,
          capturePayloads: environment.capturePayloads,
          ...settings,
        },
        deployment: {
          id: run.scheduleDeployment.id,
          version: projectDeployment.version,
          checksum: run.scheduleDeployment.checksum,
        },
        snapshot: parsedSnapshot.data,
      };
      const fn = pseudoEndpoint.snapshot.functions.find(
        (item) => item.functionId === binding.functionId,
      );
      if (!fn)
        return reply.code(500).send({
          error: {
            code: "CONFIGURATION_ERROR",
            message: "The scheduled Function is missing from the active artifact.",
            requestId: request.id,
          },
        });
      const triggeredAt = run.triggeredAt ?? new Date();
      const result = await invoker.invoke({
        endpoint: pseudoEndpoint,
        fn,
        source: "cron",
        input: {},
        caller: {
          subject: String(binding.serviceSubject),
          permissions: stringArray(binding.permissionGrants),
          claims: { service: true, cronBindingId: run.cronBindingId },
        },
        requestId: run.requestId,
        abortSignal: requestAbortSignal(request),
        cronBinding: {
          id: run.cronBindingId,
          name: String(binding.name),
          expression: String(binding.expression),
          timezone: String(binding.timezone),
          scheduledAt: run.scheduledAt.toISOString(),
          triggeredAt: triggeredAt.toISOString(),
          origin: run.origin,
          scheduleDeploymentId: run.scheduleDeploymentId,
        },
      });
      return reply.code(result.ok ? 200 : 422).send(
        result.ok
          ? {
              status: "success",
              output: result.output,
              durationMs: result.durationMs,
              executionId: result.executionId,
            }
          : {
              status: "failed",
              error: result.error.toJSON(),
              durationMs: result.durationMs,
              executionId: result.executionId,
            },
      );
    },
  );
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
