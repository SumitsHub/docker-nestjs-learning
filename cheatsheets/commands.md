# Runbook — copy-paste commands for this repo

Quick-reference commands, organized by task. Grep this file; don't re-read the stage docs.

Grows with each stage:
- **Stage 2** → local dev
- **Stage 3** → per-service Docker images + user-defined network
- **Stage 4** → Compose (4-service stack: postgres, redis, users-service, api-gateway)
- **Stage 5** → image inspection & supply chain (dive, trivy, hadolint, distroless, digest pins, multi-arch, SBOM)
- **Stage 6** → K8s-ready wiring (Joi config, pino JSON logs, /livez /readyz, throttler, graceful shutdown, redis client)
- **Stage 9** (upcoming) → Kubernetes / `kind`

---

## Names & tags used in this repo

| Kind | Name | Notes |
|---|---|---|
| Image | `nestjs-gateway:naive` | Stage 2 — the deliberately-bad single-stage build |
| Image | `api-gateway:prod` | Stage 3+ — production multi-stage build (alpine) |
| Image | `api-gateway:distroless` | Stage 5 — distroless variant (nonroot uid 65532) |
| Image | `users-service:prod` | Stage 3+ — production multi-stage build (alpine) |
| Image | `users-service:distroless` | Stage 5 — distroless variant |
| Container | `gw-prod` | Running `api-gateway:prod` (standalone) |
| Container | `users-prod` | Running `users-service:prod` (standalone) |
| Compose service | `postgres`, `redis`, `users-service`, `api-gateway` | Stage 4+ — DNS names on the compose network (Stage 6 activated redis by default) |
| Compose project | `docker-nestjs-learning` | Prefix for network / volume names |
| Volume | `docker-nestjs-learning_postgres_data` | Stage 4 — Postgres durability |
| Volume | `docker-nestjs-learning_redis_data` | Stage 4 — Redis persistence |
| Network | `appnet` | Stage 3 — manual user-defined bridge (deprecated once you're using Compose) |
| Host port | `3000` | api-gateway HTTP |
| Host port | `4001` | users-service TCP (only when testing users-service directly) |
| Host port | `5432` | Postgres (published from compose for host `psql` access) |
| Host port | `6379` | Redis (published from compose for host `redis-cli` access) |

---

## Local dev — no Docker

Run both services on your host with hot reload. Two terminals.

```bash
# Install / update deps
yarn install

# Terminal 1 — users-service (TCP microservice)
yarn start:users

# Terminal 2 — api-gateway (HTTP)
yarn start:gateway
```

Rebuild without watching (production-shape output):

```bash
yarn build            # both apps
yarn build:gateway    # api-gateway only
yarn build:users      # users-service only

# Run the compiled output directly (matches what the container does)
node dist/apps/api-gateway/main
node dist/apps/users-service/main
```

Clean local artifacts:

```bash
rm -rf dist node_modules
yarn install
```

---

## Docker — build images

Build **from the repo root** — the build context needs `libs/`, `apps/`, `.yarnrc.yml`, etc.

```bash
# api-gateway
docker build -f apps/api-gateway/Dockerfile -t api-gateway:prod .

# users-service
docker build -f apps/users-service/Dockerfile -t users-service:prod .

# both, one after the other
docker build -f apps/api-gateway/Dockerfile   -t api-gateway:prod   . && \
docker build -f apps/users-service/Dockerfile -t users-service:prod .
```

Force a full rebuild (ignore layer cache):

```bash
docker build --no-cache -f apps/api-gateway/Dockerfile -t api-gateway:prod .
```

Pass a different Node base image (uses the `ARG NODE_IMAGE` in the Dockerfiles):

```bash
docker build --build-arg NODE_IMAGE=node:22-alpine@sha256:<digest> \
             -f apps/api-gateway/Dockerfile -t api-gateway:prod-pinned .
```

---

## Docker — run a single container

### api-gateway (HTTP)

```bash
# Foreground, auto-remove on exit
docker container run --rm -p 3000:3000 --name gw-prod api-gateway:prod

# Background (detached)
docker container run --rm -d -p 3000:3000 --name gw-prod api-gateway:prod

# Override env (e.g. point at a different users-service host/port)
docker container run --rm -d -p 3000:3000 --name gw-prod \
  -e USERS_SERVICE_HOST=some-host \
  -e USERS_SERVICE_PORT=4001 \
  api-gateway:prod

# Read-only root filesystem (production-shape hardening)
docker container run --rm -d -p 3000:3000 --name gw-prod \
  --read-only --tmpfs /tmp \
  api-gateway:prod
```

### users-service (TCP)

```bash
# Expose 4001 to host — only useful for direct testing; normally clients
# on the same Docker network talk to it internally via DNS.
docker container run --rm -d -p 4001:4001 --name users-prod users-service:prod
```

### Flag cheatsheet (the ones you use every day)

| Flag | Meaning |
|---|---|
| `-d` | Detached (background) |
| `--rm` | Auto-remove the container when it exits |
| `-p HOST:CONTAINER` | Publish container port to host port |
| `--name NAME` | Assign a name (so `docker stop NAME` works) |
| `-e KEY=VAL` | Set an environment variable |
| `--network NAME` | Attach to a user-defined network |
| `-v /host:/container` | Bind-mount a host path (dev only) |
| `--user 1000:1000` | Override the USER baked into the image |
| `--read-only` | Root filesystem is read-only (add `--tmpfs /tmp` if the app writes temp files) |
| `--memory 256m --cpus 0.5` | cgroup limits — preview what K8s resources.limits do |

---

## Docker — run both services together (user-defined network)

The pattern Compose will automate in Stage 4 and Kubernetes will formalize as `Service`.

```bash
# 1. One-time: create the network
docker network create appnet

# 2. Start users-service on the network (no host port publish needed;
#    the gateway reaches it internally by container name)
docker container run --rm -d --name users-prod --network appnet users-service:prod

# 3. Start api-gateway on the same network; tell it where users-service lives
#    by CONTAINER NAME (Docker's embedded DNS resolves it to the current IP)
docker container run --rm -d --name gw-prod --network appnet \
  -p 3000:3000 \
  -e USERS_SERVICE_HOST=users-prod \
  api-gateway:prod

# 4. Verify both are up
docker container ls --filter network=appnet
docker container logs gw-prod
docker container logs users-prod
```

Tear down:

```bash
docker container stop gw-prod users-prod
docker container rm   gw-prod users-prod   # only if you didn't use --rm
docker network rm appnet
```

---

## Networking modes — which one and why

Every way you can connect two containers, and why we pick the user-defined bridge.

| Mode | Peer discovery | Works cross-OS? | Isolation | K8s-aligned? |
|---|---|---|---|---|
| **User-defined bridge** (what we use) | ✅ by container name via embedded DNS | ✅ | ✅ | ✅ mirrors `ClusterIP` Service |
| Default `bridge` (no `--network`) | ❌ IP only, no name DNS | ✅ | ✅ | ❌ |
| Publish to host + `host.docker.internal` | ✅ but via extra host hop | ⚠️ needs different flag on Linux vs Desktop | ⚠️ exposes internal service on host | ❌ |
| `--network host` | ✅ everything is `localhost` | ❌ Linux-only | ❌ shared with host | ❌ |
| `--link` (deprecated) | ✅ | ✅ | ✅ | ❌ — do not use |

### The failure modes to recognize

**Default bridge — DNS doesn't work by name.** Docker's built-in `bridge` network deliberately omits name resolution (legacy behavior).

```bash
docker container run -d --name users-prod users-service:prod
docker container run -d --name gw-prod -p 3000:3000 \
  -e USERS_SERVICE_HOST=users-prod \
  api-gateway:prod

curl http://localhost:3000/users
#   → ECONNREFUSED / 500 — "users-prod" doesn't resolve to an IP
#   Workaround (bad): docker inspect users-prod → grab IP → pass as env
#   The IP changes on every restart.
```

**Host-loopback workarounds** — flag differs by platform, so scripts break:

```bash
# Docker Desktop (Mac / Windows / WSL2 with the DD backend)
docker container run -d --name users-prod -p 4001:4001 users-service:prod
docker container run -d --name gw-prod -p 3000:3000 \
  -e USERS_SERVICE_HOST=host.docker.internal \
  api-gateway:prod

# Plain Linux Docker Engine — host.docker.internal doesn't exist by default
docker container run -d --name gw-prod -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e USERS_SERVICE_HOST=host.docker.internal \
  api-gateway:prod
```

Works, but you've now exposed `users-service` on the host (`-p 4001:4001`) for no operational reason, and you added a network hop (container → host → container).

**`--network host`** — Linux-only, kills isolation, port collisions with anything else on the host. Avoid.

### Why user-defined bridge maps 1:1 to Kubernetes

| Property | Docker user-defined bridge | Kubernetes |
|---|---|---|
| Reach peer by *name*, not IP | container name | `Service` name |
| Peer's IP changes silently → clients keep working | ✅ via embedded DNS | ✅ via kube-dns / CoreDNS |
| Internal service stays internal (no port publish) | ✅ (skip `-p`) | ✅ (`ClusterIP`) |
| Same env var works on laptop + prod | `USERS_SERVICE_HOST=users-prod` | `USERS_SERVICE_HOST=users-service` |

In Stage 4, Compose creates a user-defined network for you automatically and uses the *service name* as the DNS name. In Stage 9, Kubernetes creates a `Service` and the *Service name* is the DNS name. Same mental model, three layers.

---

## Docker Compose — the full stack in one command

Everything below assumes you're in the repo root (where `compose.yaml` lives).

### First-time setup

```bash
# Copy the env template to a real .env (gitignored)
cp .env.example .env
# Edit .env if you want non-default POSTGRES_PASSWORD etc.
```

### Bring the stack up

```bash
docker compose up --build           # build+start; foreground (Ctrl-C stops)
docker compose up --build -d        # ...detached
docker compose ps                   # show running services + health
docker compose config               # dry-run: expand ${VAR} and validate syntax
docker compose config --services    # list service names only
```

### Profiles — opt-in services

Services with a `profiles: [name]` in `compose.yaml` are skipped unless you name the profile. (Stage 6 removed the last one — `redis` now starts by default. If you later add a devtools profile for something like `adminer`, the same commands apply.)

```bash
docker compose --profile devtools up --build          # include devtools-profile services
docker compose --profile devtools config --services   # confirm what's included
docker compose --profile devtools down                # tear down services under that profile too
```

Multiple profiles: repeat the flag → `--profile a --profile b ...`.

### Tail logs

```bash
docker compose logs -f              # all services
docker compose logs -f users-service        # one service
docker compose logs --tail 50 postgres      # last N lines of one service
docker compose logs --since 2m              # last 2 minutes across all
```

### Poke at a running service

```bash
docker compose exec users-service sh                     # shell
docker compose exec postgres psql -U postgres -d appdb   # one-off psql
docker compose exec redis redis-cli                      # redis interactive
docker compose exec postgres pg_isready -U postgres      # manual healthcheck
```

### Restart / stop / start

```bash
docker compose restart api-gateway   # bounce one service
docker compose stop                  # stop all, KEEP containers + volumes
docker compose start                 # resume stopped containers
docker compose down                  # stop + remove containers + network (keep volumes)
docker compose down -v               # ...and DELETE named volumes (destructive)
```

### Rebuild after code changes

```bash
docker compose up --build             # rebuild changed images, restart affected
docker compose build --no-cache users-service   # force full rebuild of one service
docker compose pull                   # fetch newer base images (postgres, redis)
```

### Inspect databases from the host

```bash
# Postgres — .env's POSTGRES_PORT is published to the host
psql -h localhost -U postgres -d appdb -c 'SELECT * FROM users;'

# Redis — .env's REDIS_PORT is published to the host
redis-cli -h localhost -p 6379 PING
```

### One-liner: nuke & repave

```bash
# Full reset — destroys DB data too
docker compose down -v && docker compose up --build -d && docker compose logs -f
```

---

## Image inspection & supply chain (Stage 5)

### `dive` — layer explorer

```bash
dive api-gateway:prod
dive api-gateway:distroless

# CI-friendly mode (fails if efficiency < 95%)
CI=true dive --ci --lowestEfficiency=0.95 api-gateway:prod
```

### `trivy` — CVE / secret / misconfig scanner

```bash
# First run downloads the vuln DB (~200 MB); subsequent runs are fast
trivy image api-gateway:prod
trivy image --severity CRITICAL,HIGH api-gateway:prod
trivy image --severity CRITICAL,HIGH api-gateway:distroless

# Scan the Dockerfile source (misconfigs, no CVE data)
trivy config apps/api-gateway/Dockerfile

# Scan the whole repo (secrets, IaC)
trivy fs .

# JSON output for CI
trivy image --format json --output /tmp/scan.json api-gateway:prod

# Update the vuln DB manually
trivy image --download-db-only
```

### `hadolint` — Dockerfile linter

```bash
hadolint apps/api-gateway/Dockerfile
hadolint apps/users-service/Dockerfile
hadolint --ignore DL3018 apps/api-gateway/Dockerfile   # skip specific rule
```

### Digest pinning

```bash
# Get the current digest of a tag
docker image inspect node:22-alpine --format '{{index .RepoDigests 0}}'

# Build with a pinned digest via our Dockerfile's NODE_IMAGE ARG
docker build \
  --build-arg NODE_IMAGE=node:22-alpine@sha256:16e22a550f... \
  -f apps/api-gateway/Dockerfile \
  -t api-gateway:pinned .
```

### Multi-arch buildx

```bash
# One-time: create a multi-platform builder
docker buildx create --name multi --driver docker-container --use
docker buildx inspect --bootstrap
docker buildx ls

# Build for both platforms (no --load / --push → cross-check only)
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f apps/api-gateway/Dockerfile \
  -t api-gateway:multi .

# Actual multi-arch push (Stage 8):
#   ... --push -t ghcr.io/USER/api-gateway:v1.0.0 .
```

### SBOM (Software Bill of Materials)

```bash
# With buildx (attaches SBOM as image attestation)
docker buildx build --sbom=true --provenance=true \
  -f apps/api-gateway/Dockerfile -t api-gateway:with-sbom --load .

# With syft (standalone tool, richer output)
syft api-gateway:prod
syft api-gateway:prod -o cyclonedx-json > /tmp/api-gateway.sbom.json
syft api-gateway:prod -o spdx-json      > /tmp/api-gateway.sbom.spdx.json
```

### Distroless — build the variants

```bash
docker build -f apps/api-gateway/Dockerfile.distroless   -t api-gateway:distroless   .
docker build -f apps/users-service/Dockerfile.distroless -t users-service:distroless .

# Verify non-root uid
docker container run --rm api-gateway:distroless \
  /nodejs/bin/node -e 'console.log(process.getuid(), process.geteuid())'
#   → 65532 65532

# Prove no shell (this SHOULD fail on distroless)
docker container run --rm --entrypoint sh api-gateway:distroless -c echo
#   → exec /bin/sh: no such file or directory  ← the whole point
```

---

## Hit the API (via `curl`)

Assumes `api-gateway` is reachable at `http://localhost:3000`.

```bash
# Create a user (201)
curl -sS -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}' | jq

# List users (200)
curl -sS http://localhost:3000/users | jq

# Get one by id
USER_ID=<paste-from-create>
curl -sS "http://localhost:3000/users/$USER_ID" | jq

# Validation failure (400 from ValidationPipe)
curl -sS -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"nope"}' | jq

# Missing user (404)
curl -sS "http://localhost:3000/users/does-not-exist" | jq

# Show only HTTP status codes
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/users
```

# One-liner smoke test after any change:

```bash
curl -sS -X POST http://localhost:3000/users -H 'content-type: application/json' \
  -d '{"name":"Smoke","email":"smoke@t.io"}' | jq .id \
  && curl -sS http://localhost:3000/users | jq 'length'
```

### Health probes (Stage 6)

```bash
# Liveness — process alive?
curl -sS http://localhost:3000/livez  | jq

# Readiness — upstream deps reachable? (users-service TCP + redis)
curl -sS http://localhost:3000/readyz | jq

# Status-only
curl -sS -o /dev/null -w "livez: %{http_code}\nreadyz: %{http_code}\n" \
  http://localhost:3000/livez  \
  http://localhost:3000/readyz

# Rate-limit test (default: 60 req / minute / IP)
for i in $(seq 1 70); do
  curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/users
done | sort | uniq -c
```

### Simulate an upstream outage (readiness experiment)

```bash
curl -sS http://localhost:3000/readyz | jq   # expect status: ok
docker compose stop redis
curl -sS http://localhost:3000/readyz | jq   # expect status: error, redis: down
curl -sS -o /dev/null -w "livez: %{http_code}\n" http://localhost:3000/livez  # still 200
docker compose start redis
```

---

## Inspect & debug

### Logs

```bash
docker container logs gw-prod                # all logs so far
docker container logs -f gw-prod             # follow (Ctrl-C to stop)
docker container logs --tail 50 gw-prod      # last 50 lines
docker container logs --since 1m gw-prod     # last minute
```

### Exec into a running container

```bash
# Interactive shell (alpine has `sh`, not `bash`)
docker container exec -it gw-prod sh

# One-off command
docker container exec gw-prod id                    # who am I?
docker container exec gw-prod ps -o pid,user,args   # PID tree
docker container exec gw-prod ls /app
docker container exec gw-prod env                   # runtime env vars
```

### Inspect image contents without running

```bash
# Poke around a stopped/never-run image
docker container run --rm -it api-gateway:prod sh

# Directory sizes inside
docker container run --rm api-gateway:prod \
  sh -c 'du -sh /app/* 2>/dev/null | sort -h'
```

### Layer & metadata

```bash
docker image ls | grep -E 'REPOSITORY|api-gateway|users-service|nestjs-gateway'
docker image history api-gateway:prod
docker image inspect api-gateway:prod --format '{{.Size}}' | \
  awk '{printf "%.1f MB\n", $1/1024/1024}'
docker image inspect api-gateway:prod --format '{{.Config.Cmd}} / user={{.Config.User}} / workdir={{.Config.WorkingDir}}'
```

### Signal handling test

```bash
docker container run --rm -d --name sig-test api-gateway:prod
sleep 2
time docker container stop sig-test          # expect sub-second
```

### See what's actually in your build context (debug .dockerignore)

```bash
docker build --no-cache -f - . <<'EOF' 2>/dev/null | tail -30
FROM alpine
COPY . /ctx
RUN du -sh /ctx /ctx/* 2>/dev/null | sort -h | tail -20
EOF
```

---

## Cleanup

Safe, targeted:

```bash
# Stop everything from THIS project by name
docker container stop gw-prod gw-naive users-prod 2>/dev/null
docker container rm   gw-prod gw-naive users-prod 2>/dev/null

# Remove this project's images
docker image rm api-gateway:prod users-service:prod nestjs-gateway:naive 2>/dev/null

# Remove this project's network
docker network rm appnet 2>/dev/null
```

Global (careful — affects other Docker projects on this machine):

```bash
docker container prune       # remove all stopped containers
docker image prune           # remove dangling (untagged) images
docker image prune -a        # remove all images not used by a container
docker volume prune          # remove unused volumes
docker network prune         # remove unused user-defined networks
docker system df             # how much disk is Docker using?
docker system prune          # containers + networks + dangling images (moderate)
docker system prune -a --volumes    # NUKE everything unused (careful)
```

## Git — the tags we set per stage

```bash
git tag -l 'stage-*'                  # list stage tags
git checkout stage-02-complete        # jump to the milestone
git checkout main                     # come back
git log --grep 'stage-03' --oneline   # show all commits from a stage
```

---

## Common oops → fix

| Symptom | Cause | Fix |
|---|---|---|
| `docker build` → `error getting credentials … secretservice` | BuildKit called `docker-credential-secretservice` from Rancher Desktop leftovers | `~/.docker/config.json` = `{ "credsStore": "", "credHelpers": {} }` — one-time |
| `docker build` → `docker/dockerfile:1.7` credentials error | BuildKit needed to pull its frontend image | `docker pull docker/dockerfile:1.7` once, then rebuild |
| Container starts, curl returns connection refused | App bound to `127.0.0.1` instead of `0.0.0.0` | Bind to `0.0.0.0` (loopback inside a container is invisible from outside) |
| `docker container exec X ps -o pid,user,cmd` fails | Alpine's BusyBox `ps` doesn't have `-o cmd` | Use `-o args` |
| `nest can't resolve dependencies of UsersController` | Circular import via injection token | Move token to its own `*.tokens.ts` file |
| Compiled main.js not at `dist/apps/<app>/main.js` | `webpack: false` + monorepo path aliases | Set `webpack: true` in `nest-cli.json` |
| `getaddrinfo EAI_AGAIN <container-name>` | Old container is still running on an old network, looking for a peer that no longer exists on that network | `docker container rm -f <old>` + `docker network rm <old-net>`, then bring up the current stack |
| `docker compose up` seems to succeed but only some services start | A leftover container from a previous stage is squatting on a host port (e.g. `3000`) that Compose wants to bind | Tear down the older stack (see runbook § Cleanup) before `compose up` |
