# Development

## Prerequisites

- Node.js 22+
- Corepack with pnpm 9
- Docker and Docker Compose v2

On Windows, Docker Desktop must be running with the Linux container engine before Compose-backed tests can run.

## Workspace setup

```bash
corepack enable
pnpm install
pnpm db:generate
```

If Corepack cannot install global shims, invoke pnpm through Corepack:

```bash
corepack pnpm install
corepack pnpm -r build
```

## Full-stack development

### Watched development stack

Docker Compose 2.22 or later is the recommended development path. It starts every dependency and application, then watches the workspace:

```bash
cp .env.example .env
pnpm dev
```

The command combines `infra/docker-compose.yml` with `infra/docker-compose.dev.yml` and runs Compose Watch in the foreground.

`.env.example` explicitly selects the `demo` Compose profile. The profile starts the development-only mock CRM and is appropriate only for the seeded Acme scenario. Remove `COMPOSE_PROFILES=demo`, disable `MCP_OPS_DEMO_MODE`, and omit `MOCK_CRM_URL` when testing against a real allowlisted integration.

Watch behavior:

- Changes in `apps/web` are synchronized and handled by Next.js Fast Refresh.
- Changes in `apps/api`, `apps/runtime` and `apps/worker` are synchronized and restarted by their role's watch processes.
- Shared package source is synchronized into the affected application containers and compiled by TypeScript watch processes without rebuilding images.
- The mock CRM uses Node's native watch mode.
- Prisma files, application package manifests, `pnpm-lock.yaml` and `tsconfig.base.json` rebuild affected development images.
- PostgreSQL and Redis volumes are preserved across normal stops.

Stop the watched stack with `Ctrl+C`, or from another terminal:

```bash
pnpm dev:down
```

Prisma changes regenerate the client when affected images rebuild, but migrations are not applied by source synchronization. After creating a migration, run:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml run --rm migrate
```

Compose Watch rebuilds the affected application containers after the Prisma files change.

### Production-like Compose stack

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

With the example development environment, Compose starts PostgreSQL, Redis, a
one-shot migration and seed container, the public `control-plane` role, the
private scalable `worker` role, and the `demo`-profile mock CRM. The control
plane packages Caddy, Next.js and Fastify. Each worker replica packages the
private runtime listener and deployment job consumer. Without the `demo`
profile the mock CRM is not created.

Scale identical worker replicas without exposing worker ports:

```bash
docker compose -f infra/docker-compose.yml up --build --scale worker=3
```

All production application containers run `pnpm config:validate` before startup, and the migration container runs it before database changes. `NODE_ENV=production` requires explicit non-development credentials and non-local HTTPS public URLs and refuses demo mode or `MOCK_CRM_URL`.

The PostgreSQL container initializes with two roles:

- `POSTGRES_ADMIN_USER` is the bootstrap administrator required by the official image.
- `POSTGRES_USER` is a separate non-superuser application role used by `DATABASE_URL`.

These names must differ. The application role owns the `public` schema so Prisma can apply migrations without superuser privileges.

The application role also receives database-level `CREATE` permission because Prisma's baseline migration executes `CREATE SCHEMA IF NOT EXISTS public`. It remains `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE` and `NOINHERIT`.

```text
http://localhost:8080  unified public gateway (UI, API, MCP and HTTP)
localhost:5432         PostgreSQL
localhost:6379         Redis
```

Workers are private Compose services. Caddy load-balances `/mcp` and `/http`
requests to healthy worker replicas and authenticates the hop with
`INTERNAL_API_TOKEN`.

`RUNTIME_CONCURRENCY` limits concurrent proxied invocations in each worker
replica. `DEPLOYMENT_CONCURRENCY` separately limits BullMQ build jobs so builds
cannot consume the runtime request budget.

The seed is idempotent. Re-running the migration container refreshes development credentials and preserves the stable Acme demo identifiers where possible.

### Recovering from an interrupted database initialization

PostgreSQL runs initialization hooks only for an empty data directory. If an init hook fails during the first startup, recreate the incomplete local volume before retrying:

```bash
docker compose -f infra/docker-compose.yml down --volumes
docker compose -f infra/docker-compose.yml up --build
```

This deletes local development PostgreSQL and Redis data. Do not use it for retained environments.

## Native application development

PostgreSQL and Redis may run in Docker while individual applications run on the
host. When doing so, change infrastructure and internal application hostnames to
`localhost` and their development ports. Native development keeps the source
applications separate even though production-like Compose packages them into
two deployable roles.

To generate Prisma, build workspace packages once and start all package and application watchers:

```bash
pnpm dev:local
```

Package TypeScript watchers keep exported `dist` files current while application watchers reload their processes.

Useful commands:

```bash
pnpm --filter @mcpops/web dev
pnpm --filter @mcpops/api dev
pnpm --filter @mcpops/runtime dev
pnpm --filter @mcpops/worker dev
```

The web application calls relative `/api` URLs. During native host development, where Next.js listens directly on port 3000, it uses `API_INTERNAL_URL` for its rewrite. Compose exposes only the unified port 8080 origin.

## Database workflow

The schema is `prisma/schema.prisma`; the seed is `prisma/seed.ts`.

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Create a migration for every schema change and inspect the generated SQL before committing it. Keep project-scoping indexes and foreign-key deletion behavior explicit.

The Project and reusable project-Function models are a clean, unreleased
baseline with no compatibility migration. After pulling these schema changes,
remove the old local Compose volume with
`docker compose -f infra/docker-compose.yml down -v`, then start normally so
the baseline and development seed run against a new database.

## Testing

Run all unit tests:

```bash
pnpm test
```

Run focused packages during development:

```bash
pnpm --filter @mcpops/runtime test
pnpm --filter @mcpops/sandbox test
pnpm --filter @mcpops/shared test
pnpm --filter @mcpops/db test
```

Run the integration test against a healthy Compose stack:

```bash
pnpm test:e2e
```

The integration script signs in, queues a deployment, waits for activation,
calls MCP `tools/list` and `tools/call`, invokes the equivalent HTTP route and
verifies persisted execution records through the unified public gateway.

## Debugging

Every API and runtime response carries `x-request-id`. Use it to correlate application logs with `FunctionExecution.requestId` and audit metadata.

Useful endpoints:

```text
GET /health
GET /ready
GET /metrics
GET /internal/runtime-endpoints/{endpointId}/manifest
```

The internal manifest endpoint is not routed by Caddy. Use it only from the internal network and configure `INTERNAL_API_TOKEN`.

Deployment failures are recorded in `DeploymentLog`; do not rely only on worker stdout. Function execution errors exposed to callers are intentionally sanitized.

## Final verification

```bash
pnpm build
pnpm test
docker compose -f infra/docker-compose.yml config --quiet
git diff --check
```

If a live Compose run is unavailable, record that limitation in the handoff or pull request.
