# Stage 4 — Compose orchestration + real state (Postgres + Redis)

**Time:** ~2 hours (understanding + coding + verifying)
**Goal:** Replace the manual `docker network create` + multiple `docker run` invocations with a single `compose.yaml` that also brings up Postgres (plus an opt-in Redis behind a profile). Migrate users-service from an in-memory `Map` to real Postgres storage via TypeORM. This is the biggest leap toward a real dev environment so far.

---

## What you'll walk away with

- `compose.yaml` at the repo root — describes 4 services declaratively
- `.env` + `.env.example` — 12-factor config, secrets never in source
- **users-service persisted to Postgres** via TypeORM (in-memory `Map` retired)
- api-gateway reaches users-service by **compose service name** (`users-service`) — same DNS mental model as K8s Services
- Startup ordering via `depends_on: condition: service_healthy` — no more "connect refused" during cold start
- Named volumes for Postgres and Redis — data survives `compose down`
- **First-class Compose profiles** — redis is defined but opt-in (`--profile cache`), so a plain `up` won't clash with any local redis you already run
- **One command to bring everything up:** `docker compose up --build`

---

## Part A — Compose mental model

Docker Compose is a YAML spec + CLI that reads `compose.yaml` and tells Docker Engine what to build and run. Anything you can do with `docker run` you can encode as a service. Compose adds three things that matter:

1. **Grouping.** All services in one file share a lifecycle: `up`, `down`, `logs`, `ps` act on the whole stack.
2. **User-defined network, automatic.** Compose creates one bridge network per project (`<project>_default`). Every service is reachable from every other service **by service name**. This is Stage 3's `appnet` — but you never have to say `docker network create`.
3. **Named volumes, declarative.** Declared in the file, managed by Docker, persist across `down` and `up`.

### What Compose is NOT

- **Not a production orchestrator.** That's Kubernetes / Nomad / ECS.
- **Not a build system** beyond Docker's own.
- **Not multi-host.** Everything runs on one Docker Engine.

Compose's whole job is **"one machine, many containers, described once."** Perfect for dev, CI, and single-node demo deployments. When we get to K8s (Stage 9), the exact same *concepts* map to manifests — services become Deployments+Services, volumes become PVCs, env becomes ConfigMaps/Secrets.

### The compose file, section by section

```yaml
name: <project-name>          # one-word namespace; becomes prefix for network + volume names

services:
  <service-name>:             # arbitrary, but this IS the DNS name other services use
    image: postgres:16-alpine # pull this image, OR ↓
    build:                    # build one from a Dockerfile
      context: .              # what to send as build context
      dockerfile: apps/api-gateway/Dockerfile
    image: api-gateway:prod   # (with build:) → name the built image
    environment:              # env vars for the running container
      KEY: value
      OTHER: ${VAR:-default}  # ← from .env or process.env
    env_file:                 # or read a whole .env file
      - path/to/.env
    volumes:
      - named_vol:/data       # named volume (durable)
      - ./host:/container     # bind mount (dev; changes visible immediately)
    ports:
      - "3000:3000"           # publish HOST:CONTAINER
    depends_on:
      other-service:
        condition: service_healthy  # wait for its HEALTHCHECK
    healthcheck:
      test: ["CMD-SHELL", "..."] # returning exit 0 = healthy
      interval: 5s
      retries: 10
      start_period: 5s
    restart: unless-stopped     # restart policy

volumes:
  named_vol:                    # declared here so it's Compose-managed

networks:                       # optional — Compose auto-creates a default one
```

You'll only use a fraction of this at first. Our `compose.yaml` uses ~half of these keys.

---

## Part B — Install the new dependencies (yarn)

users-service needs to talk to Postgres. Add these on the host:

```bash
yarn add @nestjs/typeorm typeorm pg @nestjs/config
yarn add -D @types/pg
```

- **`@nestjs/typeorm` + `typeorm`** — Nest's official ORM integration.
- **`pg`** — the node-postgres driver TypeORM uses under the hood.
- **`@nestjs/config`** — proper 12-factor config with an injectable `ConfigService`.

Verify they're in `dependencies` in `package.json` and that `yarn.lock` was updated.

---

## Part C — The compose file

Read [`compose.yaml`](../../compose.yaml) top-to-bottom. Comments in the file explain each stanza. Highlights:

- **Four services** defined: `postgres`, `redis`, `users-service`, `api-gateway`.
  - Three start with a plain `docker compose up`: postgres + the two apps.
  - `redis` is under **`profiles: ["cache"]`** so it's opt-in — skipped by default, brought up with `docker compose --profile cache up`. Nothing in Stage 4 code uses redis; it gets wired up in Stage 6.
- **`${VAR:-default}` interpolation** — env vars from `.env` with sensible fallbacks.
- **`build:` + `image:`** — Compose builds the image AND names it (so you can also `docker run` it standalone).
- **`depends_on: condition: service_healthy`** — cold-start ordering that actually waits.
- **Healthchecks on `postgres`** (`pg_isready`) and **`redis`** (`redis-cli ping`) — our two apps use the HEALTHCHECK baked into their Dockerfiles from Stage 3.
- **Named volumes** for postgres and redis at the bottom.

Then copy the env template locally (it's gitignored):

```bash
cp .env.example .env
```

Adjust values in `.env` if you like. The default `devpass` for `POSTGRES_PASSWORD` is fine for local dev. Never commit `.env`.

---

## Part D — Wire users-service to Postgres (via TypeORM)

Files changed/created in this stage:

| File | Change |
|---|---|
| [`apps/users-service/src/users/user.entity.ts`](../../apps/users-service/src/users/user.entity.ts) | **new** — TypeORM entity for `users` table |
| [`apps/users-service/src/app.module.ts`](../../apps/users-service/src/app.module.ts) | Imports `ConfigModule` and `TypeOrmModule.forRootAsync` |
| [`apps/users-service/src/users/users.module.ts`](../../apps/users-service/src/users/users.module.ts) | Imports `TypeOrmModule.forFeature([User])` |
| [`apps/users-service/src/users/users.service.ts`](../../apps/users-service/src/users/users.service.ts) | Uses `Repository<User>` instead of the `Map` |
| [`apps/api-gateway/src/app.module.ts`](../../apps/api-gateway/src/app.module.ts) | Imports `ConfigModule` for consistency |
| [`apps/api-gateway/src/users/users.module.ts`](../../apps/api-gateway/src/users/users.module.ts) | Injects `ConfigService` instead of `process.env` directly |

Key design notes:

- **The wire contract didn't change.** `UsersController` in users-service still speaks `UserDto`. The Repository is an implementation detail behind `UsersService`. This is why api-gateway needed **zero** changes.
- **`synchronize: true`** in TypeORM auto-creates the `users` table on startup. Convenient for learning; NEVER use it in production. Stage 7 replaces it with migrations.
- **`retryAttempts: 5, retryDelay: 1000`** — even with `depends_on: service_healthy`, Postgres can hiccup right after healthcheck-green. Retries prevent a false crash-loop.

Rebuild the apps locally to catch any TypeScript errors before Docker builds them:

```bash
yarn build
```

Should complete cleanly for both apps.

---

## Part E — Bring it up

Before your first `docker compose up`, tear down any Stage 3 leftovers so nothing squats on the ports Compose will bind:

```bash
# Stop and remove the standalone Stage 3 containers if they're still around
docker container rm -f gw-prod users-prod 2>/dev/null

# Remove the Stage 3 user-defined network (Compose will create its own)
docker network rm appnet 2>/dev/null
```

Now:

```bash
docker compose up --build           # build images and start everything (foreground)
```

Watch the startup order in the interleaved logs:
1. `postgres` starts (no dependencies).
2. Compose polls its healthcheck until green.
3. `users-service` starts, connects to Postgres, TypeORM auto-creates the `users` table.
4. Compose polls users-service's healthcheck (TCP connect on 4001) until green.
5. `api-gateway` starts, opens HTTP on 3000.

Note: `redis` is not in this list — it's behind the `cache` profile. To include it:

```bash
docker compose --profile cache up --build
```

Ctrl-C stops all four. Or run detached:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f              # tail all services (Ctrl-C to detach)
docker compose logs -f users-service  # tail one
```

### Verify end-to-end

```bash
# Hit the API
curl -sS -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}' | jq

curl -sS http://localhost:3000/users | jq

# Prove data really landed in Postgres
docker compose exec postgres \
  psql -U postgres -d appdb -c 'SELECT id, name, email, created_at FROM users;'

# Or from the host (POSTGRES_PORT is published)
psql -h localhost -U postgres -d appdb -c 'SELECT * FROM users;'
```

---

## Part F — Volumes: prove data survives restart

```bash
# 1. Create a user
curl -sS -X POST http://localhost:3000/users \
  -H 'content-type: application/json' \
  -d '{"name":"Grace Hopper","email":"grace@example.com"}' | jq

# 2. Stop and REMOVE all containers (no -v — volumes are kept)
docker compose down

# 3. Volume still exists on disk
docker volume ls | grep docker-nestjs-learning

# 4. Bring the stack back up
docker compose up -d

# 5. Data still there
curl -sS http://localhost:3000/users | jq

# 6. Now the destructive path — `-v` also removes named volumes
docker compose down -v
docker compose up -d
curl -sS http://localhost:3000/users | jq          # empty array — fresh table
```

The `-v` flag is what production ops-people would call "we don't ever run this in prod without shouting first." Volume = durability. In Kubernetes, the equivalent is a `PersistentVolumeClaim` — same mental model.

---

## Part G — Healthchecks: why `depends_on: service_healthy` matters

Try this experiment: sabotage the postgres healthcheck temporarily.

```yaml
# In compose.yaml, change postgres.healthcheck.test to always fail:
    healthcheck:
      test: ["CMD-SHELL", "false"]
```

```bash
docker compose down
docker compose up
```

You'll see:
- `postgres` starts, but its healthcheck keeps failing → status is `starting`, never `healthy`.
- `users-service` never starts (Compose waits for `service_healthy`).
- `api-gateway` never starts (depends on users-service which depends on postgres).

Reset the healthcheck back to `pg_isready` and re-up. This is exactly the mechanism Kubernetes uses:
- Compose `healthcheck` ≈ Kubernetes `readinessProbe`.
- `depends_on: service_healthy` ≈ K8s "don't send traffic to this Pod until its readinessProbe is green."

---

## Part H — Common compose commands (add these to your muscle memory)

```bash
docker compose up --build           # build+start; foreground (Ctrl-C stops)
docker compose up --build -d        # ...detached
docker compose ps                   # what's running?
docker compose logs -f              # tail all logs
docker compose logs -f users-service    # one service
docker compose exec users-service sh    # shell into a running container
docker compose exec postgres psql -U postgres -d appdb   # run a one-off command
docker compose restart api-gateway  # restart one service
docker compose stop                 # stop all, keep containers/volumes
docker compose start                # start previously-stopped containers
docker compose down                 # stop + remove containers + network (keep volumes)
docker compose down -v              # ...and delete named volumes (destructive)
docker compose config               # dry-run: expand env vars, validate syntax
docker compose build --no-cache users-service   # force full image rebuild
docker compose pull                 # pull newer versions of external images (postgres, redis)
```

They're mirrored in [cheatsheets/commands.md → Compose](../../cheatsheets/commands.md).

---

## Part I — What we deliberately deferred

- **`compose watch` for hot reload** → Stage 7 (dev workflows). Our images are prod-shaped; hot reload needs a dev-shaped image + bind mount.
- **Redis usage in code** → Stage 6 (rate-limiter / cache). The service is defined behind the `cache` profile; when we need it we'll either enable the profile OR point `REDIS_URL` at your existing local redis via env var.
- **`compose.override.yaml` for dev vs prod separation** → Stage 7.
- **TypeORM migrations** (replace `synchronize: true`) → Stage 7.
- **`@nestjs/config` schema validation** (Joi / Zod) → Stage 6.
- **Redis and Postgres passwords in Docker Secrets** → Stage 8 (CI + registry).

---

## Part J — Reflect, self-check, commit

Fill in [NOTES.md](NOTES.md). Try [CHALLENGES.md](CHALLENGES.md) without peeking. Then commit in this shape:

```bash
# 1. compose + env template
git add compose.yaml .env.example
git commit -m "build(stage-04): compose.yaml for 4-service stack + .env template

Services: postgres:16-alpine, redis:7-alpine, users-service, api-gateway.
Compose creates a project bridge network → services reach each other by
service-name DNS (same model as K8s Services). Named volumes for
postgres + redis data. depends_on: service_healthy for cold-start
ordering. Env template committed; actual .env gitignored."

# 2. users-service DB migration (in-memory → postgres)
git add apps/users-service package.json yarn.lock
git commit -m "feat(stage-04): users-service persists to postgres via TypeORM

Retired the in-memory Map. Added User entity, TypeOrmModule.forRootAsync
driven by @nestjs/config, TypeOrmModule.forFeature in UsersModule.
UsersService uses Repository<User> with a private toDto() so the wire
contract (UserDto) stays decoupled from the DB shape. synchronize:true
for now — migrations arrive in Stage 7."

# 3. api-gateway ConfigService (small cleanup)
git add apps/api-gateway
git commit -m "refactor(stage-04): api-gateway uses ConfigService for USERS_SERVICE_*

Consistency with users-service. Same env-var contract as before; the
difference is 12-factor discipline (ConfigService is injectable and
mockable in tests)."

# 4. reflection
git add stages/04-compose-multi-service/NOTES.md
git commit -m "docs(stage-04): reflection notes — one command, 4 services, data survives"

git tag -a stage-04-complete -m "Compose orchestration + real Postgres persistence"
git push --follow-tags
```

Ping me when it's up, or paste any error you see. Stage 5 (image slimming, distroless, `dive`, `trivy`, multi-arch) is next.
