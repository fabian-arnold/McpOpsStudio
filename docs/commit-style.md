# Commit Style Guide

MCP Ops Studio uses [Conventional Commits](https://www.conventionalcommits.org/) for human-readable history and future automated release notes.

## Format

```text
<type>(<scope>): <summary>

<optional body>

<optional footer>
```

Examples:

```text
feat(runtime): add bearer-token endpoint authentication
fix(worker): preserve active snapshot after a failed build
docs(security): explain trusted-developer isolation boundary
test(sandbox): cover redirect host revalidation
```

## Types

Use the narrowest applicable type:

| Type       | Use for                                                        |
| ---------- | -------------------------------------------------------------- |
| `feat`     | New user-visible or platform capability                        |
| `fix`      | Correcting faulty behavior                                     |
| `docs`     | Documentation-only changes                                     |
| `test`     | Adding or correcting tests without production behavior changes |
| `refactor` | Internal restructuring with no intended behavior change        |
| `perf`     | Measurable performance improvement                             |
| `build`    | Build system, package or container changes                     |
| `ci`       | GitHub Actions and other CI configuration                      |
| `chore`    | Repository maintenance that fits no more specific type         |
| `style`    | Non-functional source formatting only                          |
| `revert`   | Reverting an earlier commit                                    |

Do not use `chore` as a catch-all when `build`, `ci`, `docs`, `test` or `refactor` is more accurate.

## Scopes

Scopes are optional but strongly recommended. Prefer a stable package, application or domain name:

```text
web
api
runtime
worker
db
shared
sandbox
runtime-sdk
platform-modules
prisma
infra
auth
deployments
executions
manifests
templates
docs
```

Use one scope that best describes the primary change. Do not list multiple comma-separated scopes. For a genuinely repository-wide change, omit the scope:

```text
build: align TypeScript configuration across workspaces
```

## Summary line

The summary must:

- Use the imperative mood: `add`, `fix`, `prevent`, `document`.
- Start with a lowercase letter after the colon.
- Contain no trailing period.
- Describe the outcome, not the implementation process.
- Stay at or below 72 characters when practical.
- Be specific enough to understand without opening the diff.

Good:

```text
fix(runtime): redact credentials from persisted upstream errors
```

Avoid:

```text
fix stuff
Updated runtime.
chore: changes
```

## Commit body

Use a body when the reason, behavior or tradeoff is not obvious. Separate it from the summary with a blank line.

Explain:

- Why the change is necessary
- Important behavior before and after the change
- Security, compatibility or operational implications
- Alternatives rejected when that context will help future maintainers

Wrap prose near 100 characters when practical. Do not copy the pull-request description verbatim if a shorter explanation is sufficient.

Example:

```text
fix(deployments): activate snapshots only after all bundles succeed

Keep the previous deployment active while functions are validated and
bundled. This prevents partially built runtime endpoints from receiving traffic when
one function fails restricted-import validation.
```

## Breaking changes

Mark an incompatible change with `!` after the type or scope and add a `BREAKING CHANGE:` footer:

```text
feat(runtime)!: require schema version on deployment snapshots

Reject snapshots without an explicit schema version so the runtime can apply
deterministic compatibility rules.

BREAKING CHANGE: Existing custom snapshots must add `schemaVersion: 1`.
```

Breaking changes include incompatible API contracts, snapshot formats, environment variables, manifest structures, database expectations or runtime behavior. A Prisma migration is not automatically breaking, but destructive or non-rolling migrations usually are.

Call out migration and rollout requirements in both the commit body and pull request.

## Footers

Use standard footers where relevant:

```text
Closes #123
Refs #456
Co-authored-by: Name <email@example.com>
BREAKING CHANGE: explanation
```

Do not invent issue numbers or add a `Closes` footer unless the commit or resulting pull request should actually close that issue.

## Security-sensitive changes

Commits involving authentication, authorization, secrets, sandboxing, networking, tenancy or redaction should state the protected boundary in the body.

Never place any of the following in a commit message:

- Secret or encrypted values
- API keys or access tokens
- Customer or tenant data
- Private vulnerability reproduction details inappropriate for public history
- Raw logs containing authorization headers or cookies

Use private maintainer channels for embargoed vulnerability details.

## Database and generated changes

Keep a Prisma schema change and its migration in the same commit unless the migration is intentionally split for a documented staged rollout.

Example:

```text
feat(prisma): add immutable project library versions

Include the generated migration and update the Acme seed so fresh and existing
development databases produce the same endpoint state.
```

Do not commit generated build output such as `dist`, `.next`, coverage or local Prisma data. Commit the pnpm lockfile when dependency resolution changes.

## Commit boundaries

Each commit should be independently understandable and leave the repository in a buildable state whenever practical.

- Separate unrelated behavior changes.
- Keep mechanical formatting separate from functional changes.
- Include tests with the behavior they verify.
- Include documentation with the contract or behavior change.
- Avoid temporary commits such as `wip`, `try again` or `fix tests` in the final branch history.

During development, temporary commits are acceptable on a private branch. Reword, squash or fix them up before requesting final review if the repository uses a clean-history merge strategy.

## Reverts

Use Git's generated revert format and identify the reverted commit:

```text
revert: feat(runtime): add bearer-token endpoint authentication

This reverts commit 0123456789abcdef.

The provider caused existing API-key policies to resolve the wrong header.
```

Include the reason for the revert unless it is already fully documented in the linked incident or pull request.

## Pull-request relationship

Commit messages describe individual logical changes. The pull-request title should also use Conventional Commit format because squash merges commonly use it as the final commit message.

Before merge, check that:

- The PR title has the correct type, scope and breaking-change marker.
- Temporary commits will not become permanent history.
- Migration, security and rollout notes are preserved in the final message.
- Linked issues and co-author attribution are accurate.

## Quick reference

```text
feat(web): add execution source filter
fix(api): scope secret rotation by project
refactor(runtime): extract HTTP input mapper
perf(db): index execution lookup by request ID
test(worker): preserve active deployment on bundle failure
build(infra): pin Caddy image version
ci: add container matrix builds
docs: add commit style guide
```
