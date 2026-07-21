# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# apps/users-service/Dockerfile
# Production-grade multi-stage build for the users-service microservice.
#
# Build from the REPO ROOT:
#
#   docker build -f apps/users-service/Dockerfile -t users-service:prod .
#
# See apps/api-gateway/Dockerfile for detailed stage-by-stage rationale.
# Comments here call out ONLY what differs for the internal service.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./

FROM base AS deps
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable

FROM deps AS builder
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
# Only THIS service is copied — api-gateway isn't compiled in this image.
COPY apps/users-service ./apps/users-service
RUN yarn build:users

FROM base AS prod-deps
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus --production

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini
WORKDIR /app

# Bind the TCP listener to all interfaces (required inside a container so
# other containers on the same Docker network can reach us).
ENV NODE_ENV=production \
    USERS_SERVICE_HOST=0.0.0.0 \
    USERS_SERVICE_PORT=4001

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder   --chown=node:node /app/dist/apps/users-service ./dist/apps/users-service
COPY                  --chown=node:node package.json ./

USER node
EXPOSE 4001

# TCP HEALTHCHECK: users-service speaks the NestJS binary TCP transport,
# NOT HTTP. So we can't hit an HTTP endpoint. Instead, we prove the TCP
# listener is accepting connections. Successful connect = healthy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('net').connect(4001, '127.0.0.1').on('connect', function(){this.end(); process.exit(0)}).on('error', () => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/users-service/main"]
