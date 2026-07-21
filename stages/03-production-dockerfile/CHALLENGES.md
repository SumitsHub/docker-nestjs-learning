# Stage 3 — self-check

Answer without looking. If you can't, re-do the relevant experiment or re-read the section.

1. What does a multi-stage Dockerfile actually give us that a single-stage one can't? Which stages ship as layers in the final image, and which don't?
2. Explain the order: `COPY package.json yarn.lock` → `RUN yarn install` → `COPY <source>` → `RUN build`. What breaks (concretely) if you reverse the last two?
3. What is `--mount=type=cache,target=/root/.yarn/berry/cache` doing? Why doesn't the cache end up in the final image?
4. Give one Docker-specific and one Kubernetes-specific reason to run containers as a non-root user like `node` (UID 1000).
5. What is `tini`, why do we put it before the app in `ENTRYPOINT ["/sbin/tini", "--"]`, and what would we lose without it?
6. Our HEALTHCHECK uses `node -e "..."` instead of `curl` or `wget`. Give two reasons that's the better choice for a Node.js image.
7. On a user-defined Docker network, how does `-e USERS_SERVICE_HOST=users-prod` end up working? Which component resolves the name to an IP?
8. What is the "build context" that `docker build .` sends to the daemon? What does `.dockerignore` prevent, and give one concrete leak (`.env`, host `node_modules`, `.git`) that a missing `.dockerignore` could cause.
9. If you change one line in `apps/api-gateway/src/users/users.controller.ts` and rebuild, which of these stages re-execute vs cache-hit: `base`, `deps`, `builder`, `prod-deps`, `runtime`? Which layer is invalidated first?
10. Kubernetes doesn't use Docker's `HEALTHCHECK` directive. Which two Kubernetes concepts serve the same role, and why is designing the endpoint in this stage still worth it?
