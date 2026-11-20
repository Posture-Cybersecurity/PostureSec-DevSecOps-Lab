# DSO-705 — Student Practical Exercise

## Scenario
Your repo has no secret scanning, and secrets may already be committed. Add an **enforcing**
secret-scanning gate, prove it works, find and remediate any committed secret, and define
rotation. **Do not** allowlist a real finding to get a green result.

Work on a branch off `origin/dev`. Do **not** merge or deploy.

## Tasks
1. **Add a scanning gate.** Add a gitleaks job (pinned version) that scans the **full
   history** and **fails** on a finding. Make it a mandatory dependency of whatever gates
   publishing/deployment, so a leak blocks the deploy.
2. **Shift left.** Add a `.pre-commit-config.yaml` gitleaks hook.
3. **Prove it deterministically.** Add a test that a **planted** secret is detected and a
   **clean** file passes — without committing any secret-shaped string (generate it at test
   time).
4. **Triage the findings.** Run the gate. For every finding, decide: real secret (remediate +
   rotate) or false positive (allowlist **with justification**). Write one line per finding.
5. **Remediate** at least the highest-severity real finding (hint: look in `k8s/`). Keep the
   workload working (the app references the secret by name).
6. **Rotation.** Write the rotation steps for the exposed credential, and explain why removing
   it from the current file is **not** enough.

## Deliverables
1. The gate + pre-commit + fixtures, and a fixtures run where both fixture jobs pass.
2. A run link where `secret-scan` **fails** on the real finding (before remediation).
3. Your per-finding triage (real vs false positive, with justification for any allowlist).
4. The remediation diff + proof the working tree is clean (`gitleaks … --no-git`).
5. Rotation steps, and a sentence on why history still matters.

## Assessment rubric
| Outcome | Grade |
|---|---|
| No gate, or a real finding allowlisted to force green | ❌ Fail |
| Gate added but non-blocking, or doesn't gate the deploy | ◑ Partial |
| Gate enforces + fixtures, but real finding not remediated | ◑ Partial |
| Enforcing gate + deterministic fixtures + real finding remediated + rotation documented, nothing suppressed | ✅ Pass |
| All of the above **and** correctly distinguishes current-file fix from history, and names push protection as the admin control | ✅ Distinction |

---

# Troubleshooting guide (real issues you may hit)

| Symptom | Cause | Fix |
|---|---|---|
| **`docker pull ghcr.io/gitleaks/gitleaks` → `denied`** | A stale ghcr credential on the local Docker, or private-image assumptions | In CI it pulls fine (anonymous); locally, use the **release binary** from GitHub, or fix the local login |
| **Which version to pin?** | Guessing a tag can 404 in CI | Pull the real tag from the API: `gh api repos/gitleaks/gitleaks/releases/latest --jq .tag_name` |
| **The gate is green but you *know* there are secrets** | gitleaks scanned only the latest commit | Use `fetch-depth: 0` and `gitleaks detect` (full history) |
| **A finding looks fake (`AKIAIOSFODNN7EXAMPLE`, `<token>`)** | Documented example / placeholder | Allowlist **that specific path/pattern** with a comment — never a broad `k8s/.*` |
| **Your own fixture trips GitHub push protection on push** | You committed a provider-shaped secret | Don't commit one — generate the fake at **test time** (`/dev/urandom` → `ghp_…`) |
| **A base64 Secret "isn't a secret because it's encoded"** | base64 is encoding, not encryption | `base64 -d` it live; treat it as plaintext |
| **You removed the secret from the file but the gate is still red** | It's still in **git history** | Rotate the credential; purge history (`git filter-repo`/BFG + force-push) only with authorisation |
| **Removing the inline Secret breaks the deployment** | The workload needs the Secret to exist | Create it out-of-band first: `kubectl create secret generic … --from-literal=…` (see the `.example`) |
| **`.gitleaks.toml` ignored** | Not passed to the CLI | `gitleaks detect --config .gitleaks.toml …` (and `args: ["--config", ".gitleaks.toml"]` in pre-commit) |
