# Runbook — copy-paste commands for this repo

Quick-reference commands, organized by task. Grep this file; don't re-read the stage docs.

Grows with each stage:
- **Stage 2** → local dev
- **Stage 3** → per-service Docker images + user-defined network
- **Stage 4** (upcoming) → Compose
- **Stage 9** (upcoming) → Kubernetes / `kind`

---

## Names & tags used in this repo

| Kind | Name | Notes |
|---|---|---|
| Image | `nestjs-gateway:naive` | Stage 2 — the deliberately-bad single-stage build |
| Image | `api-gateway:prod` | Stage 3 — production multi-stage build |
| Image | `users-service:prod` | Stage 3 — production multi-stage build |
| Container | `gw-prod` | Running `api-gateway:prod` |
| Container | `users-prod` | Running `users-service:prod` |
| Network | `appnet` | User-defined bridge for cross-container DNS |
| Host port | `3000` | api-gateway HTTP |
| Host port | `4001` | users-service TCP (only when testing users-service directly) |

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

One-liner smoke test after any change:

```bash
curl -sS -X POST http://localhost:3000/users -H 'content-type: application/json' \
  -d '{"name":"Smoke","email":"smoke@t.io"}' | jq .id \
  && curl -sS http://localhost:3000/users | jq 'length'
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

---

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
