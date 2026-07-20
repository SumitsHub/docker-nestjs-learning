# Stage 2 — self-check

Answer without looking. If you can't, re-read the stage.

1. In a NestJS monorepo, where do apps live vs. where do libraries live, and how are they registered so `nest build <name>` works?
2. Explain what `paths` in `tsconfig.json` does for us in this monorepo. What would break if you removed the `@app/common` entry?
3. In `apps/users-service/src/main.ts` we use `NestFactory.createMicroservice` instead of `NestFactory.create`. What's the difference — what does the app *not* have when created as a microservice?
4. Why does the gateway call `firstValueFrom(this.client.send(...))` instead of just `this.client.send(...)`? What would happen if you returned the raw observable from the controller?
5. Why did we bind the servers to `0.0.0.0` instead of `127.0.0.1`? What would go wrong inside a container if we used `127.0.0.1`?
6. Name three things inside the naive image that a production container should NOT contain.
7. If you deploy 5 replicas of the naive image to a Kubernetes cluster and each node has to pull it fresh, roughly how much disk + network do you consume — and why does this matter for autoscaling?
8. Why did `docker stop` on the naive container take ~10 seconds? What NestJS lifecycle hook will we wire up in Stage 6 to fix it properly for K8s rolling updates?
