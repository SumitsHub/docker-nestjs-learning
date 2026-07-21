# Stage 2 — my notes

## What I built
- A NestJS monorepo (manual scaffold, no `nest new`) with 2 apps and 1 shared library.
- `api-gateway`: HTTP REST on port 3000, forwards to `users-service` via `ClientProxy`.
- `users-service`: TCP microservice on port 4001, in-memory store.
- `libs/common`: shared DTOs + message patterns.
- One naive single-stage Dockerfile for the gateway.

## Structure that surprised me
- One `package.json` for the whole monorepo (I expected one per app).
- Path aliases (`@app/common`) hide the `../../../libs/common/src` relative import mess.
- `nest-cli.json` is the only file that ties the apps + lib together for the build tooling.
- The compiled output nests both apps under a single `dist/apps/<name>` tree — one build folder, many services.
- Yarn 4 is pinned via Corepack + the `packageManager` field in `package.json`, and the actual Yarn release is committed under `.yarn/releases/`. My Docker build in Stage 3 will use the *same* Yarn, so `yarn install --immutable` produces the same `node_modules` there as here.

## Running on host worked?
- [ ] users-service listens on TCP 4001
- [ ] api-gateway listens on HTTP 3000
- [ ] `POST /users` creates a user
- [ ] `GET /users` returns the list
- [ ] Invalid body → 400 from ValidationPipe

## The naive Dockerfile — measurements

| Metric | Value | Reflection |
|---|---|---|
| Image size (MB) | 398 | |
| Time from `docker stop` to actual exit | 0.76s | Fast — Yarn 4 forwards SIGTERM, but not graceful: no shutdown hooks in Nest |
| Biggest single layer + what it contains | 149MB, node | |
| Is `node_modules` in the image? Includes devDeps? | YES | |
| Are `.ts` source files present? | YES | |
| Are tests, README, `.git`, docs present? | YES | |

## What I'd fix if I could only fix one thing
- size

## K8s implications I want to remember
- **Image size ↔ rollout speed.** A 1.4 GB image pulled to N nodes = N × 1.4 GB of bandwidth + disk. Rolling updates get slow, autoscaling gets slow, node churn gets expensive.
- **Whole-monorepo in one image = every service is coupled at the artifact level.** Change one, rebuild everything. Change one, redeploy everything.
- **Building both services into one image but only running one = wasted layers.** In K8s each Pod runs one process; the image should carry only what that process needs.
- **`node_modules` with devDependencies ↔ larger attack surface** — every dev dep is a potential CVE that shows up in cluster scans (we'll see this in Stage 5 with `trivy`).

## One question I still have
-
