# Security Model

## Trust model

The default local executor provides trusted-developer process isolation. It reduces accidental host access but is not a security boundary for malicious authors.

The optional disposable-container `FunctionExecutor` is the production isolation path. It requires an explicitly selected, pre-pulled runner image and applies no network, read-only mounts/filesystem, non-root execution, dropped Linux capabilities, no-new-privileges, CPU/memory/PID/tmpfs limits, cancellation, and forced cleanup. Docker `runsc` can be selected for a gVisor boundary. Production refuses an omitted provider and never silently falls back to local. Operators remain responsible for securing the Docker daemon, runner image supply chain, host work directory, and runtime configuration.

## Platform authentication

Control-plane users authenticate with local email and Argon2 password hashes. Sessions are signed, time-limited cookies. Mutation requests also require the `mcpops_csrf` cookie value in the `x-csrf-token` header.

Platform roles are owner, admin, developer, operator and viewer. Route handlers must explicitly require the appropriate role.

Control-plane users authenticate with local email and password. Runtime endpoints
can validate JWTs and Microsoft Entra access tokens through explicitly configured
authentication policies.

## Multi-tenancy

The authenticated session is the source of the selected operational `projectId`. Installation-wide users may change it through the authenticated Project-selection endpoint; this is navigation state, not membership authorization.

Prefer scoped repositories. For direct Prisma queries, include project scope in the same database predicate used to locate the record.

Runtime endpoints use project and endpoint slugs, then load the endpoint's active
deployment. Functions belong directly to Projects and may be reused across
MCP Endpoints and HTTP APIs, but execution always occurs within one endpoint's pinned snapshot and
environment scope.

## Secrets

Secrets are encrypted with AES-256-GCM using `MCP_OPS_MASTER_KEY`. The master key must encode exactly 32 bytes.

Secret rules:

- Never return plaintext or `encryptedValue` from normal APIs.
- Never include values in deployment snapshots or manifests.
- Resolve only explicit `SecretGrant` entries.
- Do not expose a secret enumeration API to function code.
- Redact known secret values and sensitive key names in logs and records.
- Rotation APIs return metadata only.
- Prevent deletion while grants remain.

Encryption formats must stay compatible across database, shared and sandbox packages.

## User-code restrictions

The restricted bundler rejects:

- Arbitrary npm modules
- Relative and filesystem imports
- `require` and dynamic imports
- Process and host-runtime access
- Filesystem and child-process APIs
- Global unrestricted network APIs
- Dynamic code generation

Reviewed virtual imports are supplied at bundle time. Project libraries must be pure TypeScript utilities and are versioned into deployment snapshots.

## Network controls

`ctx.http` enforces:

- Exact or reviewed wildcard host allowlists
- Allowed methods and ports
- DNS resolution before connection
- Private, loopback, link-local and metadata address blocking
- Redirect revalidation
- Timeout and cancellation
- Maximum response size
- Sanitized upstream failures

Do not log authorization headers or raw upstream error bodies.

The bundled mock CRM is guarded by the `demo` Compose profile and `MCP_OPS_DEMO_MODE=true`. Production configuration validation refuses that mode, `MOCK_CRM_URL`, known seed credentials, and local public URLs. A production integration must supply an explicit reviewed endpoint and network allowlist; it cannot silently fall back to the mock service.

## Runtime authorization

Authorization has three layers:

1. Authenticate the endpoint credential or identity.
2. Establish access to the resolved endpoint.
3. Require the externally selected entry Function's permissions.

An internal `ctx.functions.call()` retains the original caller identity but does
not repeat external permission authorization for the child. The child still uses
its own secret grants, network restrictions, timeout, schemas, storage/cache
scope and audit behavior. Call targets and versions are pinned in the deployed
graph, cycles are rejected, and runtime depth is bounded.

Authentication and permission denials are persisted safely. Write and destructive calls also produce audit records.

API key, HTTP Basic, static bearer, HMAC-SHA256 webhook signatures, remote-JWKS JWT, and Microsoft Entra access-token policies are implemented runtime providers. Static policies authenticate a credential and may grant named function permissions; they do not configure roles or scopes. Basic-auth passwords are encrypted Secret records referenced by the policy. JWT and Entra require explicit issuer/audience configuration and are disabled when their feature flag is `false`. JWT/Entra validation enforces HTTPS JWKS, safe-public DNS resolution, issuer, audience, required claims, clock skew, and key rotation. Webhook validation signs the timestamp plus exact raw JSON body, applies a bounded tolerance, and uses Redis replay protection.

Runtime token validation belongs to endpoint authentication. Control-plane
sign-in uses the installation-wide local account and role model.

The public `control-plane` role proxies MCP/HTTP traffic to private worker
replicas. Worker ports are not published, and the internal hop is authenticated
with `INTERNAL_API_TOKEN`. This credential authenticates the proxy, not the
external caller; normal endpoint authentication remains mandatory.

## Logging and errors

Logs are structured and attach request, project, environment, endpoint, function, deployment and execution metadata.

Caller-facing errors use stable safe codes. They must not contain stack traces, tokens, secret values, raw upstream responses or implementation paths.

Persisted execution input, output, caller and error values pass through recursive redaction before database writes.

## Reporting vulnerabilities

Do not disclose suspected vulnerabilities in a public issue. Contact the repository maintainers privately with reproduction details, impact and suggested mitigations. Do not include live credentials or customer data.
