# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# apps/api-gateway/Dockerfile
# Production-grade multi-stage build for the api-gateway service.
#
# Build from the REPO ROOT (the build context needs libs/, apps/,
# .yarn/, and the root config files):
#
#   docker build -f apps/api-gateway/Dockerfile -t api-gateway:prod .
#
# The `# syntax=` directive on line 1 opts into modern BuildKit features
# (cache mounts, secret mounts, better parallelism). Requires BuildKit,
# which is Docker's default builder as of Docker 23.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:22-alpine

# ═══════════════════════════════════════════════════════════════════════════
# BASE — shared setup for every stage that follows.
#   Copies ONLY the yarn manifest + lock + pinned yarn binary. Source
#   code is copied later in the builder stage, so it doesn't invalidate
#   the dependency-install cache when app code changes.
# ═══════════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# Enable Corepack so `yarn` inside the container is resolved via the
# `packageManager` field in package.json (yarn@4.17.1 in our case).
# Corepack fetches the exact yarn binary from repo.yarnpkg.com on first
# use; the fetch happens inside the `deps`/`prod-deps` layers below and
# is cached by BuildKit alongside the yarn install itself.
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./

# ═══════════════════════════════════════════════════════════════════════════
# DEPS — full install (dev + prod). Needed to compile the app.
#   --mount=type=cache keeps Yarn's global cache OUTSIDE the layer, so it
#   speeds up subsequent builds without bloating the final image.
#   --immutable = "npm ci --frozen-lockfile" equivalent: fails if
#   yarn.lock would need to change. Guarantees reproducible installs.
# ═══════════════════════════════════════════════════════════════════════════
FROM base AS deps
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable

# ═══════════════════════════════════════════════════════════════════════════
# BUILDER — compile ONLY api-gateway.
#   Notice: apps/users-service is NOT copied. This image will never run
#   users-service, so we don't compile it here. Faster build, smaller
#   surface area, easier to reason about what's in the image.
# ═══════════════════════════════════════════════════════════════════════════
FROM deps AS builder
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/api-gateway ./apps/api-gateway
RUN yarn build:gateway

# ═══════════════════════════════════════════════════════════════════════════
# PROD-DEPS — install ONLY production dependencies.
#   `yarn workspaces focus --production` (from the workspace-tools plugin
#   bundled with Yarn 4) skips devDependencies. In our repo that shrinks
#   node_modules from ~500 MB (Nest CLI, ts-loader, webpack, TypeScript,
#   @types, angular-devkit, …) down to ~50 MB — the actual runtime deps.
# ═══════════════════════════════════════════════════════════════════════════
FROM base AS prod-deps
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus --production

# ═══════════════════════════════════════════════════════════════════════════
# RUNTIME — the final image. Only what a running container needs.
#   This is the ONLY stage that ends up in the pushed image; every earlier
#   stage is discarded once this one is built.
# ═══════════════════════════════════════════════════════════════════════════
FROM ${NODE_IMAGE} AS runtime

# tini is a tiny init (~20 KB). It runs as PID 1, forwards signals to
# the app, and reaps any zombie child processes node might leave.
# Belt-and-suspenders for signal safety in K8s rolling updates.
RUN apk add --no-cache tini

WORKDIR /app

# NODE_ENV=production disables dev-only code paths in Nest, Express, and
# many libraries — smaller memory footprint, better performance.
ENV NODE_ENV=production \
    PORT=3000

# Copy in DEPENDENCY ORDER: least → most frequently changing.
# node_modules is set once per dep change; dist changes every code
# change. Putting node_modules first means editing app code doesn't
# invalidate the (huge) node_modules layer.
# `--chown=node:node` at COPY time is cheaper than a separate RUN chown.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder   --chown=node:node /app/dist/apps/api-gateway ./dist/apps/api-gateway
COPY                  --chown=node:node package.json ./

# The `node` images ship a pre-created `node` user (uid=1000, gid=1000).
# Kubernetes' PodSecurity `restricted` policy REQUIRES non-root — this
# habit means our images work in a hardened cluster out of the box.
USER node

EXPOSE 3000

# HEALTHCHECK uses `node -e` instead of curl/wget so we don't have to
# install another package into the runtime image. Now that Stage 6
# added a real /livez endpoint, we hit that and REQUIRE HTTP 200 —
# any other status (or connection error) means unhealthy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/livez', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# tini is PID 1 → node is PID 2. tini forwards SIGTERM/SIGINT to node
# and reaps zombie children. The `--` separates tini's own flags from
# the app command that follows.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/api-gateway/main"]
