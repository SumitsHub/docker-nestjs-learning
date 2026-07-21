# Stage 4 — self-check

Answer without looking. If you can't, re-do the relevant experiment or re-read the section.

1. In our `compose.yaml`, api-gateway has `USERS_SERVICE_HOST=users-service`. What component actually resolves the string `users-service` to an IP, and where does it live?
2. What's the difference between `depends_on: users-service` and `depends_on: users-service: condition: service_healthy`? Give a concrete scenario where the former is not enough.
3. `${POSTGRES_USER:-postgres}` in compose.yaml — what does this mean? Where does the value come from at `docker compose up` time?
4. `docker compose down` vs `docker compose down -v` — which one destroys your data? What's the equivalent decision in Kubernetes?
5. In `users-service/app.module.ts` we use `TypeOrmModule.forRootAsync(...)` instead of `forRoot(...)`. Why? What would fail if we used `forRoot` with `process.env.DB_HOST` directly?
6. Why did the switch from `Map` to Postgres require **zero** changes in `api-gateway`? What design principle made that possible?
7. What does `synchronize: true` do, and why is it fine for this stage but forbidden in production?
8. If postgres's healthcheck starts failing at 3 a.m., what happens to `users-service` and `api-gateway` under Compose's rules? What would happen in Kubernetes with a `readinessProbe`?
9. Both `postgres` and `redis` publish ports to the host (`5432`, `6379`). Are those ports *required* for the app to work? What are they useful for?
10. `pg_isready` and `redis-cli ping` are baked into the postgres/redis images. What's the Node-app equivalent we used in Stage 3, and why did we use `node -e` instead of `curl`?
