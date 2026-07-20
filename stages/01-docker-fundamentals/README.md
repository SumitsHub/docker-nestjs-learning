# Stage 1 — Docker fundamentals (hands-on, no NestJS yet)

**Time:** ~60–90 min. **Terminal open.**
**Goal:** Build muscle memory for images, containers, layers, volumes, networks, and registries — using stock images so nothing about your app can distract you.

We won't touch NestJS until Stage 2. Today is about the tool.

---

## 1. The command anatomy you'll use forever

```
docker  <object>  <verb>  [flags]  [args]
        │         │
        │         └── run, ls, rm, logs, exec, inspect, pull, push, build …
        └── container, image, volume, network, system, buildx …
```

Older syntax (`docker run`, `docker ps`, `docker rmi`) still works — those are shortcuts. Prefer the explicit form (`docker container run`, `docker container ls`) at first; it makes you *think* about which object you're acting on. You'll drop back to the shortcuts once the mental model is solid.

---

## 2. Warm-up: run something and observe

Do each of these, one at a time. **Read the output every time** — don't just watch it scroll.

```bash
# 1. See you have no local images yet
docker image ls

# 2. Pull an image explicitly (separate from running it)
docker image pull hello-world

# 3. Now list images again — note the SIZE column, and the IMAGE ID
docker image ls

# 4. Run it. This creates a container, runs it, exits.
docker container run hello-world

# 5. The container is gone from `ps`, but not really gone
docker container ls              # only running
docker container ls -a           # all, including exited

# 6. Inspect the exited container — see how much metadata Docker keeps
docker container inspect <container-id-or-name> | less

# 7. Clean it up
docker container rm <container-id-or-name>
```

**Journal in [NOTES.md](NOTES.md):** what's the difference between `docker image pull` and `docker container run <image>` if the image isn't local yet?

---

## 3. A real long-running container: nginx

```bash
# Run nginx in the background, map host port 8080 → container port 80, name it
docker container run -d --name web -p 8080:80 nginx:1.27-alpine

# Confirm
docker container ls
curl -sI http://localhost:8080 | head -3

# Follow its logs (stdout/stderr — remember this from stage 0)
docker container logs -f web
# Ctrl-C to stop following (does NOT stop the container)

# Peek inside a running container (shell)
docker container exec -it web sh
# Inside:
#   ls /
#   cat /etc/nginx/nginx.conf | head
#   ps aux            # notice nginx is PID 1
#   exit
```

Now the deliberately-wrong move:

```bash
# WRONG: create a file inside the running container
docker container exec web sh -c 'echo "hello from inside" > /tmp/mynote.txt'
docker container exec web cat /tmp/mynote.txt      # yep, it's there

# Now stop and remove the container
docker container stop web
docker container rm web

# Run a NEW container from the same image
docker container run -d --name web -p 8080:80 nginx:1.27-alpine
docker container exec web cat /tmp/mynote.txt      # gone. Because the writable layer was discarded.
docker container stop web && docker container rm web
```

**This is the single most important lesson of the day.** Kubernetes will restart your Pod for a hundred reasons. Anything you wrote to the container's filesystem is gone. State lives in **volumes**.

---

## 4. Volumes — the right way to persist

Two flavours you'll meet:

| Type | Syntax | When to use |
|---|---|---|
| **Named volume** (Docker manages the storage) | `-v myvolume:/data` | Databases, anything you don't want to think about the host path for. Maps to Kubernetes **PersistentVolumeClaim**. |
| **Bind mount** (you point at a host path) | `-v $(pwd)/src:/app/src` | Dev-time hot reload, config files. Maps loosely to Kubernetes **hostPath** (rarely used) — mostly a local-dev thing. |

Try a named volume:

```bash
docker volume create pgdata
docker volume ls
docker volume inspect pgdata      # note the Mountpoint — that's where Docker stores it on the host

# Run Postgres, storing data in the volume
docker container run -d --name pg \
  -e POSTGRES_PASSWORD=devpass \
  -v pgdata:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16-alpine

docker container logs pg | tail -20

# Create some data
docker container exec -it pg psql -U postgres -c "CREATE TABLE t(id int); INSERT INTO t VALUES (1),(2),(3); SELECT * FROM t;"

# Now DESTROY the container completely
docker container stop pg && docker container rm pg

# Bring up a NEW container pointing at the same volume
docker container run -d --name pg \
  -e POSTGRES_PASSWORD=devpass \
  -v pgdata:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16-alpine

sleep 3
docker container exec -it pg psql -U postgres -c "SELECT * FROM t;"
# Data is still there. Container was disposable; volume was not.
```

Cleanup:

```bash
docker container stop pg && docker container rm pg
# Volume still exists until you remove it
docker volume ls
docker volume rm pgdata
```

---

## 5. Networks — how containers talk

Every `docker run` without `--network` puts the container on the default `bridge` network. On the default bridge, containers can talk to each other by **IP but not by name**. That's an ancient quirk. On any user-defined bridge network, DNS-based discovery just works. **Always use user-defined networks.**

```bash
docker network create appnet
docker network ls

docker container run -d --name redis --network appnet redis:7-alpine
docker container run -it --rm --network appnet alpine sh
# Inside the alpine container:
#   apk add --no-cache curl bind-tools
#   nslookup redis            # DNS resolves to the redis container's IP
#   nc -zv redis 6379         # TCP connect works
#   exit

docker container stop redis && docker container rm redis
docker network rm appnet
```

**K8s payoff:** in Kubernetes, every Pod gets DNS entries via `Service` names. The mental model is identical: containers/Pods talk to each other by **name**, not IP.

---

## 6. Layers — see them with your own eyes

```bash
docker image pull node:22-alpine
docker image history node:22-alpine
```

Read that output. Each row is a layer, with its size and the command that created it. Notice how tiny most layers are and how the bulk is in the base OS + Node install.

Now inspect the raw manifest:

```bash
docker image inspect node:22-alpine | jq '.[0] | {Id, Architecture, Os, Config: .Config | {Env, Entrypoint, Cmd, User, WorkingDir}}'
```

That JSON block — env vars, entrypoint, user, workdir — is **exactly** the metadata a Kubernetes runtime will read to launch your Pod. Setting these correctly in your Dockerfile means Kubernetes needs less config to run you right.

---

## 7. Registries — pull from more than one

Docker Hub is the default, but not the only one. Explicit registries look like:

```
<registry-host>/<namespace>/<repo>:<tag>
ghcr.io/nestjs/nest:latest
mcr.microsoft.com/dotnet/aspnet:8.0
public.ecr.aws/nginx/nginx:latest
```

```bash
# Pull from GitHub Container Registry
docker image pull ghcr.io/linuxserver/nginx:latest
docker image ls ghcr.io/linuxserver/nginx
```

We'll push our own image to GHCR in Stage 8.

---

## 8. Deliberate "do it wrong" — the container that won't die gracefully

Some images run a shell as PID 1, which doesn't forward signals. Watch:

```bash
# BAD: shell form of CMD means the process is /bin/sh -c "...", not your app
docker container run -d --name badstop alpine:3.20 sh -c "while true; do echo tick; sleep 1; done"

time docker container stop badstop
# You'll see it takes ~10 seconds — because SIGTERM went to sh, which didn't forward it,
# and Docker eventually escalated to SIGKILL after the 10s grace period.

docker container rm badstop
```

Now the right way:

```bash
# GOOD: exec form, and use a signal-aware entrypoint
docker container run -d --name goodstop alpine:3.20 \
  sh -c 'trap "echo bye; exit 0" TERM; while true; do echo tick; sleep 1 & wait $!; done'

time docker container stop goodstop
# Sub-second.
docker container rm goodstop
```

**K8s payoff (huge):** Kubernetes sends SIGTERM on every rolling update, then waits `terminationGracePeriodSeconds` (default 30s), then SIGKILLs. A Node.js app that ignores SIGTERM will:
- Drop in-flight HTTP requests every deploy.
- Slow every rollout by 30 seconds per Pod.
- Never close DB connections cleanly.

We'll wire this up properly in Stage 6.

---

## 9. Cleanup — the commands you should know cold

```bash
docker container ls -a               # what containers exist?
docker container prune               # remove all stopped containers
docker image ls                      # what images exist?
docker image prune                   # remove dangling (untagged) images
docker image prune -a                # remove ALL images not used by a container (careful)
docker volume ls
docker volume prune                  # remove unused volumes
docker network ls
docker network prune                 # remove unused user-defined networks
docker system df                     # how much disk is Docker using?
docker system prune                  # nuclear option: containers+networks+dangling images
docker system prune -a --volumes     # really nuclear (BE CAREFUL)
```

---

## Fill in [NOTES.md](NOTES.md) and try [CHALLENGES.md](CHALLENGES.md). Then move to [Stage 2](../02-first-nestjs-dockerfile/README.md).
