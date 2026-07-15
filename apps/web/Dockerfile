FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --filter @mcpops/web... --frozen-lockfile=false

FROM deps AS build
ARG MCP_OPS_VERSION=development
ARG MCP_OPS_COMMIT_SHA=unknown
ENV DOCKER_BUILD=1
ENV MCP_OPS_VERSION=${MCP_OPS_VERSION}
ENV MCP_OPS_COMMIT_SHA=${MCP_OPS_COMMIT_SHA}
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @mcpops/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
