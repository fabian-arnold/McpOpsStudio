import type { FastifyInstance } from "fastify";
import type { FunctionExecutor } from "@mcpops/sandbox";
import { asSafeRuntimeError, type CallerIdentity } from "@mcpops/runtime-sdk";
import { authorizeEndpointAccess } from "./auth.js";
import { deploymentSnapshotSchema, type LoadedEndpoint } from "./domain.js";
import type { RuntimeInvoker } from "./invoke.js";
import type { RuntimeMetrics } from "./metrics.js";
import { loadEndpointById } from "./repository.js";
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
      const savedDevelopmentSnapshot = object(body.savedDevelopmentSnapshot);
      const parsedSnapshot = deploymentSnapshotSchema.safeParse({
        ...endpoint.snapshot,
        functions: savedDevelopmentSnapshot.functions,
        functionCalls: savedDevelopmentSnapshot.calls,
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
            error: result.error.toJSON(),
            durationMs: result.durationMs,
            requestId: request.id,
            logs: result.logs,
            ...metadata,
          };
    },
  );
}
