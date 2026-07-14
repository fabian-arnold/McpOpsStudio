# Install with Docker Compose

You need Docker Engine or Docker Desktop with Docker Compose v2. The installer
supports amd64 and arm64 and stores all durable state in named Docker volumes.

## Install

Create an empty directory and run:

```bash
curl -fLO https://github.com/fabian-arnold/McpOpsStudio/releases/latest/download/compose.yaml
docker compose up -d --wait
docker compose logs --no-log-prefix mcpops-config
```

Open `http://localhost:8080/setup`, enter the setup code shown by the last
command, and create the owner account and first Project. Choose either an empty
Project or the optional Note App demo. The demo has MCP and HTTP bindings,
integrated persistence, and deliberately public test credentials
`DEMO` / `DEMO`; do not expose it as a real service.

The installer generates database passwords, encryption keys, session secrets,
and internal service credentials once. The secrets are retained in the
`mcpops-config` volume, and setup permanently closes after the owner is created.

To pin a specific release, replace `latest` in the download URL with
`download/v1.2.3`:

```bash
curl -fLo compose.yaml https://github.com/fabian-arnold/McpOpsStudio/releases/download/v1.2.3/compose.yaml
```

## Public HTTPS

The gateway listens on `127.0.0.1:8080` by default. For a retained installation,
put an HTTPS reverse proxy or load balancer in front of that address, preserve
the request host, and proxy the complete origin. Enter that HTTPS origin during
browser setup. PostgreSQL, Redis, and worker ports remain private.

The default local executor is intended for trusted developer-authored code. Use
the reviewed disposable-container executor configuration before allowing
hostile code; see the [security model](./security.md).

## Daily operations

```bash
# Status and logs
docker compose ps
docker compose logs -f control-plane worker

# Scale the private worker pool
docker compose up -d --wait --scale worker=3

# Stop without deleting data
docker compose down
```

Never add `--volumes` to `docker compose down` for a retained installation. It
deletes the database, queues, and generated encryption keys.

## Back up

Back up PostgreSQL and the generated configuration volume together. A database
backup without the original `MCP_OPS_MASTER_KEY` cannot decrypt stored Secrets.

```bash
docker compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > mcp-ops-studio.dump

docker run --rm -v mcp-ops-studio_mcpops-config:/source:ro \
  -v "$PWD":/backup alpine \
  tar -C /source -czf /backup/mcpops-config.tar.gz .
```

The Compose project name defaults to `mcp-ops-studio`; if you override it, use
the corresponding generated volume name. Test restores on a separate host.

## Upgrade

Download the new release's `compose.yaml` into the same directory, back up, and
run:

```bash
docker compose pull
docker compose up -d --wait
```

The one-shot migration service applies committed database migrations before the
application roles restart. Read release notes before skipping versions. If a
rollback crosses an incompatible database migration, restore the matching
database and configuration backups before using the older Compose file.

Project Function releases and rollbacks are separate control-plane operations;
see [Runtime and deployments](./runtime-and-deployments.md).
