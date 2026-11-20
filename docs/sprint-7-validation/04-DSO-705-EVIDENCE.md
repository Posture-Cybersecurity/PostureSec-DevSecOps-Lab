# DSO-705 — Evidence: Secret Hygiene (push protection & rotation)

Branch `feature/sprint-7-gitops-cicd-security`, 2026-11-17.

## 1. Objective
Stop secrets from entering git (scanning gate + pre-commit + GitHub push protection)
and define **rotation** for the credentials that already exist.

## 2. Audit (read-only, before changes)
- **No** secret-scanning tooling (greenfield).
- `.gitignore` already covered `.env`, `terraform/*.tfstate`, `k8s/*-secret.yaml`.
- Only `.example` secret files committed; **no live secret pattern in the working tree.**
- A narrow `ghp_`/`AKIA` history pickaxe found only **detection regexes** (a Jest test + a
  guide), not leaks — **but that search was too narrow**, as the gate later proved.
- GitHub push-protection status: **unreadable** with the available token (repo-admin-gated).

## 3. Implementation (commit `6688841`)
- **`secret-scan` gate** in `ci-cd.yml`: gitleaks **v8.30.1**, full-history scan,
  `.gitleaks.toml` config, SARIF artifact. **Independent, enforcing**, and a **mandatory
  `security-gates` dependency** — a detected secret blocks publish + deploy.
- **`.pre-commit-config.yaml`**: gitleaks hook (shift-left, pinned).
- **`.gitleaks.toml`**: default ruleset + a **narrow, documented** allowlist (the `.example`
  files and the warroom detection-regex files) — *not* secret suppression.
- **Two fixtures** (in `security-fixtures.yml`): a **runtime-generated** planted secret MUST
  be detected; a clean file MUST pass. Nothing secret-shaped is ever committed, so the
  fixtures cannot trip push protection.
- **`DSO-705-SECRET-ROTATION.md`**: rotation runbook.

## 4. Enforcement proof
**Fixtures run [`44062354609`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44062354609): 9/9 ✅** — incl. `Secrets: planted secret MUST be detected` and `Secrets: clean config MUST pass`.

**App run [`44062354608`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44062354608): `Secret Scan` FAILED — `leaks found: 8`.** The gate immediately caught **real committed secrets** the narrow audit missed:

| File | Rule(s) | What it is |
|---|---|---|
| **`k8s/posturesec.yaml`** (tree + history) | `kubernetes-secret-yaml`, `generic-api-key` | Hardcoded Postgres `Secret` — base64 user/password/db (**base64 is encoding, not encryption**); the password was even spelled out in a comment (`posturesec_pass_2026`). |
| `k8s/jerney.yaml` (history) | `kubernetes-secret-yaml`, `generic-api-key` | The same Secret, pre-rebrand. |
| `doc2/…/task-dso-103.md` (history) | `generic-api-key` | A demo password (`StrongPass123`) in `curl` examples — low severity, still a committed credential pattern. |

These were **not allowlisted** — preserving the failure is the honest outcome.

## 5. Remediation (commit `2a1f121`)
- Removed the inline `Secret` **and** the plaintext comment from `k8s/posturesec.yaml`.
- Replaced with out-of-band creation + a **placeholder-only** `k8s/posturesec-db-secret.yaml.example`.
- `.gitignore`d `k8s/posturesec-db-secret.yaml`.
- The db/backend still reference the secret by name (`envFrom.secretRef` / `env.secretKeyRef`),
  so behaviour is unchanged when the secret is created before `apply`.
- **Verified:** working tree is secret-free (gitleaks: *no leaks*); manifest still valid.

## 6. Acceptance-criteria verification
- ✅ Secret-scanning **gate enforces** and blocks publish/deploy (proven: `secret-scan` fails,
  `security-gates`/`build-push`/`update-manifest` skipped).
- ✅ **Pre-commit** hook configured (shift-left).
- ✅ Detection proven **deterministically** (planted → detected; clean → pass).
- ✅ **Rotation** procedure documented for GHCR PAT, PostgreSQL, Argo CD.
- ⚠️ **GitHub push protection** — a repo-admin setting; **flagged**, not claimed. Enable under
  *Settings → Code security → Secret scanning → Push protection*.

## 7. Honest caveats / open items
- **`secret-scan` stays red** until the exposed password is **rotated** (your action) and the
  **history is purged** (destructive, authorised separately). Remediating the current file does
  not erase the past — rotation is what actually protects the credential.
- The GHCR token shared in chat this session should be rotated (runbook §1).
- Push protection is server-side and cannot be enabled from the pipeline.

## 8. Integrity statement
No real finding was allowlisted or suppressed to force green. The allowlist covers only
`.example` templates and known detection-regex files. No application dependency changed.
Nothing merged or deployed.
