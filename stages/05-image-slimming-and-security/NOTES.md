# Stage 5 — my notes

## What I built
- Installed `dive`, `trivy`, `hadolint`.
- Explored `api-gateway:prod` layer-by-layer with `dive`.
- Scanned both prod images with `trivy` — recorded CVE counts.
- Ran `hadolint` on both Dockerfiles.
- Built distroless variants for both services.
- Pinned `node:22-alpine` by digest for one experimental build.
- Ran a multi-platform buildx build (amd64 + arm64) to prove the pipeline works.
- Generated an SBOM.

## Biggest 3 layers of `api-gateway:prod` (from `dive`)

| Rank | Size | Layer command / what it added |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| — Image efficiency % | | |

## CVE comparison — `trivy` counts

| Image | CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN | Notes |
|---|---|---|---|---|---|---|
| `api-gateway:prod` (alpine) | | | | | | |
| `api-gateway:distroless` | | | | | | |
| `users-service:prod` (alpine) | | | | | | |
| `users-service:distroless` | | | | | | |

## Image size comparison

| Image | Size (MB) | Δ vs alpine |
|---|---|---|
| `nestjs-gateway:naive` | 398 | baseline |
| `api-gateway:prod` (alpine) | 190 | −52% |
| `api-gateway:distroless` | | |
| `users-service:prod` (alpine) | 190 | — |
| `users-service:distroless` | | |

## Hadolint findings

- Rules that fired and my response (fix vs ignore):
  -

## Digest-pinning experiment
- Pulled digest for `node:22-alpine`: `sha256:_____`
- Built `api-gateway:pinned` with `--build-arg NODE_IMAGE=…@sha256:…`
- Would use Renovate/Dependabot in a real repo to auto-bump.

## Multi-arch build
- Created buildx builder `multi` with `docker-container` driver.
- `linux/amd64` build time: 
- `linux/arm64` build time:  (slower under QEMU emulation)
- Verified both stages completed. Actual `--push` to a registry deferred to Stage 8.

## SBOM
- Ran `syft api-gateway:prod`.
- Ran `docker buildx build --sbom=true --provenance=true`.
- What an admission controller would do with an SBOM attestation: verify the image contains only allow-listed packages / doesn't contain a specifically-blocked package.

## What surprised me
-

## K8s implications I want to remember
- **PodSecurity `restricted`** requires non-root + read-only root FS. Our distroless image runs as uid 65532 by default → passes without extra config.
- **Kyverno / OPA** can enforce `image != *:latest` and `image = *@sha256:*` — digest-pinning becomes mandatory.
- **HEALTHCHECK exec form on distroless** — same pattern applies to K8s exec-based probes.
- **SBOM attestations** — some clusters enforce SBOM presence and validate contents against an allow-list.
- **Multi-arch manifests** — mixed-arch node pools (Graviton + Intel) require multi-arch images; single-arch pods crash-loop on the wrong node.

## One question I still have
-
