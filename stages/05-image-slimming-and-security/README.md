# Stage 5 — Image slimming & supply chain

**Time:** ~2 hours (tool install + measurements + comparisons)
**Goal:** Look inside your image with the tools professionals use, quantify the CVE surface, cut both further with a distroless variant, pin the base image by digest, understand multi-arch builds and SBOMs. Every technique here is what stops a Kubernetes admission controller from rejecting your image.

---

## What you'll walk away with

- Muscle memory with three image-inspection tools: **`dive`** (layers), **`trivy`** (CVEs), **`hadolint`** (Dockerfile linting)
- A **distroless** variant of each service Dockerfile — no shell, no package manager, tiny CVE footprint
- **Digest-pinned** base images → truly reproducible builds
- Multi-arch (`amd64` + `arm64`) buildx pipeline verified locally
- Basic understanding of **SBOM** (Software Bill of Materials) and why K8s clusters increasingly demand them
- Numbers table: size + CVE count for alpine-prod vs distroless

---

## Part A — Why this stage matters (K8s-shaped)

Real Kubernetes clusters run image-security policy at admission time:

- **Kyverno / OPA Gatekeeper** reject images with known CRITICAL/HIGH CVEs.
- **PodSecurity `restricted`** requires non-root, read-only root filesystems, no privilege escalation.
- **SLSA / Sigstore** attestations verify where the image came from and what's inside it.
- **Image scanning** in CI (GitHub, Snyk, Trivy Action) blocks PRs that raise vuln counts.

Everything below is a habit that keeps you *out* of those blockers.

### The three principles

1. **Fewer bytes = fewer bugs.** Every package in an image is a potential CVE. If your base has `bash`, `curl`, `openssl`, and 200 unused shared libraries, every CVE announcement is your problem.
2. **Fewer capabilities = fewer footholds.** An image without a shell is dramatically harder to attack post-exec. A container without `apt`/`apk` can't fetch tooling once compromised.
3. **Pinned inputs = deterministic outputs.** Rebuild the same Dockerfile a month later and you must get the exact same image. Tags lie; digests don't.

---

## Part B — Install the tools

### `dive` — interactive layer explorer
[wagoodman/dive](https://github.com/wagoodman/dive) — TUI showing exactly what each image layer added.

```bash
# Linux / WSL — install as .deb
DIVE_VERSION=0.13.1
curl -fsSL "https://github.com/wagoodman/dive/releases/download/v${DIVE_VERSION}/dive_${DIVE_VERSION}_linux_amd64.deb" -o /tmp/dive.deb
sudo dpkg -i /tmp/dive.deb

# Or one-shot with docker (no install):
alias dive='docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  wagoodman/dive:latest'

dive --version
```

### `trivy` — CVE + secret + IaC scanner
[aquasecurity/trivy](https://github.com/aquasecurity/trivy) — the de-facto container scanner.

```bash
# Debian / Ubuntu / WSL Ubuntu
sudo apt-get install -y wget apt-transport-https gnupg
wget -qO- https://aquasecurity.github.io/trivy-repo/deb/public.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/trivy.gpg
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" \
  | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update && sudo apt-get install -y trivy

# Or one-shot with docker (slow first run: pulls DB):
alias trivy='docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest'

trivy --version
```

### `hadolint` — Dockerfile linter
[hadolint/hadolint](https://github.com/hadolint/hadolint) — catches best-practice violations at edit time.

```bash
# One-shot with docker:
docker run --rm -i hadolint/hadolint < apps/api-gateway/Dockerfile

# Or install the binary
curl -fsSL https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-x86_64 \
  -o /tmp/hadolint
sudo install /tmp/hadolint /usr/local/bin/hadolint
hadolint --version
```

---

## Part C — Explore your current image with `dive`

Fire it up against the api-gateway image you built in Stage 4:

```bash
dive api-gateway:prod
```

Navigate:

| Key | Action |
|---|---|
| `Tab` | Switch between the layer list (left) and file tree (right) |
| Arrow keys | Move within the focused panel |
| `Space` | Expand/collapse directories |
| `Ctrl-F` | Filter file tree |
| `Ctrl-U` | Show only files modified in the selected layer |
| `q` | Quit |

Bottom bar shows **image efficiency %**. Anything under ~95% means you're shipping duplicated bytes across layers.

**Fill in NOTES.md:** the top 3 layers by size, and what each one added.

---

## Part D — Scan for CVEs with `trivy`

```bash
# Full scan — OS packages + language deps + secrets + misconfigs
trivy image api-gateway:prod

# Just the actionable stuff
trivy image --severity CRITICAL,HIGH api-gateway:prod

# For CI use JSON output
trivy image --format json --output /tmp/api-gateway.trivy.json api-gateway:prod

# Also scan the Dockerfile source for misconfigs
trivy config apps/api-gateway/Dockerfile
```

What trivy finds:

- **OS package CVEs** — from Alpine's `apk` database
- **Language dependency CVEs** — from `yarn.lock`
- **Config issues** — running as root, hardcoded secrets, missing HEALTHCHECK, etc.

**Record in NOTES.md** the counts for CRITICAL / HIGH / MEDIUM / LOW / UNKNOWN. Most findings will be in the base image, not your code — which is exactly why base-image choice matters.

**Tip:** on the first run trivy downloads its CVE database (~200 MB). Subsequent runs are much faster.

---

## Part E — Lint the Dockerfiles with `hadolint`

```bash
hadolint apps/api-gateway/Dockerfile
hadolint apps/users-service/Dockerfile
```

Common warnings you'll likely see and what to do:

| Rule | Meaning | Response |
|---|---|---|
| `DL3018` | Pin apk package versions | Fair, but versions drift between Alpine releases. Either pin (`tini=0.19.0-r3`) or add `# hadolint ignore=DL3018` above the RUN |
| `DL3006` | Always tag base images | We do (`node:22-alpine`) — no warning expected |
| `DL3025` | Use exec (JSON array) form for CMD/ENTRYPOINT | We do — no warning expected |
| `DL3059` | Multiple consecutive RUN commands | Fine to ignore when the RUNs are in different logical concerns |

For a learning repo, running hadolint and *reading* every warning is more valuable than achieving a clean report — you learn *why* each rule exists.

---

## Part F — Distroless variant

Distroless images (from [GoogleContainerTools/distroless](https://github.com/GoogleContainerTools/distroless)) contain only:
- The language runtime (Node in our case)
- CA certificates
- Time-zone data
- A `nonroot` user (uid 65532)

That's it. **No shell.** No `apk`, no `apt`. No `wget`. No `curl`. No `ls`. Attacking one is a lot harder than attacking Alpine or Debian.

Two new Dockerfiles have been added alongside the alpine ones:

- [`apps/api-gateway/Dockerfile.distroless`](../../apps/api-gateway/Dockerfile.distroless)
- [`apps/users-service/Dockerfile.distroless`](../../apps/users-service/Dockerfile.distroless)

Read them — the header comment lists every trade-off vs the alpine variants. Key differences:

| Aspect | Alpine (`Dockerfile`) | Distroless (`Dockerfile.distroless`) |
|---|---|---|
| Base runtime | `node:22-alpine` | `gcr.io/distroless/nodejs22-debian12:nonroot` |
| Shell | `sh` (BusyBox) | **none** |
| Package manager | `apk` | **none** |
| Non-root | `USER node` (uid 1000) | `USER nonroot` (uid 65532) |
| `tini` as PID 1 | `apk add --no-cache tini` | Not available — distroless runs `node` as PID 1 directly (node handles SIGTERM fine) |
| HEALTHCHECK form | shell allowed | **exec (JSON array) mandatory** |
| CMD | `["node", "dist/…/main"]` | `["dist/…/main"]` (ENTRYPOINT is already `node`) |

### Build and compare

```bash
docker build -f apps/api-gateway/Dockerfile.distroless \
             -t api-gateway:distroless .

# Size side-by-side
docker image ls | grep -E 'REPOSITORY|api-gateway'

# CVE count side-by-side
trivy image --severity CRITICAL,HIGH api-gateway:prod
trivy image --severity CRITICAL,HIGH api-gateway:distroless

# Prove non-root
docker container run --rm api-gateway:distroless /nodejs/bin/node -e 'console.log(process.getuid(), process.geteuid())'
#   → 65532 65532

# Prove no shell
docker container run --rm --entrypoint sh api-gateway:distroless -c echo
#   → error: exec /bin/sh: no such file or directory  ← that's the point
```

### The debugging-into-distroless story

Since `docker exec sh` doesn't work, use one of:

- **`docker debug`** (Docker Desktop only) — spawns a shell in an ephemeral debug container attached to your target.
- **Ephemeral debug container in Kubernetes** — `kubectl debug -it <pod> --image=busybox --target=<container>`.
- **`nsenter` from the host** (Linux) — join the container's namespaces from the outside.

This is the *right* trade-off for K8s prod, but it takes getting used to.

### Do the same for users-service

```bash
docker build -f apps/users-service/Dockerfile.distroless \
             -t users-service:distroless .
```

---

## Part G — Pin the base image by digest

Tags like `node:22-alpine` are mutable pointers. Today's `node:22-alpine` is different bytes from next month's. For truly reproducible builds:

```bash
# 1. Look up the current digest of node:22-alpine
docker image inspect node:22-alpine --format '{{index .RepoDigests 0}}'
#   → node@sha256:16e22a550f386320…

# 2. Rebuild with the digest pinned via the ARG in our Dockerfile
docker build \
  --build-arg NODE_IMAGE=node:22-alpine@sha256:16e22a550f386320… \
  -f apps/api-gateway/Dockerfile \
  -t api-gateway:pinned .

# 3. Prove it — the base image reference is now hash-addressed
docker image inspect api-gateway:pinned --format '{{.Config.Image}}'
```

In real projects, you commit the digest into the Dockerfile itself and let a bot like **Renovate** or **Dependabot** open PRs to bump it. That way you get security updates *deliberately*, not silently.

For our learning repo, keep `node:22-alpine` in the Dockerfiles (tag-based, easier to read), and treat the `--build-arg` approach as a "when I need it" tool.

---

## Part H — Multi-arch build with buildx (preview)

Modern K8s nodes are mixed-arch:
- AWS Graviton, Ampere → `arm64`
- Apple silicon dev laptops → `arm64`
- Most Intel / AMD → `amd64`

If your image is `amd64`-only, ARM nodes crash-loop pulling it. Multi-arch fixes this.

```bash
# 1. Create a multi-platform builder (once per machine)
docker buildx create --name multi --driver docker-container --use
docker buildx inspect --bootstrap

# 2. Cross-compile for both platforms.
# --load doesn't work for multi-platform (Docker's local image store
# can't hold a multi-arch manifest). We're just proving the BUILD works.
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f apps/api-gateway/Dockerfile \
  -t api-gateway:multi \
  --progress plain \
  .
```

You should see two parallel build streams — one per platform. QEMU emulates whichever architecture you're not on natively.

The real "push a multi-arch manifest to a registry" happens in **Stage 8** (`docker buildx build --platform … --push …`).

---

## Part I — SBOM (Software Bill of Materials)

An SBOM is a machine-readable list of every ingredient in your image — every OS package, every npm dep, every version. Ops teams use SBOMs to answer questions like "am I affected by CVE-2024-XYZ in package `foo`?" without rebuilding or scanning.

### Two ways to generate

```bash
# 1. Docker Buildx can attach an SBOM as an image attestation
docker buildx build \
  --sbom=true \
  --provenance=true \
  -f apps/api-gateway/Dockerfile \
  -t api-gateway:with-sbom \
  --load .

# 2. Or use `syft` (Anchore) — standalone tool, richer output
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh \
  | sudo sh -s -- -b /usr/local/bin
syft api-gateway:prod
syft api-gateway:prod -o cyclonedx-json > /tmp/api-gateway.sbom.json
```

Formats you'll encounter:
- **SPDX** — Linux Foundation standard, older, more prevalent in gov/enterprise
- **CycloneDX** — OWASP standard, richer, more common in modern tooling

For K8s: admission controllers like [Kyverno](https://kyverno.io/) can require an SBOM attestation before allowing an image to be pulled. Stage 8 sets this up in CI.

---

## Part J — Reflect, self-check, commit

Fill in [NOTES.md](NOTES.md) — especially the size + CVE comparison tables. Try [CHALLENGES.md](CHALLENGES.md) without peeking.

### Suggested commits

```bash
# 1. Distroless variants
git add apps/api-gateway/Dockerfile.distroless \
        apps/users-service/Dockerfile.distroless
git commit -m "build(stage-05): add distroless variant Dockerfiles per service

Alternative production build on gcr.io/distroless/nodejs22-debian12:nonroot.
Trade-offs vs alpine: no shell, no apk, no tini package (node runs as
PID 1 directly, handles SIGTERM). HEALTHCHECK uses exec form (no shell
to interpret shell form). USER nonroot (uid 65532) by default.
Kept alongside the alpine Dockerfiles for A/B comparison."

# 2. Measurements + reflection
git add stages/05-image-slimming-and-security/NOTES.md
git commit -m "docs(stage-05): reflection — dive/trivy/hadolint numbers, distroless comparison

Recorded biggest 3 layers per image, CVE counts (alpine vs distroless),
verified multi-arch buildx and SBOM generation. Distroless: <N MB> vs
alpine <M MB>; CRITICAL/HIGH count dropped from <X> to <Y>."

# 3. Tag
git tag -a stage-05-complete -m "Image inspected, slimmed, scanned, and supply-chain-aware"
git push --follow-tags
```

Ping me with the comparison numbers (alpine vs distroless: size + CRITICAL+HIGH count), or if any tool refuses to install. Stage 6 (12-factor + K8s readiness — `/livez`, `/readyz`, graceful shutdown, JSON logs) is next.
