import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { Ajv } from "ajv";
import { z } from "zod";
import { prisma } from "@mcpops/db";
import { bundleFunction } from "@mcpops/sandbox";
import { functionCreateSchema, httpBindingSchema, mcpBindingSchema, projectLibrarySchema } from "@mcpops/shared";
import { checksum } from "./helpers.js";
import { hashToken, platformResource, type PlatformScope } from "./oauth.js";
import { controlPlaneState } from "./resources.js";
import { projectRepository, endpointIdentifierWhere, functionIdentifierWhere } from "./repository.js";
import { applyUnifiedPatch } from "./source-patch.js";
import { currentEndpointManifest } from "./api-view-helpers.js";
import { canonicalEnvironmentEndpointUrls } from "./analytics.js";
import { availableEndpointDocumentFormats, generateEndpointDocument, type EndpointDocumentFormat } from "./endpoint-discovery.js";
import { validateProjectLibrary } from "./control-plane-validation.js";
import { developmentDeploymentPlan, queueDevelopmentDeployment } from "./development-deployment.js";
import { executeDevelopmentFunctionTest } from "./function-test-service.js";

type McpIdentity = { grantId: string; userId: string; email: string; role: string; scopes: PlatformScope[] };
type McpSession = { userId: string; projectId?: string };
type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: unknown };

const editSchema = z.object({
  function: z.string().min(1), expectedVersion: z.number().int().positive(), expectedChecksum: z.string().length(64),
  patch: z.string().min(1).optional(), source: z.string().min(1).optional(),
  changes: functionCreateSchema.partial().omit({ code: true, secretGrantIds: true }).optional(),
  dryRun: z.boolean().default(true),
}).refine((value) => Boolean(value.patch) !== Boolean(value.source), "Provide exactly one of patch or source");

const tools = [
  tool("projects_list", "List active installation projects available for selection.", {}, true),
  tool("project_select", "Select the project used by this MCP session.", { project: stringField("Project ID or slug") }, false),
  tool("project_get", "Inspect the selected project and environments.", {}, true),
  tool("functions_list", "List Functions in the selected project.", { query: optionalString("Optional name, slug, or description filter") }, true),
  tool("function_get", "Read Function source, schemas, policy, version, and checksum.", { function: stringField("Function ID, slug, or name") }, true),
  tool("function_create", "Preview or create an immutable development Function version. Defaults to dry run.", {
    draft: objectField("Function draft matching the platform Function contract"), dryRun: booleanField("Preview without saving", true),
  }, false),
  tool("function_edit", "Apply a guarded unified diff or full source replacement plus optional metadata changes. Defaults to dry run.", {
    function: stringField("Function ID, slug, or name"), expectedVersion: numberField("Version returned by function_get"),
    expectedChecksum: stringField("SHA-256 returned by function_get"), patch: optionalString("Unified source diff"), source: optionalString("Complete replacement source"),
    changes: optionalObject("Partial metadata, schemas, and policy fields"), dryRun: booleanField("Preview without saving", true),
  }, false),
  tool("function_validate", "Compile and statically validate a saved Function without executing it.", { function: stringField("Function ID, slug, or name") }, true),
  tool("function_test", "Validate by default; set dryRun=false to execute the saved development Function through the isolated runtime.", {
    function: stringField("Function ID, slug, or name"), endpointId: optionalString("Development endpoint ID"), input: anyField("Invocation input"),
    source: enumField(["mcp", "http", "test"]), caller: optionalObject("Test caller subject, permissions, and claims"), dryRun: booleanField("Do not invoke user code", true),
  }, false),
  tool("libraries_list", "List latest project-local pure utility versions.", {}, true),
  tool("library_get", "Read a project library version and source.", { library: stringField("Library ID or import path") }, true),
  tool("library_create_version", "Preview or create a validated project library version using a patch or replacement source.", {
    library: optionalString("Existing library ID or import path"), draft: optionalObject("Required metadata for a new library"),
    patch: optionalString("Unified source diff"), source: optionalString("Complete replacement source"), dryRun: booleanField("Preview without saving", true),
  }, false),
  tool("endpoints_list", "List MCP and HTTP endpoints in the selected project.", {}, true),
  tool("endpoint_get", "Inspect endpoint settings and binding tables.", { endpoint: stringField("Endpoint ID or slug") }, true),
  tool("binding_create", "Preview or create an MCP tool or HTTP route binding.", { endpoint: stringField("Endpoint ID or slug"), binding: objectField("Typed MCP or HTTP binding"), dryRun: booleanField("Preview without saving", true) }, false),
  tool("binding_edit", "Preview or edit an existing binding without deleting it.", { endpoint: stringField("Endpoint ID or slug"), bindingId: stringField("Binding ID"), changes: objectField("Typed binding changes"), dryRun: booleanField("Preview without saving", true) }, false),
  tool("endpoint_discover", "Return final environment URLs, bindings, credential requirements, and optionally a generated client document.", { endpoint: stringField("Endpoint ID or slug"), format: optionalString("openapi-json, openapi-yaml, postman, mcp-client, manifest-json, or manifest-yaml") }, true),
  tool("deployment_status", "Inspect selected-project development deployment status.", {}, true),
  tool("development_deploy", "Preview or queue an atomic development Project deployment.", { dryRun: booleanField("Preview without queueing", true), expectedPlanChecksum: optionalString("Checksum returned by the preview") }, false),
];

export async function registerPlatformMcpRoutes(app: FastifyInstance): Promise<void> {
  app.route({ method: ["POST", "GET", "DELETE"], url: "/platform/mcp", handler: async (request, reply) => {
    const identity = await authenticateMcp(request, reply);
    if (!identity) return;
    if (!validOrigin(request)) return reply.status(403).send({ error: "Invalid Origin" });
    const sessionId = stringHeader(request, "mcp-session-id");
    if (request.method === "GET") return reply.status(405).header("allow", "POST, DELETE").send();
    if (request.method === "DELETE") {
      if (sessionId) await controlPlaneState.del(`mcp:session:${sessionId}`);
      return reply.status(204).send();
    }
    const rpc = request.body as Rpc;
    if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return reply.status(400).send(rpcError(null, -32600, "Invalid Request"));
    if (rpc.method === "initialize") {
      if (!InitializeRequestSchema.safeParse(rpc).success) return reply.status(400).send(rpcError(rpc.id ?? null, -32602, "Invalid initialize parameters"));
      const id = randomUUID();
      await saveSession(id, { userId: identity.userId });
      reply.header("mcp-session-id", id);
      const requested = object(rpc.params).protocolVersion;
      const protocolVersion = typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      return rpcResult(rpc, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "MCP Ops Studio Platform", version: "0.1.0", description: "Developer control-plane tools for MCP Ops Studio" } });
    }
    if (!sessionId) return reply.status(400).send(rpcError(rpc.id ?? null, -32000, "Missing MCP session ID"));
    const session = await loadSession(sessionId);
    if (!session || session.userId !== identity.userId) return reply.status(404).send(rpcError(rpc.id ?? null, -32001, "MCP session expired"));
    if (rpc.method === "notifications/initialized") return reply.status(202).send();
    if (rpc.method === "tools/list") {
      if (!ListToolsRequestSchema.safeParse(rpc).success) return reply.status(400).send(rpcError(rpc.id ?? null, -32602, "Invalid tools/list parameters"));
      return rpcResult(rpc, { tools });
    }
    if (rpc.method !== "tools/call") return rpcError(rpc.id ?? null, -32601, "Method not found");
    if (!CallToolRequestSchema.safeParse(rpc).success) return reply.status(400).send(rpcError(rpc.id ?? null, -32602, "Invalid tools/call parameters"));
    const params = object(rpc.params);
    const name = String(params.name ?? "");
    try {
      const value = await callTool(name, object(params.arguments), identity, sessionId, session);
      return rpcResult(rpc, toolResult(value));
    } catch (error) {
      const value = error as { code?: string; message?: string; statusCode?: number };
      return rpcResult(rpc, { isError: true, content: [{ type: "text", text: value.message ?? "Tool execution failed" }], structuredContent: { ok: false, error: { code: value.code ?? "TOOL_ERROR", message: value.message ?? "Tool execution failed" } } });
    }
  }});
}

async function authenticateMcp(request: FastifyRequest, reply: FastifyReply): Promise<McpIdentity | undefined> {
  const authorization = stringHeader(request, "authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    reply.header("www-authenticate", `Bearer resource_metadata="${platformResource().replace("/platform/mcp", "/.well-known/oauth-protected-resource/platform/mcp")}", scope="mcpops:read"`);
    reply.status(401).send({ error: "invalid_token" }); return;
  }
  const grant = await prisma.oAuthGrant.findUnique({ where: { accessTokenHash: hashToken(token) }, include: { user: true } });
  if (!grant || grant.revokedAt || grant.accessExpiresAt <= new Date() || grant.resource !== platformResource() || !grant.user.active) {
    reply.status(401).send({ error: "invalid_token" }); return;
  }
  return { grantId: grant.id, userId: grant.userId, email: grant.user.email, role: grant.user.role, scopes: grant.scopes as PlatformScope[] };
}

async function callTool(name: string, args: Record<string, unknown>, identity: McpIdentity, sessionId: string, session: McpSession): Promise<Record<string, unknown>> {
  requireScope(identity, "mcpops:read");
  if (name === "projects_list") {
    const projects = await prisma.project.findMany({ where: { status: "active" }, select: { id: true, name: true, slug: true, description: true, updatedAt: true }, orderBy: { name: "asc" } });
    return output("Active projects", { projects, selectedProjectId: session.projectId }, [{ tool: "project_select", reason: "Select a project before using project-scoped tools." }]);
  }
  if (name === "project_select") {
    const identifier = z.string().min(1).parse(args.project);
    const project = await prisma.project.findFirst({ where: { status: "active", OR: [{ id: identifier }, { slug: identifier }] }, select: { id: true, name: true, slug: true } });
    if (!project) throw toolError("NOT_FOUND", "Active project not found");
    await saveSession(sessionId, { userId: identity.userId, projectId: project.id });
    return output(`Selected ${project.name}`, { project }, [{ tool: "functions_list", reason: "Browse Functions in the selected project." }]);
  }
  const projectId = session.projectId;
  if (!projectId) throw toolError("PROJECT_NOT_SELECTED", "Call project_select before using this tool.");
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.status !== "active") throw toolError("PROJECT_NOT_FOUND", "The selected project is no longer active; select another project.");

  if (name === "project_get") {
    const environments = await prisma.environment.findMany({ where: { projectId }, select: { id: true, name: true, slug: true, baseUrl: true, activeProjectDeploymentId: true }, orderBy: { name: "asc" } });
    return output(project.name, { project, environments });
  }
  if (name === "functions_list") {
    const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
    const functions = (await projectRepository(projectId).functions()).filter((fn) => !query || `${fn.name} ${fn.slug} ${fn.description}`.toLowerCase().includes(query)).map((fn) => safeFunction(fn));
    return output(`${functions.length} Function(s)`, { functions }, [{ tool: "function_get", reason: "Read source and checksum before editing." }]);
  }
  if (name === "function_get") {
    const fn = await findFunction(projectId, z.string().parse(args.function));
    const latest = fn.versions[0];
    return output(`${fn.name} v${fn.version}`, { function: { ...safeFunction(fn, true), checksum: latest?.checksum ?? checksum(fn.code) } }, [{ tool: "function_edit", reason: "Use expectedVersion and expectedChecksum for a guarded edit." }]);
  }
  if (name === "function_validate") {
    const fn = await findFunction(projectId, z.string().parse(args.function));
    const validation = await validateFunction(projectId, { ...functionDraft(fn), secretGrantIds: [] });
    return output(validation.valid ? "Validation passed" : "Validation failed", validation);
  }
  if (name === "function_create") return createFunction(projectId, identity, args);
  if (name === "function_edit") return editFunction(projectId, identity, args);
  if (name === "function_test") return testFunction(projectId, identity, args);
  if (name === "libraries_list") {
    const rows = await prisma.projectLibrary.findMany({ where: { projectId }, orderBy: [{ importPath: "asc" }, { version: "desc" }] });
    const latest = [...new Map(rows.map((row) => [row.importPath, row])).values()];
    return output(`${latest.length} project library/libraries`, { libraries: latest });
  }
  if (name === "library_get") {
    const library = await findLibrary(projectId, z.string().parse(args.library));
    return output(`${library.name} v${library.version}`, { library, checksum: checksum(library.code) });
  }
  if (name === "library_create_version") return editLibrary(projectId, identity, args);
  if (name === "endpoints_list") {
    const endpoints = await projectRepository(projectId).endpoints();
    return output(`${endpoints.length} endpoint(s)`, { endpoints: endpoints.map(endpointSummary) });
  }
  if (name === "endpoint_get") {
    const endpoint = await findEndpoint(projectId, z.string().parse(args.endpoint));
    return output(endpoint.name, { endpoint: endpointSummary(endpoint), mcpBindings: endpoint.mcpToolBindings, httpBindings: endpoint.httpRouteBindings });
  }
  if (name === "binding_create") return createBinding(projectId, identity, args);
  if (name === "binding_edit") return editBinding(projectId, identity, args);
  if (name === "endpoint_discover") return discoverEndpoint(projectId, args);
  if (name === "deployment_status") return deploymentStatus(projectId);
  if (name === "development_deploy") return developmentDeploy(projectId, identity, args);
  throw toolError("UNKNOWN_TOOL", `Unknown tool: ${name}`);
}

function tool(name: string, description: string, properties: Record<string, unknown>, readOnly: boolean) {
  const required = requiredToolFields[name] ?? [];
  return { name, title: name.split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "), description, inputSchema: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly } };
}
const requiredToolFields: Record<string, string[]> = {
  project_select: ["project"], function_get: ["function"], function_create: ["draft"],
  function_edit: ["function", "expectedVersion", "expectedChecksum"], function_validate: ["function"],
  function_test: ["function", "input"], library_get: ["library"], endpoint_get: ["endpoint"],
  binding_create: ["endpoint", "binding"], binding_edit: ["endpoint", "bindingId", "changes"],
  endpoint_discover: ["endpoint"],
};
function stringField(description: string) { return { type: "string", description }; }
function optionalString(description: string) { return stringField(description); }
function booleanField(description: string, defaultValue: boolean) { return { type: "boolean", description, default: defaultValue }; }
function numberField(description: string) { return { type: "integer", description, minimum: 1 }; }
function objectField(description: string) { return { type: "object", description, additionalProperties: true }; }
function optionalObject(description: string) { return objectField(description); }
function enumField(values: string[]) { return { type: "string", enum: values }; }
function anyField(description: string) { return { description }; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringHeader(request: FastifyRequest, name: string) { const value = request.headers[name]; return Array.isArray(value) ? value[0] : value; }
function validOrigin(request: FastifyRequest) { const origin = stringHeader(request, "origin"); return !origin || origin === new URL(platformResource()).origin; }
function rpcResult(rpc: Rpc, result: unknown) { return { jsonrpc: "2.0", id: rpc.id ?? null, result }; }
function rpcError(id: Rpc["id"], code: number, message: string) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }
function toolResult(value: Record<string, unknown>) { return { content: [{ type: "text", text: String(value.summary ?? "Completed") }], structuredContent: value }; }
function output(summary: string, data: unknown, nextActions: unknown[] = []) { return { ok: true, summary, data, warnings: [], diagnostics: [], nextActions }; }
function toolError(code: string, message: string, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
function requireScope(identity: McpIdentity, scope: PlatformScope) { if (!identity.scopes.includes(scope)) throw toolError("INSUFFICIENT_SCOPE", `OAuth scope ${scope} is required`, 403); }
function requireRole(identity: McpIdentity, roles: string[]) { if (!roles.includes(identity.role)) throw toolError("FORBIDDEN", "The platform role does not allow this operation", 403); }
async function loadSession(id: string): Promise<McpSession | null> { const raw = await controlPlaneState.get(`mcp:session:${id}`); return raw ? JSON.parse(raw) as McpSession : null; }
async function saveSession(id: string, session: McpSession) { await controlPlaneState.set(`mcp:session:${id}`, JSON.stringify(session), "EX", 8 * 60 * 60); }

async function findFunction(projectId: string, identifier: string) {
  const fn = await projectRepository(projectId).projectFunction(identifier);
  if (!fn) throw toolError("NOT_FOUND", "Function not found", 404);
  return fn;
}
async function findEndpoint(projectId: string, identifier: string) {
  const endpoint = await projectRepository(projectId).endpoint(identifier);
  if (!endpoint) throw toolError("NOT_FOUND", "Runtime endpoint not found", 404);
  return endpoint;
}
async function findLibrary(projectId: string, identifier: string) {
  const library = await prisma.projectLibrary.findFirst({ where: { projectId, OR: [{ id: identifier }, { importPath: identifier }] }, orderBy: { version: "desc" } });
  if (!library) throw toolError("NOT_FOUND", "Project library not found", 404);
  return library;
}
function functionDraft(fn: any) { return { name: fn.name, slug: fn.slug, description: fn.description, code: fn.code, inputSchema: fn.inputSchema, outputSchema: fn.outputSchema, timeoutMs: fn.timeoutMs, enabled: fn.enabled, riskLevel: fn.riskLevel, requiredPermissions: fn.requiredPermissions, cachePolicy: fn.cachePolicy }; }
function safeFunction(fn: any, includeCode = false) {
  return {
    id: fn.id, name: fn.name, slug: fn.slug, description: fn.description,
    version: fn.version, enabled: fn.enabled, riskLevel: fn.riskLevel,
    requiredPermissions: fn.requiredPermissions, timeoutMs: fn.timeoutMs,
    inputSchema: fn.inputSchema, outputSchema: fn.outputSchema, cachePolicy: fn.cachePolicy,
    ...(includeCode ? { code: fn.code } : {}), updatedAt: fn.updatedAt,
  };
}

async function validateFunction(projectId: string, draftValue: unknown) {
  try {
    const draft = functionCreateSchema.parse(draftValue);
    const ajv = new Ajv({ allErrors: true, strict: false }); ajv.compile(draft.inputSchema); ajv.compile(draft.outputSchema);
    const libraries = await latestLibraries(projectId);
    const built = await bundleFunction({ code: draft.code, projectLibraries: libraries.map((library) => ({ importPath: library.importPath, code: library.code, version: library.version })) });
    return { valid: true, diagnostics: [], checksum: built.checksum, imports: built.imports };
  } catch (error) { return { valid: false, diagnostics: [{ message: error instanceof Error ? error.message : "Validation failed" }] }; }
}
async function latestLibraries(projectId: string) { const rows = await prisma.projectLibrary.findMany({ where: { projectId }, orderBy: { version: "desc" } }); return [...new Map(rows.map((row) => [row.importPath, row])).values()]; }

async function createFunction(projectId: string, identity: McpIdentity, args: Record<string, unknown>) {
  requireScope(identity, "mcpops:write"); requireRole(identity, ["owner", "admin", "developer"]);
  const dryRun = args.dryRun !== false; const draft = functionCreateSchema.parse(args.draft); const validation = await validateFunction(projectId, draft);
  if (draft.secretGrantIds.length) throw toolError("SECRETS_OUT_OF_SCOPE", "Platform MCP cannot assign Secret grants in this release");
  if (!validation.valid) return { ...output("Function validation failed", { validation }), dryRun };
  if (dryRun) return { ...output("Function creation preview", { draft: { ...draft, code: undefined }, validation }, [{ tool: "function_create", arguments: { dryRun: false }, reason: "Apply this validated Function draft." }]), dryRun: true };
  const fn = await prisma.$transaction(async (tx) => {
    const created = await tx.function.create({ data: { projectId, ...draft, secretGrantIds: undefined, version: 1 } as never });
    await tx.functionVersion.create({ data: { functionId: created.id, version: 1, code: draft.code, checksum: checksum(draft.code), validationResult: validation as never, createdByUserId: identity.userId } });
    await tx.auditEvent.create({ data: { projectId, functionId: created.id, actorType: "user", actorId: identity.userId, action: "function.created", targetType: "function", targetId: created.id, metadata: { source: "platform_mcp", version: 1 } } });
    return created;
  });
  return { ...output(`Created ${fn.name} v1`, { function: fn, checksum: checksum(draft.code) }), dryRun: false };
}

async function editFunction(projectId: string, identity: McpIdentity, args: Record<string, unknown>) {
  requireScope(identity, "mcpops:write"); requireRole(identity, ["owner", "admin", "developer"]);
  const input = editSchema.parse(args); const fn = await findFunction(projectId, input.function); const latest = fn.versions[0];
  const currentChecksum = latest?.checksum ?? checksum(fn.code);
  if (fn.version !== input.expectedVersion || currentChecksum !== input.expectedChecksum) throw toolError("EDIT_CONFLICT", `Function changed; current version is ${fn.version} with checksum ${currentChecksum}`, 409);
  const code = input.source ?? applyUnifiedPatch(fn.code, input.patch!);
  const draft = functionCreateSchema.parse({ ...functionDraft(fn), ...input.changes, code, secretGrantIds: [] });
  const validation = await validateFunction(projectId, draft);
  if (!validation.valid) return { ...output("Function edit validation failed", { validation }), dryRun: input.dryRun };
  const nextVersion = fn.version + (code === fn.code ? 0 : 1);
  const diff = { fromVersion: fn.version, toVersion: nextVersion, fromChecksum: currentChecksum, toChecksum: checksum(code), changedFields: [...Object.keys(input.changes ?? {}), ...(code === fn.code ? [] : ["code"])] };
  if (input.dryRun) return { ...output("Function edit preview", { diff, validation }, [{ tool: "function_edit", reason: "Repeat with dryRun=false and the same version/checksum to apply." }]), dryRun: true, diff };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.function.updateMany({ where: { id: fn.id, projectId, version: input.expectedVersion }, data: { ...input.changes, code, version: nextVersion } as never });
    if (!updated.count) throw toolError("EDIT_CONFLICT", "Function changed while applying the edit", 409);
    if (code !== fn.code) await tx.functionVersion.create({ data: { functionId: fn.id, version: nextVersion, code, checksum: checksum(code), validationResult: validation as never, createdByUserId: identity.userId } });
    await tx.auditEvent.create({ data: { projectId, functionId: fn.id, actorType: "user", actorId: identity.userId, action: "function.updated", targetType: "function", targetId: fn.id, metadata: { source: "platform_mcp", ...diff } } });
  });
  return { ...output(`Saved ${fn.name} v${nextVersion}`, { diff, validation }), dryRun: false, diff };
}

async function testFunction(projectId: string, identity: McpIdentity, args: Record<string, unknown>) {
  requireRole(identity, ["owner", "admin", "developer", "operator"]);
  const fn = await findFunction(projectId, z.string().parse(args.function));
  const validation = await validateFunction(projectId, { ...functionDraft(fn), secretGrantIds: [] });
  const dryRun = args.dryRun !== false;
  if (dryRun || !validation.valid) return { ...output(dryRun ? "Function test preview; user code was not executed" : "Function validation failed", { validation, wouldInvoke: { functionId: fn.id, endpointId: args.endpointId, source: args.source ?? "test" } }, dryRun ? [{ tool: "function_test", reason: "Set dryRun=false only when real side effects are acceptable." }] : []), dryRun };
  requireScope(identity, "mcpops:write");
  const result = await executeDevelopmentFunctionTest(
    { userId: identity.userId, projectId, role: identity.role, email: identity.email, sessionVersion: 0, expiresAt: Date.now() + 60_000 },
    fn.id,
    { endpointId: args.endpointId, input: args.input, source: args.source ?? "test", caller: args.caller },
  );
  if (result.status >= 400) throw toolError("TEST_FAILED", `Runtime test failed with HTTP ${result.status}`);
  return { ...output("Function test completed", result.body), dryRun: false };
}

async function editLibrary(projectId: string, identity: McpIdentity, args: Record<string, unknown>) {
  requireScope(identity, "mcpops:write"); requireRole(identity, ["owner", "admin", "developer"]);
  const dryRun = args.dryRun !== false; const existing = typeof args.library === "string" ? await findLibrary(projectId, args.library) : null;
  const source = typeof args.source === "string" ? args.source : typeof args.patch === "string" && existing ? applyUnifiedPatch(existing.code, args.patch) : existing?.code;
  const draft = projectLibrarySchema.parse({ ...(existing ? { name: existing.name, importPath: existing.importPath, description: existing.description, exportedFunctions: existing.exportedFunctions } : object(args.draft)), code: source });
  await validateProjectLibrary(draft.importPath, draft.code);
  const nextVersion = (existing?.version ?? 0) + 1; const diff = { importPath: draft.importPath, fromVersion: existing?.version ?? null, toVersion: nextVersion, checksum: checksum(draft.code) };
  if (dryRun) return { ...output("Library version preview", { diff }, [{ tool: "library_create_version", reason: "Repeat with dryRun=false to create the validated version." }]), dryRun: true, diff };
  const created = await prisma.projectLibrary.create({ data: { projectId, ...draft, description: draft.description ?? "", exportedFunctions: draft.exportedFunctions ?? [], version: nextVersion } });
  await prisma.auditEvent.create({ data: { projectId, actorType: "user", actorId: identity.userId, action: "project_library.version_created", targetType: "project_library", targetId: created.id, metadata: { source: "platform_mcp", ...diff } } });
  return { ...output(`Created ${created.importPath} v${created.version}`, { library: created }), dryRun: false, diff };
}

function endpointSummary(endpoint: any) { return { id: endpoint.id, name: endpoint.name, slug: endpoint.slug, kind: endpoint.kind, status: endpoint.status, environment: endpoint.environment, activeDeploymentId: endpoint.activeDeploymentId, updatedAt: endpoint.updatedAt }; }

async function createBinding(projectId: string, identity: McpIdentity, args: Record<string, unknown>) {
  requireScope(identity, "mcpops:write"); requireRole(identity, ["owner", "admin", "developer"]);
  const endpoint = await findEndpoint(projectId, z.string().parse(args.endpoint)); const rawBinding = object(args.binding); const dryRun = args.dryRun !== false;
  const binding = endpoint.kind === "mcp" ? mcpBindingSchema.parse(rawBinding) : httpBindingSchema.parse(rawBinding);
  const functionId = binding.functionId; const fn = await prisma.function.findFirst({ where: { id: functionId, projectId } });
  if (!fn) throw toolError("INVALID_BINDING_FUNCTION", "Binding Function does not belong to the selected project");
  const isMcp = endpoint.kind === "mcp";
  const conflict = isMcp ? await prisma.mcpToolBinding.findFirst({ where: { endpointId: endpoint.id, toolName: String("toolName" in binding ? binding.toolName : "") } }) : await prisma.httpRouteBinding.findFirst({ where: { endpointId: endpoint.id, method: ("method" in binding ? binding.method : "GET") as never, path: String("path" in binding ? binding.path : "") } });
  if (conflict) throw toolError("BINDING_CONFLICT", "An equivalent binding already exists", 409);
  if (dryRun) return { ...output("Binding creation preview", { endpoint: endpointSummary(endpoint), binding }), dryRun: true };
  const created = isMcp ? await prisma.mcpToolBinding.create({ data: { endpointId: endpoint.id, ...(binding as z.infer<typeof mcpBindingSchema>) } }) : await prisma.httpRouteBinding.create({ data: { endpointId: endpoint.id, ...(binding as z.infer<typeof httpBindingSchema>) } as never });
  await prisma.auditEvent.create({ data: { projectId, endpointId: endpoint.id, functionId, actorType: "user", actorId: identity.userId, action: isMcp ? "mcp_binding.created" : "http_binding.created", targetType: isMcp ? "mcp_tool_binding" : "http_route_binding", targetId: created.id, metadata: { source: "platform_mcp" } } });
  return { ...output("Binding created", { binding: created }), dryRun: false };
}

async function editBinding(projectId: string, identity: McpIdentity, args: Record<string, unknown>) {
  requireScope(identity, "mcpops:write"); requireRole(identity, ["owner", "admin", "developer"]);
  const endpoint = await findEndpoint(projectId, z.string().parse(args.endpoint)); const bindingId = z.string().uuid().parse(args.bindingId); const changes = object(args.changes); const dryRun = args.dryRun !== false;
  const existing = endpoint.kind === "mcp" ? await prisma.mcpToolBinding.findFirst({ where: { id: bindingId, endpoint: { projectId, id: endpoint.id } } }) : await prisma.httpRouteBinding.findFirst({ where: { id: bindingId, endpoint: { projectId, id: endpoint.id } } });
  if (!existing) throw toolError("NOT_FOUND", "Binding not found", 404);
  const candidate = endpoint.kind === "mcp" ? mcpBindingSchema.parse({ ...existing, ...changes }) : httpBindingSchema.parse({ ...existing, ...changes });
  const ownedFunction = await prisma.function.findFirst({ where: { id: candidate.functionId, projectId }, select: { id: true } });
  if (!ownedFunction) throw toolError("INVALID_BINDING_FUNCTION", "Binding Function does not belong to the selected project");
  const conflict = endpoint.kind === "mcp"
    ? await prisma.mcpToolBinding.findFirst({ where: { endpointId: endpoint.id, toolName: (candidate as z.infer<typeof mcpBindingSchema>).toolName, id: { not: bindingId } } })
    : await prisma.httpRouteBinding.findFirst({ where: { endpointId: endpoint.id, method: (candidate as z.infer<typeof httpBindingSchema>).method, path: (candidate as z.infer<typeof httpBindingSchema>).path, id: { not: bindingId } } });
  if (conflict) throw toolError("BINDING_CONFLICT", "An equivalent binding already exists", 409);
  if (dryRun) return { ...output("Binding edit preview", { before: existing, after: candidate }), dryRun: true };
  const updated = endpoint.kind === "mcp" ? await prisma.mcpToolBinding.update({ where: { id: bindingId }, data: candidate as never }) : await prisma.httpRouteBinding.update({ where: { id: bindingId }, data: candidate as never });
  await prisma.auditEvent.create({ data: { projectId, endpointId: endpoint.id, actorType: "user", actorId: identity.userId, action: endpoint.kind === "mcp" ? "mcp_binding.updated" : "http_binding.updated", targetType: endpoint.kind === "mcp" ? "mcp_tool_binding" : "http_route_binding", targetId: bindingId, metadata: { source: "platform_mcp", fields: Object.keys(changes) } } });
  return { ...output("Binding updated", { binding: updated }), dryRun: false };
}

async function discoverEndpoint(projectId: string, args: Record<string, unknown>) {
  const endpoint = await findEndpoint(projectId, z.string().parse(args.endpoint)); const urls = canonicalEnvironmentEndpointUrls(endpoint.project.environments, endpoint.project.slug, endpoint.slug);
  const auth = endpoint.defaultAuthPolicy ? { type: endpoint.defaultAuthPolicy.type, config: endpoint.defaultAuthPolicy.config } : null;
  const credential = credentialRequirement(auth); const formats = availableEndpointDocumentFormats(endpoint.kind); let document;
  if (args.format) {
    if (!formats.includes(args.format as EndpointDocumentFormat)) throw toolError("UNSUPPORTED_FORMAT", `Format ${args.format} is not available for this endpoint`);
    document = generateEndpointDocument(args.format as EndpointDocumentFormat, { manifest: currentEndpointManifest(endpoint), environments: endpoint.project.environments.map((environment) => ({ name: environment.name, slug: environment.slug, mcpUrl: urls[environment.slug]!.mcpUrl, httpBaseUrl: urls[environment.slug]!.httpBaseUrl })), functions: endpoint.functions.map((fn) => ({ name: fn.name, inputSchema: fn.inputSchema, outputSchema: fn.outputSchema })), auth });
  }
  return output("Endpoint discovery", { endpoint: endpointSummary(endpoint), environments: urls, credential, mcpTools: endpoint.mcpToolBindings, httpRoutes: endpoint.httpRouteBindings, formats, ...(document ? { document } : {}), containsSecretValues: false });
}
function credentialRequirement(auth: { type: string; config: unknown } | null) { if (!auth || auth.type === "public") return { type: "none", required: false }; const config = object(auth.config); if (auth.type === "api_key") return { type: "api_key", required: true, in: "header", header: typeof config.header === "string" ? config.header : "x-api-key" }; if (auth.type === "basic_auth") return { type: "basic", required: true, scheme: "Basic" }; if (auth.type === "webhook_signature") return { type: "webhook_hmac", required: true, in: "header", header: typeof config.header === "string" ? config.header : "x-signature" }; return { type: auth.type, required: true, scheme: "Bearer" }; }

async function deploymentStatus(projectId: string) {
  const environment = await prisma.environment.findFirst({ where: { projectId, slug: "development" }, include: { activeProjectDeployment: true } });
  const inProgress = environment ? await prisma.projectDeployment.findFirst({ where: { projectId, environmentId: environment.id, status: { in: ["queued", "building", "deploying"] } }, orderBy: { createdAt: "desc" } }) : null;
  return output("Development deployment status", { environment: environment ? { id: environment.id, activeProjectDeploymentId: environment.activeProjectDeploymentId } : null, activeDeployment: environment?.activeProjectDeployment ?? null, inProgressDeployment: inProgress });
}
async function developmentDeploy(projectId: string, identity: McpIdentity, args: Record<string, unknown>) {
  requireScope(identity, "mcpops:deploy"); requireRole(identity, ["owner", "admin", "developer", "operator"]);
  const plan = await developmentDeploymentPlan(projectId);
  const dryRun = args.dryRun !== false;
  if (dryRun) return { ...output("Development deployment preview", plan, [{ tool: "development_deploy", arguments: { dryRun: false, expectedPlanChecksum: plan.planChecksum }, reason: "Queue this exact project plan." }]), dryRun: true };
  if (args.expectedPlanChecksum !== plan.planChecksum) throw toolError("DEPLOYMENT_PLAN_CHANGED", "Project state changed after preview; run a new dry run", 409);
  const deployment = await queueDevelopmentDeployment({ userId: identity.userId, projectId, role: identity.role, email: identity.email, sessionVersion: 0, expiresAt: Date.now() + 60_000 });
  return { ...output(`Development v${deployment.version} queued`, { deployment, planChecksum: plan.planChecksum }), dryRun: false };
}
