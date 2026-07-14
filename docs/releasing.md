# Software release process

Software releases publish MCP Ops Studio containers and its one-file Compose
installer. They are separate from Project production releases inside the app.

## TL;DR

From a green, reviewed `main` branch:

```bash
git tag -a v1.2.3 -m "release: v1.2.3"
git push origin v1.2.3
```

The SemVer tag starts the Release workflow. Do not announce or reuse the tag
until that workflow finishes successfully.

## What the workflow guarantees

`.github/workflows/release.yml` validates the tag, schema, tests, builds, docs,
and Compose files; runs the existing vertical-slice suite; publishes amd64 and
arm64 control-plane, worker, and migration images; creates a version-pinned
`compose.yaml`; and performs a clean-install smoke test through one-time browser
setup and the Note App's authenticated HTTP API. Only then does it publish the
GitHub Release with:

- `compose.yaml` — the normal installer
- `compose.container-executor.yaml` — optional stronger executor isolation
- `SHA256SUMS` — checksums for both files

Before the first release, link the three `mcpopsstudio-*` GHCR packages to this
repository and make them public. Keep package write access restricted to the
release workflow.

## Prepare and verify

1. Confirm `main` is green and commits follow the
   [commit style](./commit-style.md).
2. Review migrations, configuration changes, security impact, upgrade order,
   and rollback requirements.
3. Run the handoff checks:

```bash
corepack pnpm install --frozen-lockfile
pnpm db:generate
pnpm test
pnpm build
pnpm docs:build
docker compose -f infra/docker-compose.yml config --quiet
git diff --check
```

4. Choose the SemVer increment and push the annotated tag shown above. Use a
   signed tag when maintainer signing is configured.
5. After the workflow succeeds, confirm all three GHCR images have the exact tag
   for both architectures, the release has all three assets, prereleases are
   marked correctly, and generated notes accurately describe migrations.

If publication fails, fix the cause and rerun the failed workflow. Never move a
tag whose artifacts may have been pulled; publish a new patch tag instead.

For security releases, keep embargoed details and exploit material out of
commits, workflow logs, tags, and generated notes. Publish sanitized upgrade
guidance with the fixed release.
