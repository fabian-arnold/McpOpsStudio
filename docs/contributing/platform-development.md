---
title: Platform development
description: Orientation for developers extending MCP Ops Studio itself.
---

# Platform development

This track is for contributors changing MCP Ops Studio. Product users and
installation operators can stay within the [application](../app/navigation.md)
and [operations](../installation.md) guides.

## System shape

MCP Ops Studio packages two application roles. The control plane combines Caddy,
Next.js, and Fastify. Private worker replicas combine the runtime listener,
deployment worker, and FunctionExecutor boundary. PostgreSQL stores durable
state and Redis supplies queues and scoped cache.

Read [Architecture](../architecture.md) before changing service boundaries and
[Runtime and deployments](../runtime-and-deployments.md) before changing
snapshots or invocation behavior.

## Local workflow

Follow [Development](../development.md) for Corepack, pnpm workspaces, Prisma,
Compose, focused checks, and the vertical-slice test. Repository-wide engineering
rules live in `AGENTS.md`; contribution expectations live in `CONTRIBUTING.md`.

## Change areas

- `apps/web` and `apps/api`: authenticated control-plane experience.
- `apps/runtime` and `apps/worker`: private invocation and deployment pipeline.
- `packages/shared` and `packages/db`: contracts and scoped persistence.
- `packages/runtime-sdk`, `packages/platform-modules`, and `packages/sandbox`:
  controlled Function capabilities and execution.
- `prisma`, `infra`, and `scripts`: schema, deployment, and vertical verification.

## Before handoff

Run focused tests, the recursive build, Prisma validation, Compose configuration
validation, and `git diff --check`. Update application docs and screenshots when
visible behavior changes.
