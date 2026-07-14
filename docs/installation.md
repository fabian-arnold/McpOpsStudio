# Install with Docker Compose

This guide installs a tagged MCP Ops Studio software release from prebuilt
container images. It is separate from a Project production release inside MCP
Ops Studio, which promotes an immutable Function snapshot.

## Requirements

- A Linux host with Docker Engine 24 or newer and Docker Compose v2
- An amd64 or arm64 CPU
- A DNS name and a TLS reverse proxy
- Persistent local storage for PostgreSQL and Redis volumes

The release stack publishes only the control-plane gateway, on
`127.0.0.1:8080` by default. PostgreSQL, Redis, and worker ports remain on the
private Compose network.

::: warning Executor isolation
The default `local` executor provides trusted-developer child-process isolation.
For hostile user-authored code, configure the disposable-container provider and
a reviewed, pre-pulled runner image. See [Security model](./security.md).
:::

## Download a release

Choose a tag from the GitHub Releases page and download its Compose bundle and
checksums. Replace `v0.1.0` below with the release being installed.

```bash
export MCP_OPS_VERSION=v0.1.0
curl -fLO "https://github.com/fabian-arnold/McpOpsStudio/releases/download/${MCP_OPS_VERSION}/mcp-ops-studio-${MCP_OPS_VERSION}.tar.gz"
curl -fLO "https://github.com/fabian-arnold/McpOpsStudio/releases/download/${MCP_OPS_VERSION}/SHA256SUMS"
sha256sum --check SHA256SUMS
tar -xzf "mcp-ops-studio-${MCP_OPS_VERSION}.tar.gz"
cd "mcp-ops-studio-${MCP_OPS_VERSION}"
cp mcp-ops-studio.env.example .env
```

The bundle contains the release Compose file, environment template,
least-privilege PostgreSQL initialization hook, and optional container-executor
override. Keep these files together.

## Configure the installation

Edit `.env` and keep its permissions restricted:

```bash
chmod 600 .env
```

At minimum:

1. Keep `MCP_OPS_VERSION` pinned to the downloaded tag.
2. Set both public URLs to the external HTTPS origin.
3. Generate a different value for every blank password, key, and token.
4. Set the initial administrator email and password.

Generate URL-safe, 32-byte random values with:

```bash
openssl rand -hex 32
```

Use independent output for `POSTGRES_ADMIN_PASSWORD`, `POSTGRES_PASSWORD`,
`MCP_OPS_MASTER_KEY`, `SESSION_SECRET`, `CSRF_SECRET`, `INTERNAL_API_TOKEN`, and
the two seeded API keys. `MCP_OPS_MASTER_KEY` must continue to encode exactly 32
bytes for the lifetime of the installation; losing or changing it makes stored
Secrets unreadable.

The bootstrap PostgreSQL administrator and application role must have different
names. The supplied defaults are `postgres` and `mcpops`. The application role
is non-superuser and is the only role used by application services.

## Start and verify

Validate the resolved configuration before changing any containers:

```bash
docker compose --env-file .env -f docker-compose.release.yml config --quiet
docker compose --env-file .env -f docker-compose.release.yml pull
docker compose --env-file .env -f docker-compose.release.yml up -d --wait
docker compose --env-file .env -f docker-compose.release.yml ps
```

The one-shot `migrate` service applies committed Prisma migrations and runs the
idempotent seed before either application role starts. Inspect it and the
readiness endpoint:

```bash
docker compose --env-file .env -f docker-compose.release.yml logs migrate
curl --fail http://127.0.0.1:8080/ready
```

Sign in through the configured public URL with `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD`. Rotate seeded endpoint credentials in the control plane
before connecting clients.

### TLS proxy

Terminate TLS in a host reverse proxy or load balancer and proxy the complete
origin to `http://127.0.0.1:8080`. Preserve the request host and correlation
headers, allow MCP request durations, and do not publish worker port 8080.

If TLS terminates on another host, explicitly set `MCP_OPS_BIND_ADDRESS` to the
private interface address and restrict access with a firewall. Do not expose the
gateway directly over plain HTTP in production.

### Scale workers

Identical workers can be scaled without publishing their ports:

```bash
docker compose --env-file .env -f docker-compose.release.yml up -d --wait --scale worker=3
```

`RUNTIME_CONCURRENCY` applies per replica. `DEPLOYMENT_CONCURRENCY` separately
limits deployment build jobs per replica.

## Back up

Back up PostgreSQL before every upgrade and regularly in retained environments:

```bash
docker compose --env-file .env -f docker-compose.release.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > mcp-ops-studio.dump
```

Also retain `.env` securely. Database backups without the original
`MCP_OPS_MASTER_KEY` cannot recover encrypted Secrets. Redis holds queues and
cache data; PostgreSQL and the master key are the critical durable state.

Test restore procedures on a separate installation. Never use `down --volumes`
for retained data.

## Upgrade or roll back the software

Read the target release notes, take a backup, and update only
`MCP_OPS_VERSION` in `.env`. Then run:

```bash
docker compose --env-file .env -f docker-compose.release.yml pull
docker compose --env-file .env -f docker-compose.release.yml up -d --wait
```

Compose recreates the versioned application containers and runs migrations
before starting them. Do not skip release versions unless the release notes say
that it is supported.

To roll back application images, restore the pre-upgrade database backup first
when the release introduced an incompatible migration, set the previous tag,
and run the same `pull` and `up` commands. Changing only the image tag does not
reverse database migrations.

Project snapshot rollback is a different operation performed in the MCP Ops
Studio control plane; see [Runtime and deployments](./runtime-and-deployments.md).

## Stop or remove

Stop containers while retaining data:

```bash
docker compose --env-file .env -f docker-compose.release.yml down
```

Adding `--volumes` permanently deletes the bundled PostgreSQL and Redis data.
