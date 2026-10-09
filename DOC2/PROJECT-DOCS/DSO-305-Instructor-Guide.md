# DSO-305 — Instructor guide (No secrets in image layers)

> **Instructor-only.** Do not paste the "root cause" sections into student-facing
> material. Let students *observe* the evidence in the student guide
> (`DSO-305-No-Secrets-In-Layers.md`) and reason about it before you explain why.
> This guide complements — it does not replace — the student guide.

All commands use **synthetic** credentials. Run from the repository root.

---

## 1. Lesson plan (40 min)

| Time | Segment | You do |
|-----:|---------|--------|
| 0–3 | **Hook** | Ask: "If you `COPY` a secret then `rm` it in the next line, is it gone?" Take a show of hands. Don't answer yet. |
| 3–8 | **Framing (§2)** | State the two separate claims (lint clean *and* no secrets in layers) and the learning outcomes. |
| 8–18 | **Live demo (§3–§4)** | Build the vulnerable image; show the file is gone from the final FS; then recover it from a layer. |
| 18–24 | **Socratic (§5)** | Ask the discussion questions *before* revealing the mechanism. |
| 24–30 | **Root cause (§6)** | Explain layers + whiteout; draw the layer stack. |
| 30–37 | **Remediation (§7–§8)** | Runtime injection (this repo), BuildKit secret mounts, and the other leak channels. |
| 37–40 | **Wrap + incident note** | Rotation beats deletion; point at the rubric and cleanup. |

**Prep before class:** pre-pull images to avoid live download waits:
```bash
docker pull node:20-alpine; docker pull nginx:1.27-alpine
docker pull postgres:16-alpine; docker pull alpine:3.23
docker pull hadolint/hadolint:v2.12.0
```

## 2. Opening (say this)

"An image is a stack of read-only layers. Today we prove two things, separately:
Hadolint passes under our CI policy, **and** no secret is baked into any layer —
because lint passing tells you nothing about secrets. You'll recover a planted
synthetic secret from an image whose author thought they'd deleted it."

**Learning outcomes:** students can recover a secret from a layer, explain why
deletion doesn't help, name the four leak channels, and show the remediated image +
runtime injection.

## 3. Live demonstration — the vulnerable image

```bash
docker build -f security/dso-305/Dockerfile.vulnerable -t dso305-vuln:demo security/dso-305
# It looks clean on the final filesystem:
docker run --rm dso305-vuln:demo cat /root/app.secret     # -> "No such file or directory"
```

Pause here. The file is gone from the running container. Ask the room whether the
secret is safe now.

## 4. Prove the secret survives in an earlier layer

```bash
# See the instruction that created it, and the one that deleted it:
docker history --no-trunc dso305-vuln:demo

# Unpack the image and grep the layers for the synthetic secret:
tmp="$(mktemp -d)"
docker save dso305-vuln:demo -o "$tmp/img.tar"
mkdir -p "$tmp/x" && tar -xf "$tmp/img.tar" -C "$tmp/x"
find "$tmp/x" -type f -exec sh -c \
  'gzip -dc "$1" 2>/dev/null | grep -al "SYNTHETIC-DSO305-SECRET" || grep -al "SYNTHETIC-DSO305-SECRET" "$1"' _ {} \;
rm -rf "$tmp"
```

The `find` prints a layer-blob path containing
`SYNTHETIC-DSO305-SECRET=dso305_fake_token_do_not_use_7f3a9c2b1e`. The automated
harness (`bash security/dso-305/verify.sh`) does the same and reports
`8 passed, 0 failed`.

## 5. Ask before you explain

- "The `cat` showed nothing — why did `grep` still find it?"
- "Who can read this layer? Only the author? Anyone who pulls the image? A CI cache?"
- "Does squashing the image fix it? Does `.gitignore`? Does `.dockerignore`?"
- "If this were a real AWS key, what's the *first* thing you'd do?" (Expect
  "delete the image" — steer toward **rotate/revoke**.)

## 6. Root cause (explain now)

Each `RUN`/`COPY`/`ADD` creates **one immutable layer** recording that step's
filesystem changes. The image is the ordered stack. When a later layer deletes a
file, it records a **whiteout** entry that *hides* the path in the merged (final)
filesystem — it cannot edit or remove the earlier layer, which still contains the
bytes. Anyone with the image can extract the earlier layer (as in §4) and read the
secret. Therefore:

- `COPY secret … ; RUN rm secret` → **still leaked.**
- "Squashing" only helps if done so the secret-bearing layer is never published, and
  it is brittle — don't rely on it.
- The only reliable rule: **the secret must never enter a layer in the first place.**

## 7. Secure remediation

**This repo (runtime injection).** The backend reads `process.env.DB_PASSWORD`
(`backend/src/db.js`); `docker-compose.yml` injects it per-container; `.env` is in
`backend/.dockerignore`. Show it is not in the image:

```bash
docker build -t dso305-backend:demo backend
docker image inspect dso305-backend:demo --format '{{json .Config.Env}}'   # no DB_PASSWORD
docker run --rm -e DB_PASSWORD=injected_demo --entrypoint printenv dso305-backend:demo DB_PASSWORD  # -> injected_demo
```

**Build-time secrets (when genuinely needed).** If a build truly needs a secret
(e.g. a token to pull a private dependency), do **not** use `--build-arg`/`ENV`
(both persist in image config/history). Use a **BuildKit secret mount**, which is
mounted only for that `RUN` and never written to a layer:

```dockerfile
# syntax=docker/dockerfile:1.7
RUN --mount=type=secret,id=npmtoken \
    NPM_TOKEN="$(cat /run/secrets/npmtoken)" npm ci
```
```bash
DOCKER_BUILDKIT=1 docker build --secret id=npmtoken,src=./npmtoken.synthetic .
```
The secret is available during that step only; it is not in any layer, in `ENV`, or
in `docker history`.

## 8. Distinguish the leak channels

A secret can escape through more than image layers. Teach students to check each:

| Channel | How to detect | Fix |
|--------|----------------|-----|
| **Image layer (filesystem)** | `docker save` + grep layers (§4) | never `COPY`/write it; BuildKit secret mount |
| **Image config / `ENV`** | `docker image inspect --format '{{json .Config.Env}}'` | inject at runtime, never `ENV` a secret |
| **`docker history` / build args** | `docker history --no-trunc` shows `--build-arg` values | BuildKit secret mount, not `--build-arg` |
| **Build / CI logs** | grep CI output; `set -x` echoes | mask values; never `echo` a secret |
| **Shell history** | `history | grep -i secret` | pass via files/env, not inline args |
| **Registry/cache copies** | who pulled the image; cache layers | rotate, and purge distributed copies |

## 9. Expected results & troubleshooting

- `run-hadolint.sh` → zero findings, exit 0 for both Dockerfiles.
- `docker build backend` and `docker build frontend` → succeed.
- `verify.sh` → `8 passed, 0 failed`.
- Backend Jest → `2 suites passed, 22 tests passed, 0 failed` (see student §E).

Common issues:
- **`verify.sh` "could not recover the secret"** → Docker too old to `docker save` in
  a readable format, or the build was skipped; rebuild and check Docker ≥ 20.10.
- **Jest can't reach the DB** → the disposable Postgres isn't ready; wait for
  `pg_isready` before running (student §E loops on it). Note the repo compose pins
  `container_name: posturesec-db1`, so a second compose DB collides — the student
  guide uses a standalone uniquely-named Postgres to avoid this.
- **Hadolint finding appears after an edit** → fix the Dockerfile; never add a broad
  `hadolint ignore` or lower the threshold to pass.
- **Alpine package pin fails to build** → the pinned version was dropped from the
  mirror; re-check availability (`apk policy <pkg>`) before changing the pin.

## 10. Assessment rubric (observable)

| Criterion | Pass evidence |
|----------|----------------|
| Runs lint correctly | `run-hadolint.sh` output, both clean, exit 0 — kept separate from secret evidence |
| Recovers the secret | layer-blob path from §4 **and** "No such file" from the final FS |
| Explains the mechanism | states immutable layers + whiteout; says deletion doesn't remove earlier layer |
| Shows remediation | `Config.Env` has no secret; runtime `-e` delivers it |
| Names ≥3 leak channels | from §8 (layer, ENV, history/build-arg, logs, shell, registry) |
| Correct incident instinct | says **rotate/revoke**, not just delete/rebuild |
| Clean workspace | only exercise resources removed; no broad prune |

Full pass = all seven. Partial = recovers secret + explains mechanism but misses
remediation or channels.

## 11. Review questions (with answers)

1. *You `rm` a secret in the last layer — safe?* No; the earlier layer still holds it
   and is extractable.
2. *Is `--build-arg TOKEN=…` safe for a build secret?* No; it persists in image
   config/history. Use a BuildKit secret mount.
3. *Hadolint passed — does that mean no secrets are baked in?* No; lint checks
   Dockerfile best-practices, not layer contents. Separate criteria.
4. *Where does this repo's DB password live at rest?* Nowhere in the image — only in
   the container's runtime environment (compose `environment:` / `docker run -e`).
5. *A real key leaked into a published image — first action?* Rotate/revoke the
   credential and investigate distribution; deleting the image does not invalidate
   copies already pulled.

## 12. Cleanup & evidence checklist

Scoped cleanup only — **never** `docker system prune` or broad image/volume/network
prune:

```bash
docker image rm -f dso305-vuln:demo dso305-backend:demo 2>/dev/null || true
# verify.sh and the student test steps remove their own resources.
```

Collect from each student:
- [ ] lint output (both Dockerfiles clean, exit 0) — separate section
- [ ] `verify.sh` → 8 passed, 0 failed
- [ ] a recovered-secret layer path + "No such file" from the final FS
- [ ] `Config.Env` with no secret + a runtime `-e` injection showing the value
- [ ] backend Jest summary
- [ ] confirmation that only exercise resources were removed

---

### Incident-response note (say it explicitly)
Removing a leaked secret from an image — or deleting the image — **does not**
invalidate copies that already exist in registries, caches, developer machines, or
CI. In a real incident you **rotate or revoke** the exposed credential first, then
investigate where the image was distributed and who could access it, and finally
rebuild from corrected source. Treat any secret that ever touched a layer as
compromised.
