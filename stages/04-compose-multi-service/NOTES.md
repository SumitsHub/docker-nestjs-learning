# Stage 4 — my notes

## What I built
- `compose.yaml` with 4 services (postgres, redis, users-service, api-gateway).
- `.env.example` template + local `.env` (gitignored) driving all `${VAR:-default}` interpolations.
- users-service now writes to Postgres via TypeORM (retired the in-memory Map).
- api-gateway migrated to `ConfigService` for env access.
- Startup ordering via `depends_on: condition: service_healthy` with healthchecks on postgres + redis.
- Named volumes so data survives `compose down`.

## The one-command experience
- `docker compose up --build` — 4 services in the correct order, ✅ / ✗ ?
- `docker compose ps` output (paste or summarize):
  -

## Volume durability experiment (Part F)
- [ ] Created a user via curl.
- [ ] `docker compose down` (kept volumes) → `up` → user still there.
- [ ] `docker compose down -v` (destroyed volumes) → `up` → users table empty (schema re-created fresh by `synchronize: true`).

## Healthcheck sabotage experiment (Part G)
- [ ] Set postgres healthcheck to `["CMD-SHELL","false"]`.
- [ ] Confirmed users-service never started, api-gateway never started (cascade).
- [ ] Restored healthcheck; stack came up.
- Insight: `depends_on` without `condition: service_healthy` waits only for the container *process* to start — not for the service to be *ready*. That's why the deeper condition matters.

## What surprised me
-

## What I'd still fix
- `synchronize: true` is convenient but scary. Stage 7's migrations. **The pattern:** first-class TypeORM migration files checked into the repo, run as a separate container/step during deploy.
- No secret management yet — DB password is in `.env` on disk. Stage 8 covers Docker Secrets / GitHub Actions secrets.
- Redis is in the stack but nothing uses it yet. Stage 6 wires it up (cache or rate-limit).
- Hot reload in the container — we still have to rebuild the image on code change. Stage 7 with `compose watch`.

## K8s implications I want to remember
- Compose `services` ↔ K8s `Deployment` + `Service`.
- Compose service-name DNS ↔ K8s Service-name DNS (both via a cluster/embedded DNS).
- Compose `named volume` ↔ K8s `PersistentVolumeClaim` + `PersistentVolume`.
- Compose `depends_on: service_healthy` ↔ K8s `readinessProbe` gating traffic.
- Compose `healthcheck` (baked into image OR overridden in compose file) ↔ K8s liveness/readiness probes.
- `.env` variables ↔ K8s `ConfigMap` (non-secret) + `Secret` (sensitive).
- One `compose.yaml` describing the whole stack ↔ a directory of manifests + Kustomize/Helm.

## One question I still have
-
