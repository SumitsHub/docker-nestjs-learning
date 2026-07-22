# Stage 6 — my notes

## What I built
- Joi validation schemas in both apps — bad env → app refuses to boot.
- nestjs-pino everywhere: JSON logs in prod, pretty in dev.
- `app.enableShutdownHooks()` in both apps.
- `RedisModule` with `onApplicationShutdown` closing the ioredis client.
- `/livez` and `/readyz` via `@nestjs/terminus`.
- Custom `RedisHealthIndicator`.
- Global `@nestjs/throttler` (60/min/IP, in-memory).
- Dockerfile HEALTHCHECKs now require HTTP 200 from `/livez`.
- compose: redis starts by default (no host-port publish); api-gateway gets `REDIS_URL`.

## Config validation — did it actually fail-fast?
- [ ] Ran `PORT=not-a-number yarn start:gateway` → Nest logged a Joi error and exited.
- Error message shape:
  -

## Structured logs — one line of JSON output
- Sample line from `NODE_ENV=production node dist/apps/api-gateway/main`:
  ```json
  {
    "level": 30,
    "time": "...",
    "pid": ...,
    "hostname": "...",
    "context": "NestApplication",
    "msg": "Nest application successfully started"
  }
  ```

## `/livez` vs `/readyz` experiment
- [ ] `/livez` → 200 with empty checks.
- [ ] `/readyz` → 200 with both `users-service` and `redis` up.
- [ ] Stopped redis → `/readyz` → 503 with `error.redis.status: "down"`.
- [ ] While redis was down, `/livez` still 200. (K8s would take the pod out of the Service, but NOT restart it — the whole point of the split.)

## Rate limit test
- 70 requests → `<N>` 200s, `<M>` 429s.
- The 429 count and how quickly they appear:
  -
- **K8s realism:** the 60/min limit is in-memory per Pod. 3 replicas → 180/min effective. To share the budget → Redis-backed throttler storage (Stage 7 candidate).

## Graceful shutdown proof
- `docker compose stop api-gateway` → time to exit: ______
- Redis quit line visible in `docker compose logs api-gateway`? [ ] yes / [ ] no
- Without `enableShutdownHooks` this would still stop (tini forwards signals) but redis + TypeORM connections wouldn't close cleanly.

## What surprised me
-

## K8s implications I want to remember
- **Liveness = "restart me if I'm broken"** ↔ trivial `/livez`. Never check dependencies here.
- **Readiness = "route traffic away when I'm not useful"** ↔ `/readyz` with downstream checks.
- **enableShutdownHooks + `terminationGracePeriodSeconds`** — must exit well within the grace period (K8s default 30s) or you get SIGKILL and dropped requests.
- **JSON logs to stdout** — cluster log aggregators (Fluent Bit, Loki, Datadog Agent) parse per-line JSON. Free-text logs = queryless log soup.
- **Env vars validated at boot** = misconfigured Pod fails its readiness probe immediately, doesn't quietly 500 for hours.
- **In-memory rate-limiter = per-pod budget.** Rate limits meant to be global need shared storage (Redis).
- **`Global()` module + `OnApplicationShutdown`** — the K8s-safe way to own a long-lived resource (DB pool, Redis client, message broker connection) in Nest.
- Users-service intentionally has no HTTP surface. K8s `tcpSocket` probes on port 4001 replace `/livez` and `/readyz` for that pod.

## One question I still have
-
