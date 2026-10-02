# INC-003 — Instructor Notes (CONTAINS THE ANSWER — do not share with learners)

Sprint 3 / DSO-W3 · "The image is compromised." A build-time secret-exposure
War Room built on the shared `backend/src/warroom/` engine (same lifecycle,
state, alert banner and reset as INC-001/INC-002).

> The student-facing runbook (`INC-003-LEARNER-RUNBOOK.md`) and every public API
> response are symptom-level only. Keep this file for the debrief.

## 1. Initial healthy state
The app runs normally (`/api/health` healthy, frontend + backend up). The image in
use is the **vulnerable** one — healthy runtime, compromised artifact. The INC-003
compose overlay (`docker-compose.inc003.yml`, layered automatically by `warroom.sh`
when `WAR_ROOM_INCIDENT=INC-003`) builds the backend from
`backend/Dockerfile.inc003-vulnerable`, which bakes the synthetic training canary
into an **image layer** (and into the final filesystem at `/app/training-canary.env`).

> There is **no runtime bind mount**: the secret ships inside the image itself, so
> `docker run <vulnerable-image>` alone already contains it. The injector only READS
> `/app/training-canary.env` to confirm the running image is the vulnerable one and
> raise the operational alert. A responding app is not evidence of a secure image.

## 2. Incident activation
`WAR_ROOM_ENABLED=true WAR_ROOM_INCIDENT=INC-003` arms the one-shot timer
(`backend/src/warroom/timer.js`); after `WAR_ROOM_INCIDENT_DELAY_SECONDS` (or an
instructor `POST /api/incident/trigger`) the INC-003 injector
(`injector_image_compromised.js`) runs.

## 3. The alert
Generic, operational — `GET /api/incident/status` headline: *"Security monitoring
detected credential material in the container image currently in use."* The brief
adds `severity: HIGH`, `status_label: INVESTIGATION REQUIRED`, and a **synthetic**
`image_ref` (`local/posturesec-backend:sprint3-compromised`). No file, no line, no
root cause, and never the secret value.

## 4. Expected investigation path
Observe (app healthy) → read the alert → inspect the image, not just the running
app → `docker history` / `docker image inspect` → scan the **container filesystem**
for credential material → scan the **image layers** (`docker save | tar`) →
discover the canary is in a layer → read the build configuration → identify how it
got in → contain → remediate the build → rebuild → re-scan → confirm clean + new
digest → confirm the app still works.

## 5. Intended root cause (THE ANSWER)
The vulnerable build (`backend/Dockerfile.inc003-vulnerable`) copies a credential
file that was left in the backend build context (`backend/training-canary.env`) into
the image (`COPY training-canary.env ./training-canary.env`), with nothing excluding
it. The synthetic credential is baked into an image layer and is present in the final
filesystem at `/app/training-canary.env`. The normal, secure backend image
(`backend/Dockerfile`) copies only `src/` and never includes the file.

## 6. Why the secret entered the image
A secret file was left in the build context and the Dockerfile copied it into the
image — no `.dockerignore` kept it out, and the copy was not scoped to source only.
The classic path: a `.env`/secret file sitting next to the app gets baked into a layer.

## 7. What evidence proves exposure (no runtime mount in any check)
- Filesystem: `docker run --rm --entrypoint sh <vuln-img> -c "grep -rl WARROOM_FAKE_SECRET /app"` → hit.
- Layers: `docker save <vuln-img> -o img.tar` then extract and `grep -a WARROOM_FAKE_SECRET` the layer blobs → hit (recoverable).
- The **trap** (`backend/Dockerfile.inc003-rm-after`): the file is `rm`-ed in a later
  layer, so the **filesystem is clean but the layer scan still finds it** — proving
  "delete the file" is not remediation.

## 8. Containment
Treat the (synthetic) credential as compromised: rotate/revoke it — here, locally
and simulated (there is nothing real to revoke). Stop distributing the vulnerable
image; do not push it to any registry.

## 9. Remediation (expected)
`backend/Dockerfile.inc003-remediated` copies only application source
(`COPY src/ ./src/`) and never the secret file; keep credential material out of the
build context (`.dockerignore` for `*.env`/keys) and inject real secrets at
**runtime** (env / mounted secret), not at build. Rebuild → the canary is absent from
the filesystem **and** the layers, and the image has a **new digest**. Rebuilding is
mandatory — you cannot patch a baked layer in place; you build a new, clean artifact.
(This corrected build is the normal, secure backend image pattern.)

## 10. Verification
`bash warroom/inc003/verify.sh` (local, no registry, no real creds) builds all three
**real backend** images and asserts, with NO bind mount: vulnerable = RED (fs +
layers), rm-after = trap (fs clean / layers dirty), remediated = GREEN (fs + layers
clean) with a digest that differs from the vulnerable image. Exit 0 only if all hold.

## 11. Recovery criteria
All 13 points in the learner runbook, the key ones being: canary absent from the
final filesystem **and** the layers, a new immutable digest, `/api/health`
healthy. "It starts" alone is not recovery.

## 12. Reset
`POST /api/incident/reset` (instructor token) returns the alarm to idle and
cancels a pending fuse; `warroom.sh down/up` with `WAR_ROOM_INCIDENT=INC-003`
rebuilds a fresh RED. No real credentials, no external state, no stray
containers/networks/volumes remain (tmpfs/disposable; `verify.sh` cleans its
images unless `--keep`).

## Safety
The canary (`backend/training-canary.env`) is an obviously-fake training value that
authenticates to nothing and is never sent anywhere. No real GHCR, no real
credentials, no production resources are involved at any point. The DSO-305
`dumb-init=1.2.5-r3` pin is preserved in every INC-003 Dockerfile.
