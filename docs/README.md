# MCP Ops Studio Documentation

This directory contains design and operational documentation for contributors and self-hosted operators.

The public documentation homepage lives in [`site/`](site/index.html) and is
published to GitHub Pages by [the documentation workflow](../.github/workflows/docs-pages.yml).
It provides a visual overview of the project; the guides below remain the detailed
technical source of truth.

## Guides

- [Architecture](architecture.md) — system boundaries, data flow and repository ownership
- [Development](development.md) — local setup, commands, debugging and test strategy
- [Runtime and deployments](runtime-and-deployments.md) — function lifecycle, snapshots and invocation pipeline
- [Security](security.md) — trust boundaries, tenancy, secrets and network controls
- [Control-plane API](api.md) — authentication, error shapes and primary endpoints
- [Commit style](commit-style.md) — Conventional Commit format, scopes and examples

Additional project-level references:

- [README](../README.md) — product overview and quick start
- [Contributing guide](../CONTRIBUTING.md) — contribution and pull-request expectations
- [Agent development guide](../AGENTS.md) — repository invariants and implementation rules

## Documentation policy

Documentation must distinguish implemented behavior from planned or feature-flagged behavior. Runtime JWT/Entra token validation does not imply enterprise control-plane SSO; the control plane uses local authentication. Microsoft Graph connection management is out of scope. The reviewed-query provider is implemented but explicitly feature-gated; the local child-process executor remains trusted-developer isolation.

Examples must use development-only credentials and must never contain real secrets or customer data.
