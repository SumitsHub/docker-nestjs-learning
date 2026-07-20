# Stage 1 — self-check

Answer without looking. If you can't, re-do the relevant experiment.

1. You run `docker container run -d --name web -p 8080:80 nginx`. Explain what each flag does *and* what happens if you omit `-d`.
2. What's the difference between a **named volume** and a **bind mount**? Which one maps to a Kubernetes PVC, which to `hostPath`?
3. On the default `bridge` network, why can't containers resolve each other by name? What do you do instead?
4. What does `docker image history <img>` show, and why should you care about the *order* of the layers?
5. Why did our first "stop the container" experiment take ~10 seconds, and what's the exact fix?
6. Fill in the blank: in Kubernetes, anything written to the container filesystem is lost on _______, so state belongs in _______.
