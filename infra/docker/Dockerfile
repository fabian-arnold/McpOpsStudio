FROM caddy:2.8-alpine AS caddy

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
# Copy dependency manifests before source so ordinary edits retain the pnpm
# install layer. Prisma's schema is needed by @prisma/client postinstall.
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/runtime/package.json ./apps/runtime/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/runtime-sdk/package.json ./packages/runtime-sdk/package.json
COPY packages/platform-modules/package.json ./packages/platform-modules/package.json
COPY packages/sandbox/package.json ./packages/sandbox/package.json
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY scripts ./scripts
RUN pnpm --filter @mcpops/db generate

FROM dependencies AS development
# Workspace packages export compiled ESM. Build application dependencies once;
# Compose Watch rebuilds this stage when shared package sources change.
RUN pnpm --filter "./packages/*" build
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY infra/docker/start-control-plane.sh /usr/local/bin/start-control-plane
COPY infra/docker/start-worker.sh /usr/local/bin/start-worker
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
RUN chmod +x /usr/local/bin/start-control-plane /usr/local/bin/start-worker
ENV NODE_ENV=development

FROM dependencies AS build
ARG APP
ARG API_INTERNAL_URL=http://127.0.0.1:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN case "$APP" in \
      control-plane) pnpm --filter "@mcpops/api..." build && pnpm --filter "@mcpops/web..." build ;; \
      worker) pnpm --filter "@mcpops/runtime..." build && pnpm --filter "@mcpops/worker..." build ;; \
      migrate) pnpm --filter "@mcpops/db..." build ;; \
      *) pnpm --filter "@mcpops/${APP}..." build ;; \
    esac

FROM build AS runner
ENV NODE_ENV=production
ARG APP
ENV APP_NAME=${APP}
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY infra/docker/start-control-plane.sh /usr/local/bin/start-control-plane
COPY infra/docker/start-worker.sh /usr/local/bin/start-worker
COPY infra/docker/start-with-generated-config.sh /usr/local/bin/start-with-generated-config
COPY infra/postgres-init/00-security.sh /usr/local/share/mcpops/00-security.sh
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
RUN chmod +x /usr/local/bin/start-control-plane /usr/local/bin/start-worker /usr/local/bin/start-with-generated-config \
    && if [ "$APP" = "worker" ]; then apk add --no-cache docker-cli; fi
ENTRYPOINT ["/usr/local/bin/start-with-generated-config"]
CMD ["sh", "-c", "pnpm config:validate && exec /usr/local/bin/start-${APP_NAME}"]
