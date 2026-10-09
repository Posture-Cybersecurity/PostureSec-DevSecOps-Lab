# DSO-305 — No secrets in Docker image layers

**Sprint:** 3 &nbsp;•&nbsp; **Area:** Container security &nbsp;•&nbsp; **Type:** Student task &nbsp;•&nbsp; **Time:** ~45 min

> You will prove two **separate** things and keep their evidence apart:
> 1. **Hadolint is clean** for `backend/Dockerfile` and `frontend/Dockerfile` under the lab policy.
> 2. **No secret is baked into any image layer** — and secrets are delivered at **runtime** instead.
>
> Linting does **not** prove secrets are absent, and a file missing from the final
> filesystem does **not** prove the secret is gone from the image. Each is shown
> with its own command and its own evidence.

Every secret in this exercise is **synthetic**. Never paste a real credential anywhere.

---

## 1. Learning objectives

By the end you can:

- Explain what a Docker image layer is and why a secret written into one layer is
  **permanent** even if a later layer deletes the file.
- Distinguish four different places a secret can leak: **build-time**, **image
  layers (filesystem history)**, **image configuration / `ENV`**, and
  **runtime-injected** values.
- Recover a synthetic secret from an image layer to demonstrate the risk.
- Prove a remediated image contains no secret and that the real secret is injected
  only at runtime.
- Run Hadolint under the lab policy and interpret its output and exit code.

## 2. Prerequisites

- **Docker 20.10+** (BuildKit is on by default in 23.0+; this exercise works with
  or without BuildKit).
- A POSIX shell: Linux/macOS terminal, or **Git Bash** on Windows.
- A clean checkout of this repository. **Run every command from the repository
  root** unless a step says otherwise.
- Network access to pull public base images (`node`, `nginx`, `postgres`,
  `alpine`, `hadolint/hadolint`).
- **Node is *not* required on your host** — the test step runs inside a container.

Confirm Docker is available:

```bash
docker --version
```

## 3. Background

### 3.1 What an image layer is
A Docker image is an **ordered stack of read-only layers**. Each `RUN`, `COPY`,
and `ADD` adds one layer recording the filesystem changes that instruction made.
A running container adds one thin writable layer on top. Every layer ships inside
the image. Inspect the stack:

```bash
docker history --no-trunc <image>
```

### 3.2 Why a deleted secret is still recoverable
Layers are immutable and all kept in the image. **Deleting a file in a later layer
does not remove it from the earlier layer that created it** — the later layer only
records a "whiteout" that hides the file on the *final* filesystem. Anyone with the
image can unpack the earlier layer and read the bytes. So this is **not** safe:

```dockerfile
COPY .env /app/.env      # layer A — the secret is in the image forever
RUN rm /app/.env         # layer B — hides it from the final FS, does NOT delete layer A
```

### 3.3 Four places a secret can leak (know the difference)
| Where | What it means | Safe? |
|------|----------------|-------|
| **Build-time** | A secret needed only while building (e.g. a private registry token). Passed via `--build-arg` it lands in image config/history; the safe way is a **BuildKit secret mount** (`RUN --mount=type=secret …`) which is *not* persisted. | `--build-arg`: **no**. BuildKit secret mount: **yes**. |
| **Image layer** | A secret written to the filesystem by `COPY`/`ADD`/`RUN`. Permanent in that layer even after deletion. | **No** |
| **Image config / `ENV`** | A value set with `ENV` in the Dockerfile (or `--build-arg` consumed by `ENV`). Stored in the image config, visible via `docker inspect` / `docker history`. | **No** for secrets |
| **Runtime-injected** | Provided only when the container runs — `docker run -e`, Compose `environment:`, or an orchestrator secret. Lives in the process, not the image. | **Yes** |

This repo uses the safe option: the backend reads `process.env.DB_PASSWORD`
(`backend/src/db.js`), and `docker-compose.yml` injects it per-container at runtime.
`backend/.dockerignore` lists `.env`, so a developer's real `.env` can never enter
the build context.

---

## 4. The exercise

The lab ships a deliberately vulnerable demo and an evidence harness under
`security/dso-305/`:

| File | Purpose |
|------|---------|
| `Dockerfile.vulnerable` | writes a **synthetic** secret in one layer, deletes it in a later layer |
| `verify.sh` | builds the vulnerable + real images and proves all four secret-layer facts |
| `run-hadolint.sh` | runs the pinned Hadolint over both Dockerfiles |

Work through the **Manual Validation** runbook below and collect the evidence.

---

## 5. Manual Validation runbook

Run everything from the **repository root**.

### A. Confirm the working tree and files

```bash
git rev-parse --abbrev-ref HEAD          # the branch you are on
git status --short                        # expected: clean (or only your evidence notes)
ls -1 security/dso-305/ DOC2/PROJECT-DOCS/DSO-305-No-Secrets-In-Layers.md
```

**Expected:** `Dockerfile.vulnerable`, `verify.sh`, `run-hadolint.sh` and this guide
are all present.

### B. Run Hadolint  *(acceptance criterion 1 — keep its evidence separate)*

Pinned to **v2.12.0**, the binary bundled by the lab's CI
(`hadolint/hadolint-action@v3.1.0`), with the same policy CI uses
(`--failure-threshold warning`; there is no `.hadolint.yaml` and no ignore list, so
default rules apply):

```bash
bash security/dso-305/run-hadolint.sh
```

or each Dockerfile individually:

```bash
docker run --rm -i hadolint/hadolint:v2.12.0 hadolint --failure-threshold warning - < backend/Dockerfile
docker run --rm -i hadolint/hadolint:v2.12.0 hadolint --failure-threshold warning - < frontend/Dockerfile
```

**Expected:** **zero findings** for each Dockerfile; the runner exits `0`.

**If it fails:** each line is `-:LINE CODE level: message`. A **non-zero exit**
means at least one finding at `warning` or `error`; levels below the threshold
(`info`, `style`) print but do not fail. Fix the Dockerfile — **do not** lower the
threshold or add a blanket `hadolint ignore`. (`DL3018` = "pin versions in
`apk add`"; verify a pin actually exists for the current base image before
changing it: `docker run --rm node:20-alpine sh -c 'apk policy dumb-init'`.)

### C. Build the images

```bash
docker build -t dso305-backend:check backend
docker build -t dso305-frontend:check frontend
```

**Expected:** both builds finish with `naming to docker.io/library/dso305-*:check`
and no error. (These tags are removed in step F.)

**If a build fails:** read the failing `RUN` step. A common real failure is a stale
Alpine package pin (the pinned version was dropped from the mirror) — re-check the
available version as shown in step B before changing anything.

### D. Verify secret-layer behavior  *(acceptance criterion 2)*

```bash
bash security/dso-305/verify.sh
```

The harness proves, with synthetic values and disposable images:

1. the vulnerable image's secret is **absent from the final filesystem** (deleted
   in the last layer) **but recoverable from an earlier layer**;
2. the remediated backend image contains the DB password in **no layer** and
   **not** in its baked `ENV`;
3. a unique runtime-injected value reaches the process but is **absent from every
   image layer**.

**Expected:** `RESULT: 8 passed, 0 failed`, then a cleanup line. **Do not** weaken
any assertion to reach this; if the result differs, investigate and report the
actual numbers.

To *see* the layer recovery yourself:

```bash
docker build -f security/dso-305/Dockerfile.vulnerable -t dso305-vuln:demo security/dso-305
docker run --rm dso305-vuln:demo cat /root/app.secret    # -> "No such file" (final FS)
tmp="$(mktemp -d)"; docker save dso305-vuln:demo -o "$tmp/img.tar"
mkdir -p "$tmp/x" && tar -xf "$tmp/img.tar" -C "$tmp/x"
find "$tmp/x" -type f -exec sh -c \
  'gzip -dc "$1" 2>/dev/null | grep -al "SYNTHETIC-DSO305-SECRET" || grep -al "SYNTHETIC-DSO305-SECRET" "$1"' _ {} \;
rm -rf "$tmp"; docker image rm -f dso305-vuln:demo
```

The `cat` prints "No such file"; the `find` prints a layer-blob path — gone from the
final FS, still in a layer.

### E. Runtime injection + regression (backend Jest)

Prove the DB password is delivered at runtime, never baked, and run the backend
suite against a **disposable** Postgres. Node and jest run inside a throwaway
container built from the backend source, so you need **no host Node** and your
checkout is **not modified**. A standalone, uniquely-named Postgres is used instead
of the Compose `db` service because `docker-compose.yml` pins
`container_name: posturesec-db1`, which collides if another lab's database is
already running.

```bash
# 1) disposable Postgres on its own network (synthetic creds)
docker network create dso305-net
docker run -d --name dso305-db --network dso305-net \
  -e POSTGRES_USER=posturesec_user -e POSTGRES_PASSWORD=posturesec_pass_2026 \
  -e POSTGRES_DB=posturesec_db postgres:16-alpine

# 2) wait until it is ready to accept connections
until docker exec dso305-db pg_isready -U posturesec_user -d posturesec_db >/dev/null 2>&1; do sleep 2; done

# 3) build a throwaway TEST image (includes dev deps: jest/supertest)
docker build -t dso305-tests:tmp -f - backend <<'DOCKERFILE'
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
CMD ["npm","test"]
DOCKERFILE

# 4) run Jest with DB creds injected at RUNTIME via -e (never baked into an image)
docker run --rm --network dso305-net \
  -e DB_HOST=dso305-db -e DB_PORT=5432 -e DB_USER=posturesec_user \
  -e DB_PASSWORD=posturesec_pass_2026 -e DB_NAME=posturesec_db \
  dso305-tests:tmp
```

**Expected:** `Test Suites: 2 passed, 2 total` and `Tests: 22 passed, 22 total`
(report the counts you actually observe). The credentials exist only in the
containers' runtime environment — they are in no image you built. Clean up these
resources in step F.

### F. Inspect and clean up (scoped — never broad prune)

Inspect configuration/layers without printing a real secret:

```bash
docker image inspect dso305-backend:check --format '{{json .Config.Env}}'   # no DB_PASSWORD
docker history --no-trunc dso305-backend:check | head
```

Remove only what this exercise created:

```bash
docker rm -f dso305-db 2>/dev/null || true            # the disposable Postgres (step E)
docker network rm dso305-net 2>/dev/null || true      # its network (step E)
docker image rm -f dso305-tests:tmp dso305-backend:check dso305-frontend:check 2>/dev/null || true
```

> **Never** run `docker system prune`, `docker image prune -a`, or any broad
> volume/network prune — they would destroy unrelated developer resources.
> `verify.sh` already removes its own images and tarballs.

---

## 6. Evidence to submit

1. **Lint:** output of step B showing both Dockerfiles clean (exit 0). *(separate)*
2. **Builds:** step C showing both builds succeed.
3. **Secret recoverable:** the step D `find` printing a layer path, and `cat`
   printing "No such file".
4. **Harness:** `verify.sh` output `8 passed, 0 failed`.
5. **Runtime + regression:** step E Jest summary and the `-e` injection command.

Keep the **lint** evidence and the **secret-layer** evidence in separate sections —
they are separate acceptance criteria.

## 7. Final checklist

- [ ] On a clean checkout, all four DSO-305 files are present (step A).
- [ ] `run-hadolint.sh` → both Dockerfiles clean, exit 0 (step B).
- [ ] Backend and frontend images build (step C).
- [ ] `verify.sh` → `8 passed, 0 failed` (step D).
- [ ] Layer recovery observed by hand: gone from final FS, present in a layer (step D).
- [ ] Jest suite green against the disposable DB; creds injected via `-e` (step E).
- [ ] No secret in `docker image inspect … .Config.Env` (step F).
- [ ] Only this exercise's resources removed; no broad prune used (step F).

## 8. Guardrails

- Synthetic secrets only — never a real credential, even in the vulnerable demo.
- Never put a secret in a build `ARG`, in `ENV`, or in any image layer. Inject at
  runtime; use a **BuildKit secret mount** if a secret is genuinely needed *during*
  the build.
- Do not weaken the lint policy or add broad `hadolint ignore` directives to pass.
- Scope all cleanup to resources you created; never broad-prune.
- Deleting a leaked secret from an image does **not** invalidate copies that already
  exist — in a real incident you must **rotate/revoke** the credential, not just
  rebuild. (Operational response is covered by the instructor guide.)
- This document is DSO-305 only. Do not document or reveal the hidden solution of
  any incident or other exercise.
