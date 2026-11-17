# Sprint 7 — GitOps & the CI/CD Security Pipeline: Validation

Branch `feature/sprint-7-gitops-cicd-security`. Work validated on GitHub Actions in
`Posture-Cybersecurity/PostureSec-DevSecOps-Lab` on 2026-11-17.

## Ticket scorecard
| Ticket | Status | Notes |
|--------|--------|-------|
| **DSO-703** Pipeline gates: lint, SCA & scanners | ✅ **PASS** | All five gates enforce **and** run independently; each proven by a deterministic fixture; publish/deploy gated |
| **DSO-701** GitOps principles & install Argo CD | ✅ **PASS (live)** | Argo CD v3.6.1 vendored + pinned; **installed live on a disposable k3s cluster — all 7 pods Running**. See [`10-…LIVE-GITOPS.md`](10-DSO-701-702-704-LIVE-GITOPS.md) |
| **DSO-702** Wire POSTURESec to Argo CD | ✅ **PASS (live)** | Argo CD `Application` validated against the CRD and **live: auto-synced a Git repo → deployed app → Synced/Healthy @ 212b867**; manages no secrets. Doc 10 |
| **DSO-704** CI bot closes the loop | ✅ **PASS (live)** | gated manifest bot + GitOps hand-off + PR gate-summary; **live: CI-bot bump `8c76eab` → synced v2, then `git revert` `da55757` → reconciled to v1, Healthy throughout**. Doc 10 |
| **DSO-705** Secret hygiene: push protection & rotation | ✅ **PASS** | gitleaks gate enforces + blocks deploy; deterministic fixtures; caught & remediated a hardcoded DB Secret; rotation runbook; push-protection flagged (admin) |

## Local validation
- [`LOCAL-VALIDATION.md`](LOCAL-VALIDATION.md) — the scanner fixtures re-run **locally**
  (npm audit / Trivy pinned-DB / Checkov, vuln→fail + clean→pass), the decouple + deploy-blocking
  invariants, and the Task 2 (live GitOps) blocker + minimum setup.

## Capstone (read these first)
- [`00-SPRINT-7-INSTRUCTOR-GUIDE.md`](00-SPRINT-7-INSTRUCTOR-GUIDE.md) — consolidated guide
  tying all five tickets together (arc, teaching sequence, honest status, prerequisites).
- [`SPRINT-7-SLIDES.md`](SPRINT-7-SLIDES.md) — teaching deck (Marp; render with `marp … --pdf`/`--pptx`).
- **Saturday War Room:** [`../warroom/SPRINT-7-WARROOM-STUDENT.md`](../warroom/SPRINT-7-WARROOM-STUDENT.md)
  (+ [instructor solution](../warroom/SPRINT-7-WARROOM-INSTRUCTOR.md)) — INC-007 "the green
  pipeline that shipped a vulnerability": a CI-runnable incident on gate enforcement (no cluster).

## DSO-703 contents
- [`01-DSO-703-EVIDENCE.md`](01-DSO-703-EVIDENCE.md) — implementation, CI runs, per-gate
  findings, deterministic fixtures, AC verification, caveats, integrity statement.
- [`02-DSO-703-INSTRUCTOR-GUIDE.md`](02-DSO-703-INSTRUCTOR-GUIDE.md) — reproducible
  walkthrough (theatre → enforce → decouple → prove), teaching notes, discussion questions.
- [`03-DSO-703-STUDENT-EXERCISE.md`](03-DSO-703-STUDENT-EXERCISE.md) — the practical
  exercise, assessment rubric, and a troubleshooting guide of real issues.
- Fixtures: [`../../tests/security-fixtures/`](../../tests/security-fixtures/README.md).

## DSO-705 contents
- [`04-DSO-705-EVIDENCE.md`](04-DSO-705-EVIDENCE.md) — implementation, the real finding (a
  hardcoded DB Secret) + its remediation, AC verification, caveats, integrity statement.
- [`05-DSO-705-INSTRUCTOR-GUIDE.md`](05-DSO-705-INSTRUCTOR-GUIDE.md) — walkthrough (gate →
  catches a real secret → remediate → history still remembers → prove), teaching notes, questions.
- [`06-DSO-705-STUDENT-EXERCISE.md`](06-DSO-705-STUDENT-EXERCISE.md) — exercise, rubric,
  troubleshooting.
- [`DSO-705-SECRET-ROTATION.md`](DSO-705-SECRET-ROTATION.md) — rotation runbook (GHCR, Postgres, Argo CD).

## Live GitOps validation (DSO-701/702/704)
- [`10-DSO-701-702-704-LIVE-GITOPS.md`](10-DSO-701-702-704-LIVE-GITOPS.md) — **reproduce-it +
  teaching** runbook: disposable k3s-in-Docker → install Argo CD → Git source → Application
  auto-sync/deploy/health → CI-bot bump → `git revert` rollback → reconcile → cleanup, with the
  real captured results and the genuine gotchas (Windows path mangling, registry-egress
  side-load, the `argocd-redis` cascade, ephemeral Git state).

## DSO-701 contents
- [`07-DSO-701-GITOPS-AND-ARGOCD.md`](07-DSO-701-GITOPS-AND-ARGOCD.md) — GitOps principles,
  the vendored Argo CD install, access + hardening, validation (offline + **live**, see doc 10),
  teaching notes and questions.
- Install assets: [`../../argocd/`](../../argocd/README.md) — `namespace.yaml` + pinned
  `install.yaml` (Argo CD v3.6.1).

## DSO-702 contents
- [`08-DSO-702-ARGOCD-APPLICATION.md`](08-DSO-702-ARGOCD-APPLICATION.md) — the Argo CD
  `Application` wiring `k8s/`, secret handling (none managed), sync policy + drift/self-heal,
  offline validation (CRD-schema), security, teaching notes; live sync proven (doc 10).
- Assets: [`../../argocd/application-posturesec.yaml`](../../argocd/application-posturesec.yaml),
  [`../../argocd/repo-secret.yaml.example`](../../argocd/repo-secret.yaml.example).

## Key runs (evidence)
| Run | Workflow | Result | Shows |
|---|---|---|---|
| [`44057333626`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44057333626) | app pipeline (decoupled) | failure (correct) | all 5 gates run independently; Trivy executes on the app; publish/deploy skipped |
| [`44055796438`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44055796438) | security-fixtures | success (7/7) | each gate proven vuln→fail, clean→pass |
| [`44048569920`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44048569920) | app pipeline (enforcing, pre-decouple) | failure | SCA + Checkov block; deploy bot skipped |
| [`44062354609`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44062354609) | security-fixtures (+ secrets) | success (9/9) | gitleaks: planted secret detected, clean passes |
| [`44062354608`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44062354608) | app pipeline (+ secret-scan) | failure | secret-scan caught 8 real committed secrets |

## DSO-704 contents
- [`09-DSO-704-CI-BOT-LOOP.md`](09-DSO-704-CI-BOT-LOOP.md) — the closed CI→Git→Argo CD loop,
  the manifest-update bot, PR feedback, loop-safety (`[skip ci]`), offline validation,
  teaching notes; live loop proven (doc 10).

## One-line summary
DSO-703 turned a green-by-design "security" pipeline into one where **every gate enforces,
runs independently, and is proven deterministically**, while a vulnerable build is never
published or deployed — with no gate weakened and no finding suppressed.
