# Stage 3 — my notes

## What I built
- `.dockerignore` at the repo root — first line of defense against context bloat and secret leaks.
- `apps/api-gateway/Dockerfile` — 5-stage build (base → deps → builder ; base → prod-deps ; runtime).
- `apps/users-service/Dockerfile` — same shape, TCP-flavored.
- Both images run as `node` (UID 1000) with `tini` as PID 1.

## Before / after — same app, different Dockerfile

| Metric | Stage 2 naive | Stage 3 production | Δ |
|---|---|---|---|
| Image size (MB) — api-gateway | 398 | | |
| Image size (MB) — users-service | (n/a) | | |
| Biggest layer + what's in it | 149 MB base `node` | | |
| Runs as | root (UID 0) | node (UID 1000) | |
| PID 1 | `yarn` (Node script) | `tini` | |
| `docker stop` time | 0.76 s | | |
| devDeps present in runtime? | yes (~450 MB) | | |
| `.ts` sources present in runtime? | yes | | |
| `.git`, docs, tests present? | yes | | |

## The layer-cache experiments

- [ ] **Experiment 1 (code change):** rebuilt after editing a controller — which stages showed `CACHED`?
  -
- [ ] **Experiment 2 (deps change):** bumped `package.json` `version` — which stages re-executed?
  -
- [ ] **Experiment 3 (cache mount):** rebuilt after `docker image rm`, saw `yarn install` was still fast because the BuildKit cache mount kept the yarn global cache alive.
  -

## Network-DNS preview (Part G)

- [ ] Created `docker network create appnet`.
- [ ] Started `users-prod` on `appnet`.
- [ ] Started `gw-prod` on `appnet` with `-e USERS_SERVICE_HOST=users-prod`.
- [ ] Cross-container call succeeded: `POST /users` created a user, `GET /users` listed it.
- Insight: container-name → IP resolution just works on user-defined bridges. This is the same mental model Kubernetes uses for `Service` names.

## What surprised me
-

## What I still want to fix
-  Graceful shutdown inside Nest (`app.enableShutdownHooks()` + close server on SIGTERM). Stage 6.
- Proper `/livez` and `/readyz` endpoints instead of "any HTTP response = healthy". Stage 6.
- Distroless base image + digest pin instead of the mutable `node:22-alpine` tag. Stage 5.
- Multi-arch build (amd64 + arm64) via `docker buildx`. Stage 5.

## K8s implications I want to remember
- **Multi-stage discipline ↔ smaller Pod image pulls.** Rolling updates and autoscaling both accelerate.
- **Non-root user ↔ PodSecurity `restricted`.** Our image would pass out of the box.
- **tini as PID 1 ↔ terminationGracePeriodSeconds behaves as advertised.** Signals reach the app; no zombie accumulation in long-lived Pods.
- **HEALTHCHECK endpoint ↔ probe endpoint.** K8s ignores Docker's HEALTHCHECK, but the URL/port we designed for it will be reused verbatim in `livenessProbe` and `readinessProbe`.
- **BuildKit cache mount ↔ CI build times.** Same primitive works in GitHub Actions cache in Stage 8.

## One question I still have
-
