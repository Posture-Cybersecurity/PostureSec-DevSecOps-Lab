# Sprint 7 — Instructor Handoff (evidence-backed)

> **Purpose.** A complete, evidence-classified teaching package for *GitOps & the CI/CD
> Security Pipeline*, written so a presenter (or an assistant like ChatGPT) can design slides
> and teach the sprint **without guessing implementation details**. It does **not** include a
> slide deck — slide *structure* is suggested at the end.
>
> **Repo:** `Posture-Cybersecurity/PostureSec-DevSecOps-Lab` ·
> **Branch:** `feature/sprint-7-gitops-cicd-security` · **origin HEAD:** `5526fbe` ·
> 16 commits off `dev` · nothing merged, no PR, nothing deployed to AWS.

## Evidence classification (used throughout)
Every claim below carries one tag:
1. **[LIVE]** Proven live on the disposable k3s cluster.
2. **[CI]** Proven in GitHub Actions.
3. **[LOCAL]** Proven through local validation (CLI on this machine).
4. **[OFFLINE]** Validated offline / schema-level only.
5. **[NOT-DEMO]** Not demonstrated.

Commands quoted verbatim are marked “(from the repo/runbook)”. Anything a presenter would
*type live* against a fresh cluster is marked “(reconstructed from the runbook)”.

---

## 1. Executive summary
Sprint 7 turns a **green-by-design** CI pipeline into one where security gates **actually
block**, and hands deployment to **GitOps** (Argo CD) so the cluster pulls reviewed, declared
state from Git.

| Ticket | One line | Status | Strongest evidence |
|---|---|---|---|
| DSO-703 | Make lint/SCA/scanners enforce + decouple | ✅ PASS | **[CI]** run `44057333626` (red, deploy skipped) + **[LOCAL]** all fixtures |
| DSO-705 | Secret scanning + rotation; caught a real leak | ✅ PASS | **[CI]** `44062354608` (`leaks found: 8`) + **[LOCAL]** fixtures; remediation commit `2a1f121` |
| DSO-701 | Install Argo CD | ✅ PASS | **[LIVE]** 7/7 Argo CD pods Running on k3s |
| DSO-702 | Wire app to Argo CD | ✅ PASS | **[LIVE]** `Application` Synced/Healthy @ `212b867` (representative app) |
| DSO-704 | CI bot closes the loop + rollback | ✅ PASS | **[LIVE]** bump `8c76eab`→v2, `git revert` `da55757`→v1 |

**Honest scope:** the live GitOps loop (701/702/704) was proven with a **representative app**
(public `nginx`, served by an in-cluster Git daemon) because the real PostureSec repo is
private and its images are in private GHCR. The Argo CD *mechanics* are identical; only the
source repo/images differ. **This is not a deployment of the real private PostureSec app.**

**Still owner-controlled, deliberately NOT done (do not claim these):** DB password rotation,
GHCR token rotation, GitHub push-protection enablement, git-history secret cleanup.

---

## 2. Prerequisites to teach first (concept primers)
Students need short primers on these before the tickets land:
- **Git** (commit, branch, revert, history) — DSO-704/705 lean on `git revert` and history.
- **CI/CD** (a pipeline = ordered jobs; exit codes decide pass/fail) — DSO-703.
- **Containers & images** (image = pinned bytes; registries; base-image CVEs) — DSO-703/704.
- **Kubernetes basics** (namespace, Deployment, Service, Secret, `kubectl`) — all GitOps tickets.
- **Security scanning** (SAST/lint vs SCA vs image CVE vs IaC vs secret scanning) — DSO-703/705.
- **Base64 ≠ encryption** — the DSO-705 "aha".

---

## 3. Ticket-by-ticket teaching guide

### DSO-703 — Security pipeline gates
**File:** `.github/workflows/ci-cd.yml` (one workflow, 9 jobs). Evidence docs
`01-DSO-703-EVIDENCE.md`, `02-DSO-703-INSTRUCTOR-GUIDE.md`, `03-DSO-703-STUDENT-EXERCISE.md`.

**The core idea to teach — "runs" vs "enforces":** a scanner that executes and prints findings
but cannot fail the run is **theatre**. The original pipeline had `continue-on-error: true` on
every job (its header literally said *"Demo: … so scans can fail without blocking"*). DSO-703
removes that so a finding **blocks**. *A red pipeline is the gate working, not failing.*

**The six gates (all independent jobs):**
| Gate | Job | Detects | How it enforces | Where |
|---|---|---|---|---|
| ESLint | `lint` (matrix backend/frontend) | code errors | `npm run lint` non-zero fails the job | CI |
| Hadolint | `dockerfile-lint` | Dockerfile anti-patterns | `failure-threshold: warning` | CI |
| npm audit (SCA) | `sca` | vulnerable dependencies | `npm audit --audit-level=high` (no `\|\| true`) | CI |
| Trivy | `image-scan` | image OS/library CVEs | `--severity CRITICAL,HIGH --ignore-unfixed --exit-code 1` | CI |
| Checkov | `iac-scan` | Terraform/K8s misconfig | Terraform `soft_fail: false` (K8s soft, documented) | CI |
| Gitleaks | `secret-scan` | committed secrets | `gitleaks detect … --exit-code 1` over full history | CI |

**Decoupling (the DSO-703 follow-up):** gates run **independently** — `sca`/`iac-scan` depend on
nothing; `image-scan` depends only on `build-image` (so **Trivy runs even when SCA fails**). The
image is **built once** and shared via the buildx GHA cache, so Trivy scans what gets published.

**Deployment blocking (the invariant):** `security-gates` ← `[lint, dockerfile-lint, sca,
iac-scan, image-scan, secret-scan]`; `build-push` ← `security-gates`; `update-manifest` (deploy
bot) ← `build-push`. **Any gate failing ⇒ `security-gates` skipped ⇒ publish + deploy skipped.**

**Demonstrations & expected results:**
- **[CI]** Run `44057333626` (decoupled): `lint`/`dockerfile-lint` pass; `sca`, `iac-scan`,
  `image-scan` **fail** on real findings; `security-gates`, `build-push`, `update-manifest`
  **skipped**. *This is the headline "deploy blocked" proof.*
- **[CI]** Run `44048569920` (pre-decouple): SCA + Checkov blocked; deploy skipped.
- **[LOCAL]** Fixture matrix (exact, from `LOCAL-VALIDATION.md` + `tests/security-fixtures/README.md`):

| Scanner | Vulnerable fixture | → | Clean control | → |
|---|---|---|---|---|
| npm audit | `lodash@4.17.4` | **exit 1**, `GHSA-35jh-r3h4-6jhm` | `ms@2.1.3` | **exit 0** |
| Trivy (pinned DB 2026-11-17) | `python:3.11.0-slim@sha256:b5ee…1527` | **exit 1**, `CVE-2024-45491` | `distroless/static-debian12@sha256:d75c…43f2` | **exit 0** |
| Checkov 3.4.5 | SG w/ SSH `0.0.0.0/0` | **exit 1**, `CKV_AWS_24` | restricted SG | **exit 0** |

Fixtures live in `tests/security-fixtures/` — **isolated** from the app: outside the
`./backend`/`./frontend` Docker build contexts and the app scan scope, exercised only by
`.github/workflows/security-fixtures.yml` (**[CI]** run `44055796438`, 7/7). The gitleaks
fixtures generate the fake secret **at runtime** (nothing secret-shaped is committed).

**Common errors & resolutions (all hit for real):**
- Pipeline green after removing `continue-on-error` → a `\|\| true` still swallowed npm-audit's exit.
- Zero runs on a push → trigger was `branches: ["*"]`; `*` doesn't match `/`, so `feature/*`
  was skipped. Fix: `["**"]`.
- Report missing when a gate fails → put `if: always()` on the **upload** step, never on the scan.
- Trivy "known-CVE" test drifts → pin the image digest **and** the vuln DB; assert a CVE id, not a count.
- "clean" SCA control fails → `lodash@4.17.21` itself has a HIGH now; use a tiny stable pkg (`ms`).

**What was proven:** **[CI]** gates enforce and block deploy; **[LOCAL]** every fixture
vuln→fail / clean→pass. **What's partial:** Checkov on `k8s/` is a documented soft exception
(NodePort etc. trip generic checks) — **[OFFLINE]** justified, not a blanket bypass.

---

### DSO-705 — Secret hygiene
**Files:** `.github/workflows/ci-cd.yml` (`secret-scan` job), `.gitleaks.toml`,
`.pre-commit-config.yaml`, `docs/sprint-7-validation/DSO-705-SECRET-ROTATION.md`, evidence
`04/05/06-DSO-705-*.md`.

**Teach:** secrets must never be committed (git history is forever; base64 ≠ encryption).
Defence in depth = **pre-commit** (local) → **gitleaks CI gate** (server, full history) →
**GitHub push protection** (server, at push — owner-enabled).

**What gitleaks caught (the real win):** enabling the gate on the app surfaced a genuine
hardcoded Postgres Secret committed in `k8s/posturesec.yaml` — the password `posturesec_pass_2026`
(base64 `cG9zdHVyZXNlY19wYXNzXzIwMjY=`), plus the same in a historical `k8s/jerney.yaml` and a
demo password in a doc. **[CI]** run `44062354608`: `leaks found: 8`.
- **Remediation** (commit `2a1f121`): removed the inline Secret + the plaintext comment; the DB
  and backend already reference it via `secretKeyRef`, so it's created **out-of-band** (template
  `k8s/posturesec-db-secret.yaml.example`, gitignored real file). Working tree is now clean
  (**[LOCAL]** `gitleaks … --no-git` → no leaks).
- **Important teaching point:** removing it from the file does **not** remove it from **history**,
  so `secret-scan` (which scans history) **stays red** until the secret is rotated and history
  is purged.

**Fixtures:** a runtime-generated `ghp_…` → **detected** (exit non-zero); a clean config → **pass**.
**[CI]** `44062354609` (both pass). Deterministic because gitleaks is pinned `v8.30.1` and the
planted value is generated at test time (never committed → can't trip push protection).

**[NOT-DEMO] / owner-controlled (do not claim done):** rotate the DB password, rotate the GHCR
token (it was shared in chat this session), enable GitHub push protection, purge git history.
Procedures are in `DSO-705-SECRET-ROTATION.md`.

---

### DSO-701 — GitOps principles & install Argo CD
**Files:** `argocd/namespace.yaml`, `argocd/install.yaml` (vendored **Argo CD v3.6.1**),
`argocd/README.md`, doc `07-DSO-701-GITOPS-AND-ARGOCD.md`, live runbook
`10-DSO-701-702-704-LIVE-GITOPS.md`.

**What students must understand:** GitOps = declarative + **Git is the single source of truth** +
continuous reconciliation + **pull-based** (the cluster pulls; CI holds no cluster creds) +
**self-heal** (drift is reverted to Git).

**What Argo CD does / architecture:** an in-cluster controller that compares desired state (Git)
to live state and reconciles. Components (one shared `quay.io/argoproj/argocd` image + redis +
dex): `argocd-server` (API/UI), `argocd-repo-server` (clones Git, renders manifests),
`argocd-application-controller` (reconciles), `argocd-redis` (cache), `argocd-dex-server`
(SSO — **optional**), `argocd-applicationset`/`notifications` (optional).

**Installation steps (from `argocd/README.md`):**
```bash
kubectl apply -f argocd/namespace.yaml
kubectl apply -n argocd -f argocd/install.yaml --server-side   # --server-side: CRDs exceed the annotation limit
kubectl -n argocd rollout status deploy/argocd-server --timeout=600s
kubectl -n argocd get pods            # expect all Running 1/1
```
**Access + first-login hardening (from the doc):**
```bash
kubectl -n argocd port-forward svc/argocd-server 8080:443 &
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
# log in as admin, then: argocd account update-password  (rotate), then delete the bootstrap secret
```
**Expected output / interpretation:** all 7 pods `Running 1/1` = install healthy. **[LIVE]** on
k3s, that's exactly what was reached.

**Common errors (all real — teach as lessons):**
- `CreateContainerConfigError: secret "argocd-redis" not found` → argocd-server won't start until
  **redis** is up (redis generates that secret). *Read the config error; it points at a dependency.*
- Image pulls stall → the cluster couldn't reach quay.io/ECR; images were **side-loaded** (see §4).
- dex won't pull → it's SSO-only; core Argo CD runs without it.

**What was proven:** **[LIVE]** Argo CD v3.6.1 installed on disposable k3s, 7/7 pods Running.
Manifest also **[OFFLINE]** validated (60 docs, 7 workloads, 3 CRDs).

---

### DSO-702 — Connect PostureSec to Argo CD
**Files:** `argocd/application-posturesec.yaml` (the real-app `Application`),
`argocd/repo-secret.yaml.example`, doc `08-DSO-702-ARGOCD-APPLICATION.md`. Live demo scaffolding:
`docs/sprint-7-validation/live-demo/`.

**Teach:** the `Application` CR tells Argo CD *which repo/path to sync where, with what policy*:
```yaml
spec:
  source: { repoURL: <git>, targetRevision: <branch>, path: k8s }
  destination: { server: https://kubernetes.default.svc, namespace: posturesec }
  syncPolicy:
    automated: { prune: true, selfHeal: true }   # prune deleted resources; revert drift
    syncOptions: [ CreateNamespace=true ]
```
`automated` = **automated synchronization**; `selfHeal: true` = a manual `kubectl edit` is
**reverted** back to Git; `prune: true` = resources removed from Git are deleted. **Secrets are
deliberately NOT managed** — `k8s/` has no Secret manifest (DSO-705), so Argo CD stores/prunes
no credential.

**Demonstration & expected states — [LIVE] (representative app):**
```bash
kubectl apply -f demo-app-application.yaml          # from live-demo/ (git:// in-cluster source)
kubectl -n demo rollout status deploy/web --timeout=180s
kubectl -n argocd get application demo-app -o jsonpath='{.status.sync.status} / {.status.health.status} @ {.status.sync.revision}'
# -> Synced / Healthy @ 212b867 ; image nginx:1.25-alpine ; 2 pods Running
```
**Proven vs representative:** **[LIVE]** auto-sync → deploy → Synced/Healthy was proven on the
representative app. The real-app `Application` (`argocd/application-posturesec.yaml`) is
**[OFFLINE]** validated against the Argo CD CRD schema; wiring it live needs the owner's
**private-repo PAT** + **GHCR pull secret** → **[NOT-DEMO]** for the real app.

---

### DSO-704 — CI bot, image updates & Git rollback
**Files:** `.github/workflows/ci-cd.yml` (`update-manifest` + `pr-summary`), doc
`09-DSO-704-CI-BOT-LOOP.md`.

**Teach the closed loop:** CI builds/pushes the image → the **bot** writes the new image tag
into Git (`k8s/posturesec.yaml`) and commits with **`[skip ci]`** (prevents a CI↔push loop) →
Argo CD (tracking that branch) notices the manifest change and deploys it. **Rollback is a Git
operation** (`git revert`), which Argo CD reconciles — so the deployed version always equals a
Git commit (auditable, repeatable). The bot runs **only after `build-push`** (so it never bumps
an image that failed a gate). A `pr-summary` job posts a sticky PR comment with the gate table.

**Demonstration & expected output — [LIVE] (representative app):**
```bash
# 1) CI-bot bump (v1 -> v2) in Git
sed -i 's|nginx:1.25-alpine|nginx:1.27-alpine|' app.yaml
git commit -aqm "ci: bump web image to nginx:1.27-alpine [skip ci]" && git push
# -> Argo CD syncs; deploy image = nginx:1.27-alpine; Synced/Healthy @ 8c76eab
# 2) Git rollback
git revert --no-edit HEAD && git push
# -> Argo CD reconciles; deploy image back to nginx:1.25-alpine; Synced/Healthy @ da55757
```
**Actual evidence — [LIVE]:** bump commit `8c76eab` → image `nginx:1.27-alpine`, Synced/Healthy;
revert commit `da55757` → image `nginx:1.25-alpine`, Synced/Healthy; `web` 2/2 Running at each
step. (Representative app; the real bot in `ci-cd.yml` edits `k8s/posturesec.yaml` the same way.)

---

## 4. The live validation environment (teach the lessons, not just the fixes)
**Setup — [LIVE]:** a **disposable k3s-in-Docker** cluster (`rancher/k3s:v1.37.2-k3s1`), created
and later **removed**. Full ordered commands are in `10-DSO-701-702-704-LIVE-GITOPS.md`.

Real issues encountered, as teaching lessons:
1. **Windows MSYS path conversion** — Git-Bash rewrites `/run`, `/tmp` inside docker args into
   Windows paths, so `docker run --tmpfs /run …` fails cryptically. Fix: `export
   MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`. *Lesson: know your shell before blaming the tool.*
2. **`--snapshotter native`** — k3s-in-Docker needs it (overlayfs-in-overlayfs doesn't work on
   Docker Desktop). *Lesson: nested container runtimes have storage-driver constraints.*
3. **Registry connectivity** — the cluster's containerd couldn't reach quay.io/ghcr.io/ECR
   (pulls stalled, empty ingest) while docker.io worked slowly. *Lesson: an "install" failure is
   often a registry-egress problem — diagnose the pull before editing YAML.*
4. **Image side-loading via `agent/images/`** — pulled images on the **host**, `docker save`,
   `docker cp` into `/var/lib/rancher/k3s/agent/images/`, restart k3s (auto-imports on start).
5. **No `ctr` in the image** — this k3s build ships no `ctr` and `k3s ctr` is unsupported, so the
   auto-import dir (not `ctr import`) is the portable side-load path. *Lesson: don't assume a tool exists.*
6. **Redis startup dependency** — argocd-server's `CreateContainerConfigError` was `secret
   "argocd-redis" not found`; it cleared once redis started. *Lesson: cascading failures point at a dependency.*
7. **Ephemeral Git server** — the in-cluster git repo had no PV, so a k3s restart wiped it
   ("remote repository is empty") and it had to be **re-seeded**. *Lesson: state needs a PV; and
   "empty repository" is a source problem, not an Argo CD problem.*
8. **Dex optional** — its image was blocked (ghcr); core Argo CD ran fine without SSO.
9. **Cleanup** — `docker rm -f sprint7-k3s` removed the cluster + its images; **[LIVE]** confirmed
   no exercise containers remain. *Only the exercise's own cluster was removed.*

---

## 5. War Room teaching guide — INC-007 "The green pipeline that shipped a vulnerability"
Student doc `docs/warroom/SPRINT-7-WARROOM-STUDENT.md`; instructor-only
`docs/warroom/SPRINT-7-WARROOM-INSTRUCTOR.md`. **CI-runnable, no cluster needed.**

**Learning objective:** internalise "a scanner that *runs* is not a gate that *enforces*."

**Student scenario (share):** a release shipped a dependency with a known HIGH CVE, yet the
pipeline run was **green** and deploy ran. On-call must find why the gate didn't enforce,
**restore enforcement, and prove it now blocks** — *without* deleting the finding or weakening
another gate.

**Investigation sequence (student):** read `ci-cd.yml`; `git diff origin/dev -- .github/workflows/ci-cd.yml`;
`grep -nE 'continue-on-error|\|\| true|soft_fail|allowlist|needs:'`; open the green run and spot a
scanner that showed a ✓ while its log listed a HIGH/CRITICAL finding.

**Evidence students submit:** the exact change that defeated the gate (file+line+why); a **before**
(green) and **after** (red, blocking) run link; one sentence on "runs vs enforces".

**Instructor-only — what is intentionally broken (plant ONE):**
| # | Plant | Why green | Restore |
|---|---|---|---|
| A | `continue-on-error: true` on `sca` | reports but can't fail | remove it |
| B | `npm audit … \|\| true` | exit swallowed | remove `\|\| true` |
| C | Trivy drop `--exit-code 1` | prints CVEs, exits 0 | restore it |
| D | Checkov Terraform `soft_fail: true` | findings → warnings | set `false` |
| E | drop a gate from `security-gates.needs` | deploy no longer gated | add it back |
| F | broad `.gitleaks.toml` allowlist `paths=['k8s/.*']` | hides a secret | remove it |
Recommended default: **A or E**. (Setup command is in the instructor doc.)

**Scoring:** ❌ "fixed" by removing the finding (gate still non-enforcing) or by weakening
another gate; ◑ found the area but didn't fully restore + prove blocking; ✅ restored the one
enforcement property, proved the run fails + deploy skipped, nothing else touched; ✅✅
Distinction if they also articulate "runs vs enforces" and name every enforcement invariant.

**Common wrong approaches / hints:** the big trap is *removing the finding* instead of the
*control*; hint students toward "why is a scanner that prints a HIGH still passing?"

---

## 6. Teaching sequence (half-day, ~4h)
| # | Block | Time | Mode | Live? |
|---|---|---|---|---|
| 0 | Concept primers (Git, CI/CD, containers, k8s, scanning) | 30m | lecture | — |
| 1 | DSO-703 gates: theatre → enforce → decouple | 45m | demo + CI runs | **[CI]/[LOCAL]** |
| 2 | DSO-705 secret hygiene (+ the real catch) | 30m | demo | **[CI]/[LOCAL]** |
| 3 | DSO-701 GitOps + Argo CD install | 40m | live demo on kind/k3s | **[LIVE]** |
| 4 | DSO-702 wire app + auto-sync + self-heal | 30m | live demo | **[LIVE]** |
| 5 | DSO-704 CI-bot bump + `git revert` rollback | 30m | live demo | **[LIVE]** |
| 6 | War Room INC-007 (hands-on incident) | 45m | exercise | **[CI]** |
| 7 | Wrap: enforcement invariants + owner actions | 20m | discussion | — |

For blocks 3–5, provide students a disposable **kind** or **minikube ≥1.39** cluster (the local
one here needed the k3s side-load workaround — see §4). Reproduce steps: runbook doc 10.

---

## 7. Knowledge-check questions (with answers)
1. *A Secret manifest uses base64 `data:`. Is that encrypted?* → No; base64 is encoding —
   `base64 -d` reveals it. (DSO-705)
2. *Scanner shows a HIGH but the job is green. What happened?* → It "runs" but doesn't "enforce":
   `continue-on-error` / `\|\| true` / soft-fail / dropped `needs` / allowlist. (DSO-703/War Room)
3. *Why must the deploy bot run only after `security-gates`?* → So a vulnerable image is never
   published/deployed. (DSO-703/704)
4. *You removed a secret from a file but `secret-scan` is still red. Why, and what are the two
   fixes?* → It's still in git history; rotate the credential and purge history. (DSO-705)
5. *How does GitOps reduce CI blast radius?* → Pull-based delivery; the cluster pulls, so CI holds
   no cluster credentials. (DSO-701)
6. *What does `selfHeal: true` do on a manually scaled Deployment?* → Reverts it to the Git-declared
   state. (DSO-702)
7. *How is a rollback performed under GitOps?* → `git revert` the change; Argo CD reconciles to the
   previous commit. (DSO-704)
8. *Why pin the Trivy image AND the vuln DB?* → The DB updates ~daily; without pinning, a
   "known-CVE" test drifts. (DSO-703)

---

## 8. Evidence matrix
| Claim | Class | Source |
|---|---|---|
| Gates enforce; deploy blocked on failure | **[CI]** | run `44057333626`; `ci-cd.yml` `needs` graph |
| Pre-decouple enforcement | **[CI]** | run `44048569920` |
| Every scanner fixture vuln→fail / clean→pass | **[LOCAL]** | `LOCAL-VALIDATION.md`; **[CI]** `44055796438` (7/7) |
| ESLint/Hadolint pass locally | **[LOCAL]** | backend/frontend lint exit 0; hadolint no findings |
| Secret gate caught a real leak (`leaks found: 8`) | **[CI]** | run `44062354608`; files `k8s/posturesec.yaml` (hist), `k8s/jerney.yaml` |
| Secret remediation; tree clean | **[LOCAL]** | commit `2a1f121`; `gitleaks --no-git` no leaks |
| Gitleaks fixtures (planted→detected, clean→pass) | **[CI]** | run `44062354609` |
| Argo CD installed, 7/7 pods Running | **[LIVE]** | runbook doc 10 (k3s) |
| Application auto-synced, Synced/Healthy @ `212b867` | **[LIVE]** | doc 10 (representative app) |
| CI-bot bump `8c76eab`→v2; `git revert` `da55757`→v1 | **[LIVE]** | doc 10 |
| Real-app `Application` conforms to Argo CD CRD | **[OFFLINE]** | `argocd/application-posturesec.yaml` vs vendored CRD |
| Argo CD install manifest valid (60 docs/7 workloads/3 CRDs) | **[OFFLINE]** | `argocd/install.yaml` |
| Real PostureSec app deployed via GitOps | **[NOT-DEMO]** | needs owner repo PAT + GHCR pull secret |
| DB/GHCR rotation, push protection, history purge | **[NOT-DEMO]** | owner-controlled; `DSO-705-SECRET-ROTATION.md` |

CI run IDs are in `Posture-Cybersecurity/PostureSec-DevSecOps-Lab` → Actions.

---

## 9. Known limitations & owner actions
- Live GitOps proven with a **representative** app, not the real private PostureSec app (**[NOT-DEMO]**).
- `secret-scan` stays red on **history** by design until rotation + history purge (owner).
- **Owner actions (not performed):** rotate DB password; rotate the GHCR token; enable GitHub
  push protection; purge git history. No PR/merge (requires owner approval).

---

## 10. Suggested slide structure (for ChatGPT to design — do not build it here)
1. Title + the one-sentence thesis ("from green theatre to gates that block, then GitOps").
2. Sprint map: the 5 tickets + the status table (§1).
3. Concept primers (1 slide each, only as deep as the room needs).
4. DSO-703: the theatre problem → `continue-on-error`; the six gates; decouple; **deploy-blocked**
   proof (run `44057333626`). 2–3 slides.
5. DSO-705: base64≠encryption; the real leak caught; remediation; history caveat. 2 slides.
6. DSO-701: GitOps principles table; Argo CD architecture diagram; install; 7/7 Running. 2 slides.
7. DSO-702: the `Application`; auto-sync/self-heal; Synced/Healthy @ `212b867`. 1–2 slides.
8. DSO-704: the closed loop diagram; bump `8c76eab`→revert `da55757`. 1–2 slides.
9. Live-environment lessons (§4) — "real DevOps is debugging the environment". 1–2 slides.
10. War Room INC-007 brief (student-facing only). 1 slide.
11. Evidence & honesty: the classification key + what's representative/owner-only. 1 slide.
12. Enforcement invariants + call to action (owner tasks). 1 slide.

**Hard rules for the slides:** label the GitOps demo as **representative** (not the real app);
never show owner actions as done; keep the "runs vs enforces" line central.
