# MCP Ops Studio Documentation

This directory is the source for the VitePress documentation site and contains
design and operational guides for contributors and self-hosted operators.

Run `pnpm docs:dev` for local authoring, `pnpm docs:build` to generate the static
site, and `pnpm docs:preview` to inspect the production build. GitHub Actions
publishes `docs/.vitepress/dist` to GitHub Pages.

## Guides

- [Docker Compose installation](installation.md) — install, configure, back up and upgrade a tagged release
- [Architecture](architecture.md) — system boundaries, data flow and repository ownership
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

Documentation must distinguish implemented behavior from planned or feature-flagged behavior. Runtime JWT/Entra token validation does not imply enterprise control-plane SSO; the control plane uses local authentication. Microsoft Graph connection management is out of scope. The reviewed-query provider is implemented but explicitly feature-gated; the local child-process executor remains trusted-developer isolation.

Examples must use development-only credentials and must never contain real secrets or customer data.
