# Stage 1 — my notes

## What I built
- Ran nginx, postgres, redis, alpine containers on stock images.
- Created a named volume; proved data survives container deletion.
- Created a user-defined network; proved DNS resolution between containers works.

## What surprised me
-

## Commands I want to remember (paste yours here, in your own words)
- `docker container run -d --name X -p HOST:CONTAINER image` →
- `docker container exec -it X sh` →
- `docker container logs -f X` →
- `docker volume create NAME` + `-v NAME:/path` →
- `docker network create NAME` + `--network NAME` →

## The "wrong" experiments I actually did
- [ ] Wrote a file with `exec`, restarted container, watched it disappear.
- [ ] Ran a container with `sh -c "..."` and timed `docker stop` — took ~10 s.
- [ ] Ran the "good" version with a signal trap — sub-second stop.

## K8s implications I want to remember
- Writable container layer ↔ ephemeral Pod filesystem. State always in volumes / PVCs.
- User-defined bridge network DNS ↔ Kubernetes Service DNS. Same mental model.
- PID 1 not handling SIGTERM ↔ slow K8s rolling updates and dropped requests.
- Image config (User, WorkingDir, Env, Cmd) ↔ what the kubelet reads to start a Pod.

## One question I still have
-
