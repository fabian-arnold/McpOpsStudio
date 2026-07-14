# Software release process

This page describes maintainer releases of MCP Ops Studio images and
installation assets. These software releases are distinct from Project
production releases created through the control plane.

## Release contract

Software versions use SemVer tags such as `v1.4.0` and `v1.5.0-rc.1`. A tag
starts `.github/workflows/release.yml`, which:

1. Rejects a non-SemVer tag.
2. Installs the frozen pnpm dependency graph and generates Prisma Client.
3. Validates Prisma, runs unit tests, and builds the workspace and docs.
4. Validates development and release Compose configurations and runs the
   Compose-backed vertical-slice integration test with two workers.
5. Builds amd64 and arm64 `control-plane`, `worker`, and `migrate` images.
6. Publishes the images to GHCR with the exact Git tag.
7. Packages the release Compose files, environment template, and PostgreSQL
   initialization hook, then publishes a checksum.
8. Creates a GitHub Release with generated release notes after every image and
   installation asset has succeeded.

Pull requests and `main` continue to exercise container builds through
`containers.yml`. The `latest` image represents `main`; operators should use an
exact release tag.

## Prepare a release

Before the first release, link the three `mcpopsstudio-*` GHCR packages to this
repository and make them public so an installation can pull without repository
credentials. Keep package write access restricted to the release workflow.

1. Confirm `main` is green and the intended commits follow the
   [commit style](./commit-style.md).
2. Review user-visible changes, migrations, configuration changes, security
   implications, upgrade ordering, and rollback requirements.
3. Run the local handoff checks:

```bash
corepack pnpm install --frozen-lockfile
pnpm db:generate
pnpm test
pnpm build
pnpm docs:build
docker compose -f infra/docker-compose.yml config --quiet
git diff --check
```

4. Choose the SemVer increment. Breaking API, snapshot, configuration, or
   rollout changes require a major version and explicit release notes.
5. Create an annotated tag from the reviewed commit and push only that tag:

```bash
git tag -a v1.2.3 -m "release: v1.2.3"
git push origin v1.2.3
```

Use a signed tag when maintainer signing is configured.

## Verify publication

Do not announce the release until the Release workflow completes. Confirm:

- all three GHCR packages have the exact tag for amd64 and arm64;
- the GitHub Release contains the Compose archive and `SHA256SUMS`;
- prerelease tags are marked as prereleases;
- generated notes accurately describe migrations and operational changes; and
- a clean host can follow the [Docker Compose installation guide](./installation.md).

If publication fails, fix the cause and rerun the failed workflow. Do not move
or reuse a tag that users may already have pulled. Publish a new patch tag when
any artifact may have escaped.

## Security releases

Do not put embargoed vulnerability details, credentials, or exploit material in
commits, tags, workflow logs, or generated release notes. Coordinate disclosure
through the private maintainer process, then publish sanitized upgrade guidance
with the fixed release.
