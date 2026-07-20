# Stage 0 — my notes

Fill in as you read. Short bullets are fine. Future-you will thank present-you.

## What I built
_(nothing — this stage is pure model-building)_

## What surprised me
-

## The 5 checkpoint questions — my answers (no peeking)

1. **Whose kernel runs the container on Linux vs. macOS Docker Desktop?**
   -

2. **Tag vs. digest — which do I pin in production / Kubernetes?**
   -

3. **Why does Dockerfile instruction order affect build speed?**
   -

4. **If I `docker exec` and write a file, where does it go when the container restarts?**
   -

5. **Kubernetes doesn't use Docker — why does my `docker build` image still work there?**
   -

## K8s implication I want to remember
- Pods are ephemeral just like containers. Anything I want to survive belongs in a volume / PVC, never in the writable layer.
- The image I build here is the *exact* artifact a cluster will pull — no repackaging step.

## One question I still have
-
