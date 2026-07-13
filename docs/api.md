# Control-Plane API

The Fastify control-plane API is served under `/api`. It is packaged with the
web application and Caddy in the public `control-plane` role.

## Authentication

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/account/password
```

Login accepts email and password and establishes a signed HTTP-only session cookie plus a readable CSRF cookie. Send `x-csrf-token` for POST, PUT, PATCH and DELETE requests after login.

## Error shape

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Safe user-facing message",
    "requestId": "request-id",
    "details": {}
  }
}
```

`details` is optional and should contain only safe validation information.

## Primary endpoints

### Projects, users, and selected project context

```text
GET    /api/projects
POST   /api/projects
PATCH  /api/projects/:projectId
POST   /api/projects/:projectId/select
POST   /api/projects/:projectId/archive
DELETE /api/projects/:projectId
GET    /api/users
POST   /api/users
PATCH  /api/users/:userId
GET /api/dashboard
GET /api/environments
```

Users and roles are installation-wide. Project selection reissues the signed
session with the chosen active Project; operational APIs use that selected
Project. There are no Project memberships or per-Project ACLs.

### Runtime endpoints

```text
GET   /api/runtime-endpoints
POST  /api/runtime-endpoints
GET   /api/runtime-endpoints/:endpointId
PATCH /api/runtime-endpoints/:endpointId
POST  /api/runtime-endpoints/:endpointId/disable
```

### Functions and bindings

```text
GET       /api/functions
POST      /api/functions
GET       /api/functions/:functionId
PUT|PATCH /api/functions/:functionId
POST      /api/functions/:functionId/validate
POST      /api/functions/:functionId/test

POST  /api/runtime-endpoints/:endpointId/mcp-bindings
PATCH /api/runtime-endpoints/:endpointId/mcp-bindings/:bindingId
DELETE /api/runtime-endpoints/:endpointId/mcp-bindings/:bindingId
POST  /api/runtime-endpoints/:endpointId/http-bindings
PATCH /api/runtime-endpoints/:endpointId/http-bindings/:bindingId
DELETE /api/runtime-endpoints/:endpointId/http-bindings/:bindingId
```

Functions belong to the selected Project and may be bound to multiple MCP
Endpoints and HTTP APIs. Bindings remain endpoint-scoped while deployment and
release operations are Project-wide. Function testing is delegated to the private worker
runtime; source never executes inside the control-plane role.

### Deployments

```text
POST /api/deployments
POST /api/deployments/release
POST /api/deployments/:projectDeploymentId/rollback
GET  /api/deployments
```

Development deployment requests are asynchronous. Poll the deployment list for
status. Production release promotes a completed development deployment without
rebuilding drafts.

### Secrets and policies

```text
GET    /api/secrets
POST   /api/secrets
POST   /api/secrets/:secretId/rotate
DELETE /api/secrets/:secretId

GET  /api/auth-policies
POST /api/runtime-endpoints/:endpointId/auth-policies
```

Secret responses contain metadata only.

### Libraries, templates and manifests

```text
GET  /api/libraries
POST /api/libraries
GET  /api/templates
POST /api/templates/install
POST /api/runtime-endpoints/:endpointId/templates/:templateId/install
GET  /api/runtime-endpoints/:endpointId/manifest
GET  /api/runtime-endpoints/:endpointId/discovery?format=openapi-json
POST /api/runtime-endpoints/:endpointId/manifest/preview
POST /api/runtime-endpoints/:endpointId/manifest
```

Manifest exports contain references, never secret values. Use preview before applying imports.

### Observability

```text
GET /api/executions
GET /api/executions/:id
GET /api/audit-events
```

Execution list filters include endpoint, function, status, request ID, tenant and invocation source. Returned sensitive fields are masked.

## Adding endpoints

New public endpoints must:

1. Authenticate the platform session.
2. Derive project scope from that session.
3. Enforce platform role authorization for mutations.
4. Enforce CSRF for mutations.
5. Validate inputs with Zod.
6. Return the standard error shape.
7. Avoid secret-bearing Prisma selections.
8. Add audit events for security-sensitive changes.
