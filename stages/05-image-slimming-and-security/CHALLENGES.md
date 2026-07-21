# Stage 5 — self-check

Answer without looking. If you can't, re-run the relevant tool or re-read the section.

1. What does `dive` show you that `docker image history` doesn't? Give one concrete example.
2. Trivy scanned `api-gateway:prod` and reported CVEs. Are those CVEs mostly in your NestJS code, in `node_modules`, or in the base OS? Why does that fact drive your base-image choice?
3. Name three things a **distroless** image does NOT contain that an Alpine image does. For each, why does its absence matter?
4. `docker exec -it my-container sh` fails on a distroless image. Give two ways you can still investigate a running distroless container.
5. Why is `HEALTHCHECK CMD node -e "..."` (shell form) fine on Alpine but broken on distroless? Which form works everywhere?
6. What's the difference between an image **tag** (`node:22-alpine`) and an image **digest** (`node@sha256:…`)? Which one would a K8s admission policy typically require, and why?
7. Multi-arch: what actually goes into a "multi-arch manifest," and what does the runtime do when a Pod scheduled on an `arm64` node pulls an image whose manifest lists both `amd64` and `arm64`?
8. What is an SBOM, and give one concrete K8s use case for it (beyond "compliance checkbox").
9. `trivy config apps/api-gateway/Dockerfile` — what kind of findings does this produce that scanning the built image would miss?
10. Rank these four in image size, smallest to largest, WITHOUT running any command:
    - `node:22-alpine`
    - `node:22` (Debian-slim based)
    - `gcr.io/distroless/nodejs22-debian12:nonroot`
    - `scratch` + copied node binary + node_modules
