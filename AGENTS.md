# MCP Ops Studio Development Guide

This file applies to the entire repository. More specific `AGENTS.md` files may refine these instructions for a subdirectory.

## Product invariants

MCP Ops Studio is a self-hosted, code-first operations function platform. The primary executable entity is a `Function`. MCP tools and HTTP routes are bindings that expose a function; they are not separate executable implementations.

The control plane is one self-hosted installation. Projects own reusable functions, environments and operational resources; users and roles are installation-wide. Do not introduce tenant account layers, project memberships, or per-project ACLs.

Do not add a workflow or exposure canvas. MCP Endpoints use a tool-binding table
and HTTP APIs use a route-binding table. Function composition stays in
TypeScript through the controlled `ctx.functions.call()` capability.

All invocations must converge on the shared handler contract:

```ts
export default async function handler(ctx, input) {
  return { ok: true };
}
```

The runtime must execute only immutable active deployment snapshots. Draft code must never be served by MCP or HTTP runtime routes.

User-authored code must never execute inside `apps/api` or `apps/web`. Compilation and static validation are allowed there, but execution must go through `FunctionExecutor`. The default local executor is trusted-developer child-process isolation; the optional disposable-container provider is the stronger production path.

## Repository map

```text
apps/web                 Next.js control-plane UI and Monaco editor
apps/api                 Fastify control-plane API, sessions, CSRF and RBAC
apps/runtime             private MCP/HTTP runtime and invocation pipeline
apps/worker              BullMQ deployment validation and snapshot builder
packages/shared          Zod contracts, manifests, templates and shared security
packages/db              Prisma client, project scopes and durable storage
packages/runtime-sdk     RuntimeContext, safe errors, authorization and redaction
packages/platform-modules reviewed virtual module source
packages/sandbox         restricted esbuild and child-process executor
prisma                   schema, migrations and development seed
infra                    two-role Docker Compose, Caddy and mock CRM
scripts/e2e.mjs          Compose-backed vertical-slice integration test
```

## Development commands

Use pnpm workspaces through Corepack:

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm build
pnpm test
```

If pnpm is not installed as a global shim, prefix commands with `corepack`, for example:

```bash
corepack pnpm -r build
corepack pnpm -r --if-present test
```

Run the local stack with:

```bash
cp .env.example .env
pnpm dev
```

This starts the Compose development override with application source synchronization and watch processes. Use `pnpm dev:down` to stop it without deleting development data. Use `pnpm dev:local` when PostgreSQL and Redis are managed separately and the applications should run directly on the host.

Run the vertical-slice test after the stack is healthy:

```bash
pnpm test:e2e
```

Useful focused commands:

```bash
pnpm --filter @mcpops/web build
pnpm --filter @mcpops/api typecheck
pnpm --filter @mcpops/runtime test
pnpm --filter @mcpops/sandbox test
pnpm --filter @mcpops/db generate
```

Before handing off changes, run the relevant focused tests, a full recursive build, `docker compose -f infra/docker-compose.yml config --quiet`, and `git diff --check`.

Use the repository's [commit style guide](docs/commit-style.md) when preparing commits or pull-request titles.

## Database and tenancy

The Prisma schema is at `prisma/schema.prisma`. Commit schema changes with a migration under `prisma/migrations`; do not rely on `db push` for repository changes.

Operational queries must use the selected `projectId` from the authenticated session. Project CRUD and project selection are installation-wide owner/admin operations. Prefer helpers in `packages/db/src/scoped.ts` or `apps/api/src/repository.ts` over direct unscoped operational lookups.

Functions belong to Projects and are reusable across any number of MCP Endpoints
and HTTP APIs. Endpoint slugs are unique by Project and endpoint kind; Function
slugs are unique within a Project. Bindings select a project Function for one
typed endpoint and contain no executable code. Runtime routing resolves the
Project, endpoint kind and endpoint slug.

Audit events are immutable. Do not add update or delete flows for audit records.

Function source saves create immutable development `FunctionVersion` records.
A Project development deployment pins concrete versions for every endpoint's
bound Functions and transitively called Functions. Production release promotes
only a completed immutable development Project snapshot. Editing a shared
Function must not alter development or production runtime traffic until the
Project is deployed. Snapshots include no mutable draft references.

The development seed is idempotent and must continue to provide:

- Acme project
- `admin@acme.test` / `ChangeMe123!`
- Development and Production environments
- Customer Operations MCP Endpoint and Customer Operations HTTP API
- Development API key `dev-acme-mcp-key`
- Production API key `prod-acme-mcp-key`
- Four demo functions and bindings
- At least two rollback-capable deployments

These values are development-only.

## Security constraints

Do not weaken the following restrictions:

- No arbitrary npm installation or package manifests for user functions.
- No filesystem, process, shell, child-process, raw environment, dynamic import or `require` access from user code.
- No relative imports or unrestricted module resolution.
- No raw SQL exposed to functions.
- No unrestricted outbound network access.
- No plaintext or encrypted secret values returned from normal APIs.
- No secret values in snapshots, logs, errors, audits or execution payload displays.

Allowed imports are reviewed `@mcpops/shared/*` modules and versioned project-local pure utilities under `@mcpops/lib/*`. Update both `packages/platform-modules` and the restricted bundler when adding a reviewed virtual module.

Secrets use AES-256-GCM. `MCP_OPS_MASTER_KEY` must encode exactly 32 bytes as 64 hexadecimal characters or base64. Keep encryption formats interoperable between `packages/db`, `packages/shared` and `packages/sandbox`.

Outbound HTTP changes must preserve DNS resolution checks, private/loopback/link-local/metadata blocking, host/method/port allowlists, redirect revalidation, timeouts, response byte limits and sanitized upstream errors.

Runtime errors exposed to callers must use safe codes from `SafeRuntimeError` and must not expose stack traces or upstream response bodies.

Platform mutations require session authentication, project scoping, role authorization and CSRF validation. The UI reads the `mcpops_csrf` cookie and sends it as `x-csrf-token`.

## Deployment pipeline

The deployment sequence is:

1. API creates one queued development `ProjectDeployment` and endpoint build jobs.
2. Workers validate JSON Schemas and policy references.
3. Restricted esbuild resolves reviewed virtual imports.
4. Workers store compiled endpoint artifacts and deterministic checksums.
5. One transaction activates all endpoint artifacts only after every build succeeds.
6. Production release copies only a completed development Project snapshot and applies production environment configuration.
7. Runtime selects the active Project deployment from the request host's environment.

Failed endpoint builds must not partially replace the active Project snapshot.
Rollback restores all endpoint artifacts for an earlier completed Project
deployment and records an audit event.

Snapshot functions consumed by the runtime require, at minimum:

```text
functionId, name, enabled, riskLevel, requiredPermissions,
secretGrants, timeoutMs, inputSchema, optional outputSchema, compiledCode
```

Compiled artifacts must be ESM because the child executor loads `.mjs` modules.

Internal Function calls must use a literal project Function slug. Deployment
resolves the transitive call graph, rejects cycles, and pins every referenced
version. Runtime execution propagates caller, tenant, correlation, cancellation
and remaining timeout context, validates child input/output, and enforces a
maximum call depth of eight.

## Hosting roles

The Compose/Kubernetes application boundary has two deployable roles:

- `control-plane` packages Caddy, Next.js and Fastify. It owns public ports and
  proxies `/mcp` and `/http` to the private worker pool. It must never execute
  user-authored code.
- `worker` packages the private runtime listener and BullMQ deployment worker.
  Identical replicas handle runtime and build work with separate concurrency
  limits and may be horizontally scaled.

PostgreSQL and Redis remain supporting infrastructure. Worker ports are not
published. Preserve internal authentication, forwarded request/correlation
headers, readiness checks and request timeout margins when changing proxying.

## Runtime behavior

MCP is stateless Streamable HTTP at:

```text
POST /mcp/{projectSlug}/{endpointSlug}
```

Keep MCP protocol request validation based on the official `@modelcontextprotocol/sdk` schemas. Version 1 supports only initialization and tools; do not advertise prompts or resources.

HTTP bindings are exposed at:

```text
/http/{projectSlug}/{endpointSlug}/{bindingPath}
```

Both MCP and HTTP must perform authentication, endpoint resolution, function permission checks, AJV input validation, executor invocation, optional output validation, execution persistence and auditing through the same invocation pipeline.

Runtime authorization has three conceptual layers:

1. Endpoint authentication
2. Endpoint access
3. Function permission authorization

Persist denied, timed-out, validation-error and successful executions with request ID, source, deployment ID and duration. Redact stored caller, input, output and error values.

Internal runtime diagnostics are not exposed through Caddy. Protect every
control-plane-to-worker MCP/HTTP invocation request with `INTERNAL_API_TOKEN`;
workers must reject missing or invalid internal credentials. Liveness,
readiness and metrics may remain unauthenticated on the private worker network.

## Control-plane API conventions

Public API inputs must be validated with Zod. Return errors in this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Safe user-facing message",
    "requestId": "..."
  }
}
```

Do not return Prisma models containing `encryptedValue`. Normalize API responses to the contracts expected by `apps/web/lib/types.ts`; successful but structurally incompatible responses are worse than explicit errors because UI fallback handling will not run.

When adding UI mutations, confirm the API supports the exact method and path and that CSRF headers are sent. Current important paths include:

```text
/api/auth/*
/api/dashboard
/api/runtime-endpoints/*
/api/functions/*
/api/deployments
/api/deployments/release
/api/deployments/:projectDeploymentId/rollback
/api/runtime-endpoints/:id/rollback
/api/runtime-endpoints/:id/manifest*
/api/deployments
/api/executions
/api/audit-events
/api/templates*
```

`apps/web` uses relative `/api` URLs. Caddy routes them in the unified gateway; the Next.js rewrite uses `API_INTERNAL_URL` only during native host development where Next.js listens on port 3000.

## UI conventions

Keep the interface developer-focused, responsive and usable in dark and light themes. Reuse the components in `apps/web/components` and maintain explicit loading, empty and error states.

The project Function editor is the primary UI. Changes to it should preserve:

- Function and project-library navigation
- Monaco TypeScript editing
- Input and output schema editing
- Function policy and secret-grant settings
- Save, validate, test and deploy actions
- Test caller and source inputs
- Output, logs and error panels

Read-only development fallback data must be visibly labeled. Never make a failed mutation appear successful locally.

MCP Endpoint and HTTP API detail pages use ordinary binding tables. Do not add a
canvas, Function-to-Function execution edges, or workflow behavior.

## Testing expectations

Add or update tests when changing security or runtime behavior. The existing required coverage includes:

- AES encryption and authentication
- Secret redaction
- Permission authorization
- API-key comparison
- JSON Schema input validation
- HTTP invocation input mapping
- Network allowlist and private-address enforcement
- Immutable snapshot behavior
- Rollback planning
- Restricted bundling
- Real child-process execution
- Project Function reuse across MCP Endpoints and HTTP APIs
- Internal Function call graph pinning, cycle rejection and execution lineage
- Authenticated control-plane proxying to private worker replicas

For vertical-slice changes, update `scripts/e2e.mjs`. It covers seeded login, deployment, MCP `tools/list`, MCP `tools/call`, HTTP invocation and persisted execution records.

Docker may be unavailable in some development environments. In that case, still run all static builds, unit tests, Prisma validation and Compose configuration validation, and clearly report that the live integration test was not executed.

## Intentionally deferred features

Do not imply these are production-complete:

- Enterprise control-plane SSO and Microsoft Graph connection lifecycle (out of scope; local platform auth and runtime Entra validation only)
- Microsoft Agent 365 integration
- Arbitrary npm packages
- Raw or arbitrary database queries
- Schedules, event buses, prompts and resources
- GraphQL, generic API gateway middleware or response streaming
- Kubernetes manifests and production autoscaling

When implementing a deferred feature, preserve a clear provider interface, feature flag and accurate UI/documentation state.
