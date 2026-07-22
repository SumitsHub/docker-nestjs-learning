# Stage 6 — 12-Factor & K8s readiness

**Time:** ~2 hours (understanding + coding + verifying with actual probe hits)
**Goal:** Turn the two Nest apps from "runs in Docker" into "runs in Kubernetes without surprises" — validated env config, JSON logs, graceful shutdown, real liveness/readiness endpoints, rate limiting, and Redis wired in for real. Every change here maps directly to a K8s primitive.

---

## What you'll walk away with

- **Config validation with Joi** — both apps refuse to boot on a bad env instead of exploding at request time
- **Structured JSON logs** to stdout via `nestjs-pino` — the format K8s log collectors expect
- **Graceful shutdown** via `app.enableShutdownHooks()` + `OnApplicationShutdown` — DB & Redis connections close cleanly on SIGTERM
- **`/livez` + `/readyz`** in api-gateway via `@nestjs/terminus` — with downstream checks (users-service TCP + Redis)
- **Rate limiting** globally in api-gateway via `@nestjs/throttler`
- **Redis wired in for real** — used by `/readyz`; shared client via `RedisModule`
- **Dockerfile HEALTHCHECKs** upgraded to hit `/livez`

---

## Part A — Mental model: what "K8s-ready" actually means

Kubernetes runs your Pod in a hostile-by-default world. It will:

- **Kill you and restart you** for reasons that have nothing to do with your code (node maintenance, autoscaler resizing, spot instance reclaims).
- **Send SIGTERM and wait `terminationGracePeriodSeconds` (default 30s)** for you to clean up, then SIGKILL.
- **Check your `livenessProbe`** periodically — fail it too many times and K8s restarts your Pod.
- **Check your `readinessProbe`** periodically — fail it and K8s removes your Pod from the Service load balancer *without* restarting.
- **Ingest your `stdout`/`stderr`** into a cluster-wide log store — anything you write to files is invisible.
- **Inject config as env vars and Secrets** — hardcoded config is a Pod that can't be moved.
- **Autoscale on metrics** (`HorizontalPodAutoscaler`) — every replica must be truly stateless and interchangeable.

So a "K8s-ready" app:

1. **Reads all config from env vars, validated at boot.**
2. **Logs one JSON object per line to stdout.**
3. **Handles SIGTERM cleanly** — stops accepting new requests, finishes in-flight ones, closes DB/Redis/HTTP connections, exits well within grace period.
4. **Serves a cheap `/livez`** (is the process alive?) and a **meaningful `/readyz`** (are my dependencies reachable?).
5. **Doesn't hold in-memory state** that peers depend on. Rate limits, sessions, caches — all shared, or explicitly per-pod.

Every subsection below teaches one of these disciplines.

---

## Part B — Install the new dependencies

```bash
yarn add joi nestjs-pino pino-http @nestjs/terminus @nestjs/throttler ioredis
yarn add -D pino-pretty
```

- **`joi`** — schema validation for env vars (via `@nestjs/config`'s `validationSchema` option)
- **`nestjs-pino` + `pino-http`** — the fastest structured logger for Node, wrapped for Nest
- **`pino-pretty`** (dev only) — human-readable colored output when `NODE_ENV !== 'production'`
- **`@nestjs/terminus`** — health check framework with built-in indicators (HTTP, TypeORM, Microservice) + hooks for custom ones
- **`@nestjs/throttler`** — rate limiter (in-memory by default; Redis storage as a swap-in later)
- **`ioredis`** — the well-maintained Node Redis client

Verify they landed in `package.json`.

---

## Part C — Config validation with Joi

Both `app.module.ts` files now pass a `validationSchema` to `ConfigModule.forRoot`. The schemas declare every env var this app reads, its type, defaults, and constraints. If anything is missing or malformed, Nest **refuses to start** with a readable list of errors — no more "why is `process.env.DB_PORT` `undefined`?" at first request.

### Interlude — the two-layer config model (why `.env` names ≠ container names)

There are two distinct "envs" at play in this repo, and one is not the other:

```
┌──────────────────────┐    ┌────────────────────────┐    ┌───────────────────┐
│  .env (repo root)    │    │  compose.yaml          │    │  container / app  │
│                      │─▶  │  environment:          │─▶  │  process.env      │
│  DB_USER=x           │    │    DB_USER: ${DB_USER} │    │  DB_USER=x        │
│  DB_HOST_PORT=5432   │    │    ports:              │    │  (never sees      │
│                      │    │      "${DB_HOST_PORT}: │    │   DB_HOST_PORT)   │
│                      │    │       5432"            │    │                   │
└──────────────────────┘    └────────────────────────┘    └───────────────────┘
       ▲                            ▲                             ▲
       │                            │                             │
   read by Compose             substitutes ${…}           read by ConfigService
   CLI at `up` time            into container env           inside the app
```

- **`.env`** is read by the **Compose CLI** to fill `${VAR:-default}` in `compose.yaml`.
- **`compose.yaml`'s `environment:` block** decides what the **container's** `process.env` actually contains.
- **The app's `validationSchema`** validates what the container / process sees.

### Why we harmonized the names

In Stage 4 we had `.env` using `POSTGRES_USER` while the app's schema expected `DB_USER`. That mismatch is a silent-drift trap: `docker compose up` works (compose translates one to the other), but `yarn start:users` on the host reads `.env` directly, sees `POSTGRES_USER`, doesn't find `DB_USER` — and falls back to the Joi default. Change the value in `.env` and only compose picks it up.

**Fix (applied here in Stage 6):** unify the names — `.env` uses `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST_PORT`. The postgres image still needs its own `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, but we source those from our unified vars inside `compose.yaml`:

```yaml
postgres:
  environment:
    POSTGRES_USER: ${DB_USER:-postgres}
    POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
    POSTGRES_DB: ${DB_NAME:-appdb}
```

Now the same names work in `.env`, in the container env, in the app schema, and in `yarn start:users` on the host. No drift.

`DB_HOST_PORT` is deliberately different — it's the *host-side* port publish (for `psql` from your laptop), never seen by the app. The app inside the container always talks to `postgres:5432` (the internal port, fixed).

### In production (K8s)

**There is no `.env` file at all.** Each Deployment gets its own `ConfigMap` + `Secret` mounted as env vars:

```yaml
# Stage 9 will do this for real
containers:
  - name: users-service
    envFrom:
      - configMapRef: { name: users-service-config }   # DB_HOST, DB_PORT, DB_NAME
      - secretRef:    { name: users-service-secrets }  # DB_PASSWORD
```

No shared file, no cross-service contamination, secrets rotated independently. The `.env` file in this repo is a **local-dev convenience only** — production consumers only care that the app reads `DB_USER` from `process.env`, not where it came from.

### The Joi schema itself

Example from [`apps/api-gateway/src/app.module.ts`](../../apps/api-gateway/src/app.module.ts):

```ts
validationSchema: Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('production'),
  PORT: Joi.number().port().default(3000),
  USERS_SERVICE_HOST: Joi.string().default('127.0.0.1'),
  USERS_SERVICE_PORT: Joi.number().port().default(4001),
  REDIS_URL: Joi.string().uri({ scheme: ['redis'] }).default('redis://127.0.0.1:6379'),
}),
validationOptions: { abortEarly: false, allowUnknown: true },
```

- `abortEarly: false` — report *all* schema failures at once, not just the first one.
- `allowUnknown: true` — env vars beyond the schema are OK (K8s injects lots of them: `HOSTNAME`, `KUBERNETES_*`, etc.).

**Test it yourself:** set `PORT=not-a-number yarn start:gateway` and watch it refuse to boot with a schema-violation message.

---

## Part D — Structured JSON logs (nestjs-pino)

Two changes:

1. `AppModule` imports `LoggerModule.forRootAsync(...)` — configures pino:
   - `production` → raw JSON to stdout, one object per line
   - non-production → pretty-printed via `pino-pretty`
2. `main.ts` calls `NestFactory.create(AppModule, { bufferLogs: true })` and then `app.useLogger(app.get(Logger))` — so bootstrap logs also go through pino.

Verify in dev:

```bash
NODE_ENV=development yarn start:gateway
# → colorized pretty output
```

Verify in prod-shape:

```bash
NODE_ENV=production node dist/apps/api-gateway/main | head -3
# → one JSON object per line, ready for Loki/Datadog/Fluent Bit
```

**Why this matters for K8s:** cluster log collectors like Fluent Bit, Loki, or Datadog Agent parse container stdout line-by-line. If your logs are one-JSON-per-line, every field (`level`, `time`, `msg`, `context`, `reqId`, …) is queryable. If they're free-text with multi-line stack traces, you get soup.

---

## Part E — Graceful shutdown

Two levers:

1. **`app.enableShutdownHooks()`** in both `main.ts` — tells Nest to listen for SIGTERM/SIGINT and run every module's `OnApplicationShutdown` / `OnModuleDestroy` before exit.
2. **`OnApplicationShutdown` in modules that own connections** — `RedisModule` implements it and calls `redis.quit()`. TypeORM does the same automatically once shutdown hooks are enabled — it destroys the DataSource, returning all pool connections cleanly.

**Prove it in a container:**

```bash
docker compose up --build -d
# Watch redis quit cleanly in the logs
docker compose logs -f api-gateway &
docker compose stop api-gateway
# → api-gateway logs a "SIGTERM → shutting down" style message; sub-second stop
```

Without `enableShutdownHooks`, the container would still stop (tini + node handle signals), but Redis sockets would just close abruptly and TypeORM would leave dangling pool connections that Postgres eventually times out. Invisible in dev; visible under load.

---

## Part F — Health endpoints via `@nestjs/terminus`

New files (api-gateway only — users-service stays pure TCP; K8s does `tcpSocket` probes for it):

| File | Role |
|---|---|
| [`apps/api-gateway/src/health/health.module.ts`](../../apps/api-gateway/src/health/health.module.ts) | Wires Terminus + our custom Redis indicator |
| [`apps/api-gateway/src/health/health.controller.ts`](../../apps/api-gateway/src/health/health.controller.ts) | `GET /livez`, `GET /readyz` |
| [`apps/api-gateway/src/health/indicators/redis.indicator.ts`](../../apps/api-gateway/src/health/indicators/redis.indicator.ts) | Custom indicator: pings Redis; up/down |

### `/livez` — liveness

**Trivial by design.** Just returns 200 if the Nest app booted. K8s uses this to decide whether to **RESTART** the pod. If it checks anything that can fail transiently (like DB), you get **restart loops** during downstream outages — which turn a Postgres blip into a service-wide meltdown.

### `/readyz` — readiness

Checks:
- `users-service` reachable over TCP (via `MicroserviceHealthIndicator.pingCheck`)
- `redis` reachable (via our custom `RedisHealthIndicator`)

K8s uses this to decide whether to **route traffic** to the pod. Fail readiness → K8s pulls you out of Service endpoints, doesn't restart you. Perfect for graceful degradation during upstream flaps.

Hit them (after `docker compose up`):

```bash
curl -sS http://localhost:3000/livez  | jq
# { "status": "ok", "info": {}, "error": {}, "details": {} }

curl -sS http://localhost:3000/readyz | jq
# { "status": "ok",
#   "info": { "users-service": {…}, "redis": {…} },
#   "error": {}, "details": {…} }

# Break redis and re-hit /readyz
docker compose stop redis
curl -sS http://localhost:3000/readyz | jq
# { "status": "error", "error": { "redis": { "status": "down", … } } }

# /livez still 200 — process is alive, don't restart me
curl -sS -o /dev/null -w "livez: %{http_code}\n" http://localhost:3000/livez
docker compose start redis
```

That's the difference between liveness and readiness, in one experiment.

---

## Part G — Redis wired in for real

Two new files under `apps/api-gateway/src/redis/`:

| File | Role |
|---|---|
| [`redis.tokens.ts`](../../apps/api-gateway/src/redis/redis.tokens.ts) | `REDIS_CLIENT` injection token |
| [`redis.module.ts`](../../apps/api-gateway/src/redis/redis.module.ts) | Provides an `ioredis` client from `REDIS_URL`, `@Global()`, closes on shutdown |

Any feature module can now `@Inject(REDIS_CLIENT) private redis: Redis`. The `RedisHealthIndicator` already does. Stage 7 will let the `ThrottlerModule` do the same (Redis-backed rate limiting).

Compose changes:
- **Removed `profiles: ["cache"]` from `redis`** — it now starts by default (still without a host port publish, so no conflict with your local redis).
- **Added `REDIS_URL: redis://redis:6379`** to api-gateway's `environment:` — DNS-by-service-name pattern, third layer of the same idea (host → compose → k8s).

---

## Part H — Rate limiting (`@nestjs/throttler`)

`ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }])` — 60 requests / minute / IP, applied globally via `APP_GUARD`.

**Test it:**

```bash
# Loop 70 requests quickly
for i in $(seq 1 70); do
  curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/users
done | sort | uniq -c
# → ~60 lines of "200", then ~10 lines of "429" once the bucket is exhausted
```

Response body on 429:

```json
{ "statusCode": 429, "message": "ThrottlerException: Too Many Requests" }
```

### K8s realism check

The default in-memory storage means **each Pod counts independently.** Scale to 3 Pods → your effective per-user limit becomes 180/min, not 60/min. To share the budget across Pods you need Redis-backed storage (`@nest-lab/throttler-storage-redis` or similar). Stage 7 wires that up.

---

## Part I — Dockerfile HEALTHCHECK now hits `/livez`

Updated in both api-gateway Dockerfiles (alpine + distroless):

```dockerfile
# alpine (shell form)
HEALTHCHECK ... CMD node -e "require('http').get('http://127.0.0.1:3000/livez', \
  r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# distroless (exec form — no shell)
HEALTHCHECK ... CMD ["/nodejs/bin/node", "-e", \
  "require('http').get('http://127.0.0.1:3000/livez', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
```

Now the check enforces **200 status**, not just "any response." Which means the HEALTHCHECK actually reflects app health.

Users-service Dockerfile is unchanged — it stays TCP-only. K8s handles that with a `tcpSocket` liveness probe on port 4001 (no HTTP needed).

---

## Part J — Bring it all up

```bash
# From the repo root
docker compose up --build

# In another terminal:
curl -sS http://localhost:3000/livez  | jq
curl -sS http://localhost:3000/readyz | jq

# See the JSON logs (production-shape inside the container)
docker compose logs -f api-gateway | head -20

# Try the redis-outage experiment from Part F
docker compose stop redis
curl -sS http://localhost:3000/readyz | jq
docker compose start redis

# Try the rate-limit test from Part H
for i in $(seq 1 70); do
  curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/users
done | sort | uniq -c
```

Fill in [NOTES.md](NOTES.md) as you go.

---

## Part K — What we deliberately deferred

- **Redis-backed throttler storage** (shared rate-limit budget across pods) → Stage 7 or later
- **Redis for actual caching** (e.g., cache `GET /users` for 30s) → future
- **TypeORM migrations** replacing `synchronize: true` → Stage 7
- **`compose watch` for hot reload** during dev → Stage 7
- **SLSA provenance + Sigstore signing** → Stage 8 (CI + registry)

---

## Part L — Reflect, self-check, commit

Fill in [NOTES.md](NOTES.md). Try [CHALLENGES.md](CHALLENGES.md) without peeking. Commit in this shape:

```bash
# 1. Redis client + health module (new files)
git add apps/api-gateway/src/redis apps/api-gateway/src/health
git commit -m "feat(stage-06): api-gateway health endpoints + shared redis client

New /livez (trivial, K8s liveness) and /readyz (checks users-service TCP
and redis) via @nestjs/terminus. Custom RedisHealthIndicator pings redis.
Global RedisModule provides an ioredis client and closes it on
OnApplicationShutdown (requires enableShutdownHooks in main.ts).
Kept token in redis/redis.tokens.ts to avoid the circular-import trap."

# 2. Nest wiring — Joi + pino + throttler + shutdown hooks
git add apps/api-gateway/src/main.ts apps/api-gateway/src/app.module.ts \
        apps/users-service/src/main.ts apps/users-service/src/app.module.ts \
        package.json yarn.lock
git commit -m "feat(stage-06): 12-factor wiring — Joi config, pino logs, shutdown hooks, throttler

- ConfigModule Joi schemas fail fast on missing/invalid env vars.
- nestjs-pino: JSON logs to stdout in prod, pretty in dev.
- app.enableShutdownHooks() so RedisModule.onApplicationShutdown and
  TypeORM DataSource.destroy() run on SIGTERM.
- Global @nestjs/throttler: 60 req/min/IP (per-pod for now)."

# 3. Container + orchestration updates
git add apps/api-gateway/Dockerfile apps/api-gateway/Dockerfile.distroless \
        compose.yaml .env.example
git commit -m "build(stage-06): HEALTHCHECK hits /livez, redis un-hidden, REDIS_URL wired

HEALTHCHECK requires HTTP 200 from /livez (was any response from /).
redis service starts by default (removed 'cache' profile) but still
no host port publish — no conflict with local redis. api-gateway
gets REDIS_URL=redis://redis:6379."

# 4. Reflection
git add stages/06-twelve-factor-and-k8s-readiness/NOTES.md
git commit -m "docs(stage-06): reflection — /livez vs /readyz, JSON logs, graceful shutdown"

git tag -a stage-06-complete -m "Cluster-ready: probes, structured logs, graceful shutdown, rate limits"
git push --follow-tags
```

