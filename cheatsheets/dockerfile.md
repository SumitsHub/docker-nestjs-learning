# Dockerfile cheatsheet

Quick reference for the Dockerfile instructions we use across this repo. Not exhaustive — for edge cases see [docs.docker.com/reference/dockerfile](https://docs.docker.com/reference/dockerfile/).

## Mental model in one sentence

A Dockerfile is a **recipe**. Each instruction produces a **layer** — an immutable filesystem diff. Docker executes instructions top-to-bottom and caches layers by their inputs, so **order matters** for build speed.

---

## The instructions you'll actually use

### `FROM <image>[:<tag>][@<digest>] [AS <stage-name>]`
Sets the base image. Must be the first instruction (after optional `ARG`). `AS <name>` labels a build stage for multi-stage builds (Stage 3).

```dockerfile
FROM node:22-alpine AS builder
FROM node:22-alpine@sha256:abc… AS runtime   # digest-pinned = reproducible
```

### `WORKDIR /path`
Sets working directory for subsequent `RUN`, `COPY`, `ADD`, `CMD`, `ENTRYPOINT`. Creates the directory if missing. Prefer this over `RUN cd /path`.

### `COPY <src>... <dest>`
Copies files/dirs from the build context (the folder you passed to `docker build`) into the image. Honors `.dockerignore`.

```dockerfile
COPY package.json yarn.lock ./              # narrow copy — better cache
COPY --chown=node:node . /app               # set ownership at copy time
COPY --from=builder /app/dist ./dist        # copy from another build stage
```

Prefer `COPY` over `ADD` unless you specifically need `ADD`'s features (URL fetch, auto-extract of tarballs — both usually anti-patterns).

### `RUN <cmd>`
Executes a command during **build**, producing a new layer. Two forms:

```dockerfile
RUN yarn install --immutable                # shell form (runs via /bin/sh -c)
RUN ["yarn", "install", "--immutable"]      # exec form (no shell)
```

Chain related commands with `&&` and clean up in the *same* `RUN` — a separate `RUN` to delete files can't shrink prior layers.

```dockerfile
RUN apk add --no-cache curl \
 && curl -fsSL https://... | tar xz \
 && rm -rf /tmp/*
```

BuildKit adds cache and secret mounts (huge for CI):

```dockerfile
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm install
```

### `ENV KEY=value`
Sets environment variables that persist in the running container. Bakes into a layer — do **not** put secrets here (they're in every layer forever, visible via `docker history`).

```dockerfile
ENV NODE_ENV=production PORT=3000
```

### `ARG KEY[=default]`
**Build-time** variable. Not available at runtime unless you also `ENV` it. Scoped to the current stage.

```dockerfile
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine
```

Override with `docker build --build-arg NODE_VERSION=20`.

### `EXPOSE <port>[/<protocol>]`
**Documentation only** — does not publish the port. Publishing still requires `docker run -p host:container`. Useful for `docker run -P` (auto-publish) and for anyone reading the image.

### `USER <user>[:<group>]`
Sets the user (and optional group) for subsequent `RUN`, `CMD`, `ENTRYPOINT`. Every image should run as a non-root user in production. Node images ship with a pre-created `node` user (UID 1000).

```dockerfile
USER node
```

### `HEALTHCHECK`
Tells Docker how to check if the container is healthy.

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/livez || exit 1
```

**Kubernetes ignores this** — K8s uses its own liveness/readiness probes. But the *endpoint* is the same, so we'll build the healthcheck alongside `/livez` and `/readyz` in Stage 6.

### `CMD` and `ENTRYPOINT` — the one people always get wrong

These describe what runs when the container **starts**.

| Directive | Purpose | Overridable by `docker run <img> <cmd>`? |
|---|---|---|
| `CMD` | Default command | ✅ yes, easily overridden |
| `ENTRYPOINT` | Fixed executable; args come from `CMD` or `docker run` | ❌ no (needs `--entrypoint`) |

**Always use the exec (JSON array) form**, not the shell form:

```dockerfile
CMD ["node", "dist/apps/api-gateway/main"]                 # ✅ node is PID 1
CMD node dist/apps/api-gateway/main                        # ❌ /bin/sh -c is PID 1
```

The exec form means your process is PID 1 and receives signals directly (`SIGTERM`, `SIGINT`). The shell form spawns `/bin/sh -c` as PID 1, which does not forward signals — this is what makes `docker stop` take 10 seconds. Same problem happens when you use `yarn` or `npm run` as CMD (they don't forward SIGTERM either).

Combining them:

```dockerfile
ENTRYPOINT ["node"]
CMD ["dist/apps/api-gateway/main"]
# docker run image                → node dist/apps/api-gateway/main
# docker run image --version      → node --version
```

For our services we keep it simple: no `ENTRYPOINT`, just `CMD` in exec form.

### `LABEL key=value`
Metadata attached to the image. Great for image provenance ([OCI image spec labels](https://github.com/opencontainers/image-spec/blob/main/annotations.md)):

```dockerfile
LABEL org.opencontainers.image.source="https://github.com/SumitsHub/docker-nestjs-learning"
LABEL org.opencontainers.image.revision="$GIT_SHA"
```

---

## `.dockerignore` — how to shrink the build context

Lives at the repo root. Same syntax as `.gitignore`. Anything matched is **never sent to the Docker daemon** during `docker build`, so:

- Faster builds (less to transfer).
- No accidental leaks of `.env`, `.git`, editor caches into the image.
- No stale `node_modules` from your host breaking the container's install.

A good starter for a Node project:

```gitignore
node_modules
dist
.git
.gitignore
.dockerignore
Dockerfile*
compose*.yaml
README.md
.env
.env.*
coverage
.vscode
.idea
.DS_Store
stages
```

We'll add ours in Stage 3.

---

## Layer-caching rules that pay off forever

1. **Copy `package.json` + lockfile → `RUN install` → THEN copy source.** Deps change rarely; source changes constantly. Reverse the order and every code change re-installs everything.
2. **Combine related `RUN` commands** with `&&` to avoid intermediate layers.
3. **Clean up in the same `RUN`** that created the mess (apt/apk caches, downloaded tarballs).
4. **Use BuildKit cache mounts** (`--mount=type=cache`) so package manager caches persist across builds without landing in the image.
5. **Use multi-stage builds** so build-time tools never ship in the runtime image. (Stage 3.)

---

## When something's already in a Docker image — inspect it

```bash
docker image history <img>          # layer-by-layer view + size + creating command
docker image inspect <img>          # full JSON: env, user, workdir, cmd, entrypoint
docker container run --rm -it <img> sh   # poke around the filesystem
dive <img>                          # (Stage 5) explore layers interactively
```
