# Learning approach

The reason most "Docker tutorials" don't stick is that they teach *commands* instead of *models*. This repo flips it.

## The four moves, every stage

### 1. Mental model first (5 min, no terminal)
Before typing anything, read the stage's opening section and stare at the diagram. Ask yourself:

- What is the machine actually doing under the hood?
- What resource is being created / destroyed / shared?
- If this were a Pod in a cluster, which part would Kubernetes own vs. which part would I own?

If you can't answer those in your head, re-read. Do not touch the terminal yet.

### 2. Break it deliberately
Each stage has a **"Do it wrong"** block. It exists because:

- The pain teaches you *why* the right way is right.
- You'll recognise the failure mode in production one day and instantly know the fix.

Examples we'll do on purpose:
- Ship a 1.4 GB image → then slim it to <150 MB.
- Run Node as PID 1 without a signal handler → watch `docker stop` take 10 s → fix it.
- Bake secrets into an image → find them with `docker history` → fix it.
- Skip `.dockerignore` → watch `node_modules` bloat the build context → fix it.

### 3. Journal in `NOTES.md` — while it's fresh
Every stage has a `NOTES.md` with prompts. Fill them in **during** the stage, not after. Suggested rhythm:

- **What I built** — one sentence.
- **What surprised me** — the thing you didn't expect.
- **What broke and how I fixed it** — the actual command / edit.
- **K8s implication** — how does this concept show up in Kubernetes? (I'll seed this; you extend.)
- **One question I still have** — write it down; we resolve it next stage or you research it.

### 4. Self-check challenges
Before flipping the stage to ✅, answer the `CHALLENGES.md` questions **without looking**. If you can't, the stage isn't done.

---

## Why this is Kubernetes-shaped from day one

Every Docker habit is either K8s-compatible or K8s-hostile. We build only the compatible ones:

| Habit we build | Why K8s cares |
|---|---|
| Logs to `stdout`/`stderr` only | Cluster log collectors read container stdout; files in the container are invisible. |
| Config via env vars, not baked in | ConfigMaps and Secrets are injected as env or files at Pod start. |
| Stateless container, state in volumes | Pods are cattle; PVCs hold state. |
| One process per container | Pod = 1..N containers, each doing one job. |
| Non-root user | `PodSecurity` admission blocks root by default in restricted namespaces. |
| Handle SIGTERM cleanly, exit fast | K8s sends SIGTERM on rolling update, waits `terminationGracePeriodSeconds`, then SIGKILLs. |
| `HEALTHCHECK` in Dockerfile *and* HTTP probes in app | Docker uses HEALTHCHECK; K8s ignores it and uses its own liveness/readiness probes — but the *endpoint* is the same. |
| Small, single-purpose images with pinned digests | Faster pulls, smaller attack surface, reproducible rollouts. |
| Multi-arch builds (`amd64` + `arm64`) | Modern nodes are mixed-arch (Graviton, Ampere, Apple silicon dev). |

If a tutorial elsewhere tells you to `docker exec` into a running container to fix things, or to `ssh` into a container, or to run `pm2` inside a container — that's the anti-pattern. We don't do that here.

---

## Tools we'll add along the way

| Tool | When | Why |
|---|---|---|
| `docker` CLI + `docker compose` | Stage 1 | The basics. |
| `dive` | Stage 5 | See layer-by-layer what's in your image. |
| `trivy` | Stage 5 | Scan for CVEs. |
| `hadolint` | Stage 3 | Lint your Dockerfile. |
| `docker buildx` (already bundled) | Stage 5 | Multi-arch, better cache. |
| `kind` | Stage 9 | Local Kubernetes cluster that consumes your images. |

Install instructions live in the stage that first uses them — not up-front.

---

## How to work with me (Copilot) during this

- Ask *concept* questions, not "fix this for me" questions. E.g. "Why does the multi-stage COPY --from=builder use `dist/` and not the whole workdir?" is better than "make this work".
- When something breaks, paste the **exact** error + the **exact** command you ran. I'll help you diagnose, not just patch.
- When you finish a stage, tell me `"done with stage N"` and I'll queue the next one and quiz you on the challenges.

Now go to [stages/00-orientation/README.md](stages/00-orientation/README.md).

---

## Commit workflow (for future-you reading `git log`)

This repo is a learning journal that will live on GitHub. The commit history *is* the curriculum. Follow this and six months from now you can retrace the whole path just by reading `git log --oneline`.

### Message convention (Conventional Commits, learning-flavored)

```
<type>(<stage>): <what changed>

<why it matters / what you learned>
```

Types used in this repo:

| Type | When |
|---|---|
| `docs` | Stage READMEs, `NOTES.md`, `CHALLENGES.md`, cheatsheets |
| `feat` | New app code — services, DTOs, controllers, modules |
| `chore` | Tooling, deps, `.gitignore`, `package.json` scripts, Yarn config |
| `build` | Dockerfiles, `compose.yaml`, buildx configs, `.dockerignore` |
| `ci` | GitHub Actions (from Stage 8 onward) |
| `fix` | You broke something and corrected it. **Don't hide these** — the mistake + fix is future-you's best teacher. |
| `refactor` | Rewriting for improvement without changing behavior (e.g., Stage 3 turns the naive Dockerfile into a multi-stage one) |

Scope `<stage>` is `stage-00`, `stage-01`, …, `stage-09`, or `repo` for cross-cutting things. So `git log --grep="stage-03"` shows *everything* from that stage.

### Commit granularity: one concept per commit

Aim for 3–6 commits per stage. Not one giant "done stage N" commit — that hides the sub-steps. Example shape for Stage 2:

```
docs(stage-02): scaffold stage README, NOTES, CHALLENGES
chore(stage-02): init yarn 4 via corepack; pin packageManager
chore(stage-02): add nest + microservices deps
feat(stage-02): scaffold libs/common with DTOs and message patterns
feat(stage-02): implement users-service TCP microservice (in-memory)
feat(stage-02): implement api-gateway HTTP + ClientProxy → users
build(stage-02): naive single-stage Dockerfile for gateway
docs(stage-02): fill NOTES with image size + stop-time measurements
```

### Tag each stage on completion

When you flip a stage to ✅, tag it before moving on:

```bash
git tag -a stage-02-complete -m "Monorepo scaffolded; naive Dockerfile built; pain measured"
git push origin stage-02-complete
```

Tags become bookmarks. `git checkout stage-02-complete` in six months puts you exactly where you were, with none of the later-stage improvements applied yet. Ideal for revision or for showing someone "this is what I built at this milestone."

### What to commit that people commonly forget

- ✅ `yarn.lock` — reproducibility
- ✅ `.yarn/releases/yarn-4.x.x.cjs` — the pinned Yarn binary itself. Without it, teammates & Docker builds get a different Yarn version. This is the whole point of Corepack.
- ✅ `.yarnrc.yml`
- ✅ Every `NOTES.md` — even messy notes; the mess *is* the learning.
- ✅ Broken intermediate states you fixed. Commit before + after so `git diff <before> <after>` shows the fix.
- ❌ `node_modules/`, `dist/`, `.env`, editor-local settings

### The one habit that pays off later

At the end of each stage, before you tag it, commit your filled-in `NOTES.md` on its own:

```
docs(stage-02): reflection notes — image was 1.4GB, felt why K8s hates that
```

That single commit message becomes a searchable memory of what surprised you.

### Push cadence

- Push after every 2–3 commits, or at the end of each work session — whichever comes first.
- If a stage takes multiple sessions, that's fine — keep pushing WIP commits. History granularity beats commit polish here.
- Rarely rebase or squash on this repo. The rough edges are part of what future-you needs to see.
