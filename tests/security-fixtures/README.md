# DSO-703 — Deterministic Security Fixtures

Controlled, isolated fixtures that **prove each scanner gate enforces its policy**.
They are deliberately vulnerable (or deliberately clean) inputs with a **documented,
pinned, repeatable** expected outcome. They are exercised only by
`.github/workflows/security-fixtures.yml` and are **never part of the PostureSec
application or any deploy path** (see "Isolation" below).

> These fixtures are test inputs, not application code. Do not import them, add them
> to an image, or reference them from `k8s/` or `terraform/`.

## Verified locally on 2026-11-17

| Fixture | Scanner | Pinned input | Expected finding | Expected exit |
|---|---|---|---|---|
| `sca/vulnerable` | npm audit | `lodash@4.17.4` (+ committed lockfile) | `GHSA-35jh-r3h4-6jhm` (command injection, high) among several high/critical | **1** |
| `sca/clean` | npm audit | `ms@2.1.3` (+ committed lockfile) | none | **0** |
| `trivy/vulnerable` | Trivy | `python@sha256:b5ee5360…febf1527` | `CVE-2024-45491` (libexpat1, critical, **fixed**) | **1** |
| `trivy/clean` | Trivy | `gcr.io/distroless/static-debian12@sha256:d75cdd72…1843f2` | none | **0** |
| `checkov/insecure` | Checkov | SG with SSH open to `0.0.0.0/0` | `CKV_AWS_24` FAILED | **1** |
| `checkov/compliant` | Checkov | SG restricted to `10.0.0.0/16` | none failed | **0** |

Scanner versions pinned by the test workflow: **Trivy 0.76.2**, **Checkov 3.4.5**,
Node 20. Trivy DB is frozen to the **2026-11-17** snapshot (see below).

## Per-fixture detail

### 1. SCA — vulnerable (`sca/vulnerable/`)
- **Pin:** `lodash` exactly `4.17.4`, with a committed `package-lock.json`.
- **Expected:** `npm audit --audit-level=high` reports multiple high/critical lodash
  advisories; the stable assertion is **`GHSA-35jh-r3h4-6jhm`** (CVE-2021-23337, command
  injection). **Exit 1.**
- **Run:** `cd sca/vulnerable && npm ci && npm audit --audit-level=high`
- **Verify:** exit is non-zero **and** output contains `GHSA-35jh-r3h4-6jhm`.
- **Isolation:** its own directory; the app's `sca` job globs `backend/` and `frontend/`
  only; never installed into an image (build contexts are `./backend`, `./frontend`).

### 2. SCA — clean control (`sca/clean/`)
- **Pin:** `ms` exactly `2.1.3` (tiny, zero-dependency, no advisory history), committed lockfile.
- **Expected:** `found 0 vulnerabilities`. **Exit 0.**
- **Note:** `lodash@4.17.21` is deliberately **not** used as the clean control — even the
  latest 4.x now trips a high advisory (`GHSA-r5fr-rjxr-66jc`), which is itself a good
  teaching point about dependency EOL.

### 3. Trivy — vulnerable (`trivy/vulnerable/image.ref`)
- **Pin:** `python@sha256:b5ee5360b357dcd0ab2e1cc5e22fa589b6734bbd55776df6b1700994febf1527`
  (`python:3.11.0-slim`, Debian 11 base) — pinned **by digest**, chosen because it carries
  **fixed** critical CVEs (so `--ignore-unfixed`, which the app gate uses, still flags them).
- **Expected:** `CVE-2024-45491` (libexpat1, critical) present; `--severity CRITICAL,HIGH
  --ignore-unfixed --exit-code 1` → **exit 1.**
- **Determinism (vuln DB versioning):** a pinned image is **not** sufficient — Trivy's DB
  updates ~daily and findings drift. This fixture pins **all four axes**:
  1. image by digest; 2. Trivy binary (`aquasec/trivy:0.76.2`); 3. the **vuln DB** (cached
  under a fixed key `trivy-db-2026-11-17` and used with `--skip-db-update`, freezing it to
  the 2026-11-17 snapshot); 4. the assertion is a **specific CVE id**, not a count.

### 4. Trivy — clean control (`trivy/clean/image.ref`)
- **Pin:** `gcr.io/distroless/static-debian12@sha256:d75cdd72874d4790092fcb1b058493ecf6bb5bf2b2b897045b00ff01d91843f2`
  — a realistic, minimal base that is clean under the pinned DB.
- **Expected:** no CRITICAL/HIGH under the pinned DB. **Exit 0.**
- **Note:** "clean" is **relative to the pinned DB snapshot**; freezing the DB is what makes
  this deterministic. `alpine:3.20` was rejected as the control because it already trips a
  high under the current DB.

### 5. Checkov — insecure (`checkov/insecure/main.tf`)
- **Pin:** a security group opening SSH (`22`) to `0.0.0.0/0`. Checkov is static analysis
  (no DB), so the result is deterministic per **Checkov version (3.4.5)**.
- **Expected:** `CKV_AWS_24` FAILED (the only failure). **Exit 1** (`soft_fail=false`).
- **Run:** `checkov -d checkov/insecure --framework terraform`
- **Verify:** exit non-zero **and** output contains `CKV_AWS_24`.
- **Scoped skip:** `CKV2_AWS_5` (an SG-must-be-attached *architecture* check) is skipped
  in-file with justification — it is orthogonal to the SG-ingress property under test and
  is **not** a suppressed vulnerability; attaching the SG to an instance would only drag in
  unrelated EC2 checks.

### 6. Checkov — compliant control (`checkov/compliant/main.tf`)
- **Pin:** the same SG type, restricted to `10.0.0.0/16`, no world-open rule.
- **Expected:** zero failed checks. **Exit 0.** (`CKV2_AWS_5` skipped in-file, as above.)

## Isolation — how these never reach production

- **Outside the build context.** App images build from `./backend` and `./frontend` only;
  a repo-root `tests/` directory can never be copied into an application image.
- **Outside the scan scope.** The app pipeline scans `backend/` + `frontend/` (SCA),
  `terraform/` + `k8s/` (Checkov). It never scans `tests/security-fixtures/`.
- **Never applied / never deployed.** The Terraform fixtures have no `provider`, no
  `backend`, and no credentials; `terraform apply` never targets this directory. The
  fixture container images are never pushed to GHCR and are never referenced by `k8s/`.
- **Separate workflow.** Fixtures run only in `security-fixtures.yml` (triggered on changes
  under `tests/security-fixtures/**` or manual dispatch), not in the application pipeline.

## Deployment-bot gating (scenarios 7–8)

- **Any mandatory scanner fails → deploy bot blocked:** demonstrated on the **application**
  pipeline (run `44048569920`: SCA failed → `update-manifest` was skipped), and structurally
  guaranteed by `update-manifest.needs` depending on the security gates.
- **All mandatory gates pass → deploy bot eligible:** demonstrated on the **clean fixture
  path**, not on the app branch — the app deliberately retains real vulnerabilities, so its
  pipeline stays red by design.
