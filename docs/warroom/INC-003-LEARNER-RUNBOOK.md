# War Room — INC-003 · The Image Is Compromised

> Sprint 3 / DSO-W3. This is a security incident exercise. There is **no
> step-by-step tutorial and no answer key** here — you investigate from the
> evidence, contain, remediate, and prove recovery.

---

## 🚨 SECURITY INCIDENT

Your team has successfully built and deployed the Sprint 3 application.

The application is currently **running normally**.

Security monitoring has detected **sensitive credential material associated with
the container image currently in use**. The application appears healthy, but the
security state of the image is considered **compromised**.

Your task is to:

1. Investigate the alert.
2. Determine how the credential material entered the image.
3. Determine whether it exists in the **final image** and/or the **image layers**.
4. Contain the exposure.
5. Remediate the Docker build.
6. Rebuild the image.
7. Prove the corrected image no longer contains the credential.
8. Verify the application still works.

> A healthy, responding application does **not** mean the image is secure.

---

## Running the exercise

The incident runs on the standard app with the War Room enabled and this
incident selected. Nothing is armed unless you opt in.

```bash
# from the repo root
WAR_ROOM_ENABLED=true WAR_ROOM_INCIDENT=INC-003 \
WAR_ROOM_INSTRUCTOR_TOKEN=<your-token> \
  bash warroom.sh up
```

- **Phase 1 — Healthy.** The app starts and serves normally; no incident is
  active. Verify the frontend loads, the backend answers, and `/api/health`
  returns healthy.
- **Phase 2 — Incident activates.** After the delay (or an instructor trigger),
  the homepage raises a security alert and `GET /api/incident` returns the brief.
- **Phase 3 — Investigate → contain → remediate → verify.**

Check the live alert at any time:

```bash
curl -s localhost:8080/api/incident/status   # the alarm the banner reads
curl -s localhost:8080/api/incident          # the incident brief + what to investigate
```

---

## Evidence available to you

You have everything a DevSecOps engineer would have on a real incident:

- Container **image metadata and history** (`docker image inspect`, `docker history`)
- The image **build configuration**
- The image **build context**
- The **container filesystem**
- **Image layers**
- **Security / secret scan output**

Reason from the evidence. "The app is up" is not evidence that the image is clean.

> ⚠️ The credential involved is a **synthetic training canary** — it is fake,
> authenticates to nothing, and is safe to handle. Treat it, for the drill, as if
> it were real: discover it, contain it, and prove it is gone.

---

## What recovery must prove (not just "it starts")

You are done only when you can show, with evidence:

1. The original vulnerable image identified.
2. The synthetic credential discovered.
3. Where it lives — final filesystem and/or image layers.
4. The simulated credential contained / rotated (locally; nothing external).
5. The Docker build corrected.
6. The image rebuilt.
7. A security verification performed on the corrected image.
8. The synthetic credential **absent from the corrected artifact**.
9. The application starts successfully.
10. `/api/health` succeeds.
11. No secret present in the final image filesystem.
12. No secret recoverable from the relevant image history / layers.
13. The corrected image has a **new immutable digest**.

A local, deterministic check for points 7–13 (no registry, no real credentials)
lives at `warroom/inc003/verify.sh`. It builds the images and reports, for each,
whether the canary is present in the filesystem and recoverable from the layers,
and prints the corrected digest. Use it to prove RED → GREEN.

---

## Reset / replay

```bash
curl -s -X POST localhost:8080/api/incident/reset -H "x-warroom-token: <token>"
bash warroom.sh down && WAR_ROOM_INCIDENT=INC-003 bash warroom.sh up   # fresh RED
```

Reset leaves no real credentials, no external state, and no stray containers,
networks or volumes behind.
