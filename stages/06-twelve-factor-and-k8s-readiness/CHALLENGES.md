# Stage 6 — self-check

Answer without looking. If you can't, re-run the relevant experiment or re-read the section.

1. In one sentence each: what does `livenessProbe` decide, and what does `readinessProbe` decide? Give an example of a check that belongs in ONE but not the other.
2. Why do we put an *empty* check array in `/livez`? What restart-loop scenario does that prevent?
3. `app.enableShutdownHooks()` — what does it actually turn on inside Nest? Name two things in our app that stop working correctly without it.
4. Joi schema in `ConfigModule.forRoot(...)`: if `PORT=not-a-number` is set, when does the failure surface — at boot, at first request, or at container start? Why does the K8s workflow care about the answer?
5. Our api-gateway JSON logs use `nestjs-pino`. If you write `console.log("hi")` from inside a controller, does that log line come out as JSON? Why / why not?
6. `@nestjs/throttler` at 60 req/min/IP is applied via `APP_GUARD`. If you scale to 3 replicas of api-gateway behind a K8s Service, what's the *effective* per-user rate limit and why?
7. The `RedisHealthIndicator` is a *custom* Terminus indicator. What does `HealthCheckError` throw signal to the framework, and what shape does the JSON `/readyz` response take when Redis is down?
8. Why did we make `RedisModule` `@Global()` and put `REDIS_CLIENT` in its own file? What breaks if we don't split the token?
9. Compose: `REDIS_URL=redis://redis:6379`. What component resolves the second `redis` to an IP, and what's the K8s equivalent of that whole string?
10. Users-service has NO HTTP surface — no `/livez`, no `/readyz`. How does a Kubernetes Pod running users-service prove its liveness and readiness to the cluster?
