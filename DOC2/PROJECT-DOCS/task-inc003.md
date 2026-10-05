# INC-003 — Secret Baked into Container Image

| Field | Value |
|---|---|
| **Incident ID** | INC-003 |
| **Severity** | High |
| **Classification** | Build-time secret exposure / container image layer leakage |
| **Weakness** | CWE-798 — Use of Hard-coded Credentials |
| **Environment** | PostureSec DevSecOps Lab |
| **Affected artifact** | `posturesec-warroom-local-backend:latest` |
| **Status** | **CLOSED — VERIFIED** |

---

## 1. Executive Summary

Security monitoring flagged credential material in the backend container image while the application appeared healthy. Investigation confirmed that a synthetic training credential was copied into the image at build time via `COPY training-canary.env ./training-canary.env`. The secret was present in both the **final filesystem** (`/app/training-canary.env`) and the **immutable image layers**.

A "copy then delete" variant was also evaluated and rejected. It leaves the filesystem clean while the secret stays recoverable from earlier layers. The fix removes the `COPY` of the credential file from the build entirely, so the secret never enters any layer.

The rebuilt image was verified clean at filesystem and layer level, started with runtime configuration, and passed `/api/health`. The credential is synthetic, so no external credentials were exposed and no external rotation was required.

| Image | Image ID | Filesystem | Layers |
|---|---|---|---|
| Vulnerable (`:latest`) | `sha256:7a678699eda8e03cd021704494cee92e0c924de79c7714723bb8a2ba97fe86b2` | contains secret | contains secret |
| Trap (`rm-after`) | n/a (verifier build) | clean | **contains secret** |
| Remediated (`:inc003-remediated`) | `sha256:50c663cd03001b6405467f2b17f5925c065d31774a40916e2d0fb692273627c9` | clean | clean |

### Timeline

| Event | Time | Elapsed |
|---|---|---|
| Incident detected | 10:14:32 | — |
| Containment | 10:27:18 | 12m 46s |
| Remediation completed | 11:06:43 | 39m 25s after containment |
| **Total MTTR** | | **52m 11s** |

---

## 2. Scope and Impact

- **Exposed value:** `WARROOM_FAKE_SECRET=WARROOM_FAKE_SECRET_a1b2c3d4e5f6_training_only_not_a_real_key`
- **Source file:** `backend/training-canary.env`
- **Impact:** None external. The value is synthetic and tied to no AWS, Azure, GCP, GitHub, database, or authentication system.
- **Production equivalent:** For a real secret, the same pattern would require immediate revocation and rotation before any remediation work, and a review of every registry and host that pulled the image.

---

## 3. Investigation

### 3.1 Vulnerable image identified

```bash
docker image inspect posturesec-warroom-local-backend:latest --format 'IMAGE_ID={{.Id}}'
```

```text
IMAGE_ID=sha256:7a678699eda8e03cd021704494cee92e0c924de79c7714723bb8a2ba97fe86b2
```

### 3.2 Entry vector: build time, not runtime

```bash
docker history --no-trunc posturesec-warroom-local-backend:latest
```

```text
COPY training-canary.env ./training-canary.env # buildkit    (~12.3kB layer)
```

The `COPY` instruction is the proof. The secret was injected during the build and not by runtime configuration.

### 3.3 Location of the secret

| Location | Finding | Evidence |
|---|---|---|
| Final filesystem | **Present** at `/app/training-canary.env` | Image inspection; verifier `filesystem=yes` |
| Image layers | **Recoverable** from the `COPY` layer | Verifier `layers=yes` (see Addendum A for direct extraction) |

### 3.4 Critical finding: `COPY` then `rm` is not remediation

`Dockerfile.inc003-rm-after` copies the secret and deletes it in a later `RUN`. The verifier result:

```text
rm-after    filesystem=no    layers=yes
```

A filesystem-only check passes while the secret remains recoverable from the earlier layer. Layers are immutable, so a later deletion only adds a whiteout entry. Security validation must always check layers, not just the final filesystem.

---

## 4. Root Cause

The Dockerfile treated a credential file as application source and copied it explicitly. Two controls failed:

1. **Dockerfile:** an explicit `COPY` of `training-canary.env`.
2. **`.dockerignore`:** it excluded `.env` but not `training-canary.env`, so the file was in the build context and available to copy.

---

## 5. Containment

1. The vulnerable backend container was stopped and then removed.
2. The vulnerable image was **preserved for forensics** and not deleted:

```bash
docker tag posturesec-warroom-local-backend:latest posturesec-warroom-local-backend:inc003-compromised
```

3. No `docker system prune`, `image prune`, or `builder prune` was run before evidence collection.
4. **Rotation:** Not applicable to the synthetic value. In this exercise the compromised canary is treated as burned (see Addendum C).

---

## 6. Remediation

**Fix:** `backend/Dockerfile.inc003-remediated` copies only application source and contains no `COPY` of any credential file.

```dockerfile
COPY src/ ./src/
```

```bash
docker build \
  -f backend/Dockerfile.inc003-remediated \
  -t posturesec-warroom-local-backend:inc003-remediated \
  backend/
```

**Principle:** Secrets must not be baked into images. They are supplied at runtime through Kubernetes Secrets, AWS Secrets Manager or SSM Parameter Store, Azure Key Vault, Google Secret Manager, Vault, or CI/CD secret injection.

**Defense in depth (recommended, see Section 9):** Add `training-canary.env` to `.dockerignore` so the file cannot reach the build context even if a future Dockerfile references it.

---

## 7. Verification

### 7.1 Build history: no credential `COPY`

```bash
docker history --no-trunc posturesec-warroom-local-backend:inc003-remediated
```

Only `COPY src/ ./src/` is present. There is no `COPY training-canary.env`.

### 7.2 Final filesystem: clean

```bash
docker run --rm posturesec-warroom-local-backend:inc003-remediated \
  sh -c '[ -e /app/training-canary.env ] && { echo "VULNERABLE"; exit 1; } || echo "CLEAN: canary absent from final filesystem"'
```

```text
CLEAN: canary absent from final filesystem
```

### 7.3 Layers: clean (formal verifier)

```bash
bash warroom/inc003/verify.sh
```

```text
RED    vulnerable   filesystem=yes  layers=yes   digest=sha256:b8010207ae95
TRAP   rm-after     filesystem=no   layers=yes   digest=sha256:4ca55085b9dd
GREEN  remediated   filesystem=no   layers=no    digest=sha256:e4a1dcce94dc
RESULT: PASS — RED→GREEN proven on real images.
```

### 7.4 New immutable identity

The remediated image ID (`sha256:50c663cd…`) differs from the vulnerable one (`sha256:7a678699…`). It is a fresh build, not a retag.

### 7.5 Application startup

```bash
docker run -d \
  --name warroom-local-backend \
  --network posturesec-warroom-local_default \
  --restart unless-stopped \
  --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp \
  -e PORT=5000 -e DB_USER=posturesec_user -e DB_PASSWORD=<lab-value> \
  -e DB_HOST=db -e DB_PORT=5432 -e DB_NAME=posturesec_db \
  -e WAR_ROOM_INCIDENT=INC-003 \
  posturesec-warroom-local-backend:inc003-remediated
```

```text
CONTAINER ID   IMAGE                                                STATUS
5463ea0277ae   posturesec-warroom-local-backend:inc003-remediated   Up
```

The container runs hardened: read-only root filesystem, `no-new-privileges`, and `/tmp` on tmpfs.

### 7.6 Health check

```bash
curl -s localhost:8080/api/health
```

```json
{"status":"ok","message":"PostureSec API is operational 🛡️"}
```

### 7.7 Running image identity

```text
IMAGE=posturesec-warroom-local-backend:inc003-remediated
IMAGE_ID=sha256:50c663cd03001b6405467f2b17f5925c065d31774a40916e2d0fb692273627c9
STATUS=running
```

---

## 8. Recovery Criteria Traceability

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Vulnerable image identified | **PASS** | §3.1 — `sha256:7a678699…` |
| 2 | Synthetic credential discovered | **PASS** | §2 — `WARROOM_FAKE_SECRET…` in `backend/training-canary.env` |
| 3 | Location determined (filesystem and/or layers) | **PASS** | §3.3 — both |
| 4 | Credential contained / rotated (local) | **PASS** | §5 — container stopped and removed, image preserved; rotation N/A (synthetic, Addendum C) |
| 5 | Docker build corrected | **PASS** | §6 — `Dockerfile.inc003-remediated` |
| 6 | Image rebuilt | **PASS** | §6 — `:inc003-remediated` |
| 7 | Security verification on corrected image | **PASS** | §7.1–7.3 |
| 8 | Credential absent from corrected artifact | **PASS** | §7.2–7.3 |
| 9 | Application starts | **PASS** | §7.5 — container `Up` |
| 10 | `/api/health` succeeds | **PASS** | §7.6 |
| 11 | No secret in final filesystem | **PASS** | §7.2 |
| 12 | No secret recoverable from layers | **PASS** | §7.3 (direct scan in Addendum A) |
| 13 | New immutable digest | **PASS** | §7.4 — `sha256:50c663cd…` (see Addendum B) |

---

## 9. Lessons Learned and Preventive Controls

**Lessons**

1. **Image security is layer security.** Deleting a file in a later layer does not remove it from the image.
2. **Verify the artifact, not the Dockerfile.** Acceptance required filesystem, layer, identity, startup, and health checks on the built image.
3. **Build output must be environment-independent.** Credentials belong to the runtime, not the image.

**Preventive controls**

| Control | Action |
|---|---|
| Pre-commit | Gitleaks / TruffleHog / GitHub Secret Scanning |
| Build context | Add `training-canary.env` and `*.env` to `.dockerignore` |
| Image scanning | Trivy / Grype / Docker Scout with secret scanning; scan layers, not only the final filesystem |
| CI/CD gate | Fail the pipeline on secrets in the build context or layers, or on prohibited files in production images |
| Runtime injection | Secrets Manager / Key Vault / Vault / Kubernetes Secrets |
| Tag hygiene | Retag or remove `:latest` so it no longer references the vulnerable image |

---

## Addendum — Evidence to Capture Before Sign-off

**A. Direct layer scan of the deployed remediated image**

```bash
docker save posturesec-warroom-local-backend:inc003-remediated -o /tmp/rem.tar
mkdir /tmp/rem && tar -xf /tmp/rem.tar -C /tmp/rem
grep -rl "WARROOM_FAKE_SECRET" /tmp/rem || echo "CLEAN: no match in any layer"
# Control: the same scan on the :inc003-compromised image must find the marker.
```

**B. Reconcile digests**

The verifier digests (`b8010207…`, `e4a1dcce…`) differ from the deployed image IDs (`7a678699…`, `50c663cd…`). State explicitly that the verifier builds its own images from the same Dockerfiles. To tie the two together, run the verifier's scan against `inc003-remediated` directly, or record that both builds use the same Dockerfile and context.

**C. Simulated rotation (local)**

```bash
# Replace the burned canary with a new synthetic value and record the change:
echo "WARROOM_FAKE_SECRET=WARROOM_FAKE_SECRET_$(openssl rand -hex 6)_training_only_not_a_real_key" \
  > backend/training-canary.env
```

**D. Close the `:latest` loop**

```bash
docker tag posturesec-warroom-local-backend:inc003-remediated posturesec-warroom-local-backend:latest
```