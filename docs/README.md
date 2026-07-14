# MCP Ops Studio Documentation

This directory is the source for the VitePress documentation site and contains
application, operational, and contributor guides for developers who install,
use, operate, or extend MCP Ops Studio.

Run `pnpm docs:dev` for local authoring, `pnpm docs:build` to generate the static
site, and `pnpm docs:preview` to inspect the production build. GitHub Actions
publishes `docs/.vitepress/dist` to GitHub Pages.

## Guides

- [Getting started](getting-started.md) — install an instance and publish the first Function
- [Application guide](app/navigation.md) — every menu page, editor, and operational workflow
- [End-to-end guides](guides/first-function.md) — illustrated Function, MCP, HTTP, security, and delivery walkthroughs
- [Docker Compose installation](installation.md) — install, configure, back up and upgrade a tagged release
- [Architecture](architecture.md) — system boundaries, data flow and repository ownership
- [Platform development](contributing/platform-development.md) — contributor orientation, repository areas, and verification
- [Development](development.md) — local setup, commands, debugging and test strategy
- [Runtime and deployments](runtime-and-deployments.md) — function lifecycle, snapshots and invocation pipeline
- [Security](security.md) — trust boundaries, tenancy, secrets and network controls
- [Control-plane API](api.md) — authentication, error shapes and primary endpoints
- [Commit style](commit-style.md) — Conventional Commit format, scopes and examples
- [Software releases](releasing.md) — maintainer tagging, image publication and release verification

Additional project-level references:

- [README](../README.md) — product overview and quick start
- [Contributing guide](../CONTRIBUTING.md) — contribution and pull-request expectations
- [Agent development guide](../AGENTS.md) — repository invariants and implementation rules

## Documentation policy

Documentation describes implemented capabilities and successful workflows. It
uses Function-first terminology, identifies active and draft state precisely,
and labels feature-gated providers with their activation requirements.

Examples must use development-only credentials and must never contain real secrets or customer data.
