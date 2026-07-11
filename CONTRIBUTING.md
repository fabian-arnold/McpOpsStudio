# Contributing to MCP Ops Studio

Thank you for helping improve MCP Ops Studio. This project is a self-hosted, function-first operations platform, so changes must preserve its runtime isolation, immutable deployment and Project resource boundaries.

Read [AGENTS.md](AGENTS.md) before making changes. It contains the repository-wide development and security rules used by both human and automated contributors.

## Before you start

For substantial changes, open an issue or discussion describing:

- The problem and intended user outcome
- The affected control-plane or runtime components
- Any data model or migration changes
- Security and backward-compatibility implications
- How the change will be tested

Bug reports should include reproduction steps, expected and actual behavior, relevant safe logs and the deployment version. Remove credentials, tokens, customer data and other sensitive values before posting.

## Local setup

Prerequisites:

- Node.js 22 or later
- Corepack and pnpm 9
- Docker with Compose v2 for the full stack

Install and validate the workspace:

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm build
pnpm test
```

Start the complete development environment:

```bash
cp .env.example .env
pnpm dev
```

This uses Docker Compose Watch for hot reload. Stop it with `Ctrl+C` or `pnpm dev:down`. See the [development guide](docs/development.md) for synchronization, rebuild and migration behavior.

Development-only credentials are documented in the README. Never reuse them in a shared or production environment.

## Making changes

Create a focused branch and keep commits scoped to one concern. Suggested prefixes include:

```text
feat/runtime-http-mapping
fix/deployment-rollback
docs/security-model
```

Use Conventional Commits for commit messages and pull-request titles. See the [commit style guide](docs/commit-style.md) for allowed types, recommended scopes, breaking-change notation and examples.

Follow these core rules:

- A project-level `Function` remains the primary executable entity and may be reused by multiple MCP Endpoints and HTTP APIs; bindings only expose functions.
- Keep composition in TypeScript. MCP tool and HTTP route bindings use ordinary tables; do not add an executable workflow canvas.
- Never execute user code in `apps/api` or `apps/web`.
- Runtime traffic must use active immutable deployment snapshots only.
- Keep the public control-plane role separate from the private, horizontally scalable worker role.
- Every control-plane database operation must be project-scoped.
- Do not expose secret values, encrypted values, tokens or unsafe upstream errors.
- Keep user-function imports and capabilities restricted.
- Add a Prisma migration for schema changes.
- Keep intentionally deferred providers accurately feature-flagged and documented.

## Code style

- Use strict TypeScript and meaningful domain names.
- Prefer Zod at public application boundaries and AJV for function JSON Schema validation.
- Avoid `any`; use `unknown` and narrow at runtime boundaries.
- Keep security-critical helpers small, isolated and tested.
- Use safe, stable API error shapes with a request ID.
- Keep UI states explicit: loading, empty, error and read-only fallback states must be distinguishable.
- Reuse existing components and contracts before adding parallel abstractions.

Formatting-only changes should not be mixed with behavior changes.

## Database changes

Edit `prisma/schema.prisma`, then create and inspect a migration. Do not commit a schema change without its migration.

```bash
pnpm db:generate
pnpm exec prisma migrate dev --schema prisma/schema.prisma --name descriptive_change
```

Keep the Acme seed idempotent. If a change affects the demo vertical slice, update both `prisma/seed.ts` and the integration test.

## Testing

Run focused tests while developing, then the complete verification set before opening a pull request:

```bash
pnpm test
pnpm build
docker compose -f infra/docker-compose.yml config --quiet
git diff --check
```

With the Compose stack running:

```bash
pnpm test:e2e
```

Changes to runtime safety, authentication, authorization, secrets, deployment snapshots, invocation mapping or network policy require direct unit coverage. Changes to the vertical slice require an update to `scripts/e2e.mjs` where applicable.

If Docker is unavailable, state clearly that the integration test was not run. Do not describe an unexecuted test as passing.

## Documentation

Update documentation in the same pull request when behavior, configuration, APIs, security guarantees or known limitations change.

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Runtime and deployments](docs/runtime-and-deployments.md)
- [Security](docs/security.md)
- [API guide](docs/api.md)

## Pull requests

A pull request should contain:

- A concise problem and solution summary
- Screenshots for visible UI changes
- Schema and migration notes when applicable
- Security impact and threat-boundary notes
- Verification commands and results
- Known limitations or follow-up work

Keep generated build output, `.env`, credentials and local data out of commits. CI must pass before merge.
