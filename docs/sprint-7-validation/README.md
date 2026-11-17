# Sprint 7 — GitOps & the CI/CD Security Pipeline: Validation

Branch `feature/sprint-7-gitops-cicd-security`. Work validated on GitHub Actions in
`Posture-Cybersecurity/PostureSec-DevSecOps-Lab` on 2026-11-17.

## Ticket scorecard
| Ticket | Status | Notes |
|--------|--------|-------|
| **DSO-703** Pipeline gates: lint, SCA & scanners | ✅ **PASS** | All five gates enforce **and** run independently; each proven by a deterministic fixture; publish/deploy gated |
| **DSO-701** GitOps principles & install Argo CD | ◑ **IMPLEMENTED** | Argo CD v3.6.1 vendored + pinned (`argocd/`) + GitOps doc; manifest offline-validated (60 docs, 7 workloads); **live cluster install deferred** (local minikube 1.34 ↔ Docker 29 skew; binary upgrade gated) |
| DSO-702 Wire POSTURESec to Argo CD | ⬜ not started | manifests exist; needs an Argo CD `Application` |
| DSO-704 CI bot closes the loop | ⬜ not started | depends on 701/702; manifest-update bot already present |
| **DSO-705** Secret hygiene: push protection & rotation | ✅ **PASS** | gitleaks gate enforces + blocks deploy; deterministic fixtures; caught & remediated a hardcoded DB Secret; rotation runbook; push-protection flagged (admin) |

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

## DSO-701 contents
- [`07-DSO-701-GITOPS-AND-ARGOCD.md`](07-DSO-701-GITOPS-AND-ARGOCD.md) — GitOps principles,
  the vendored Argo CD install, access + hardening, validation (offline; live deferred),
  teaching notes and questions.
- Install assets: [`../../argocd/`](../../argocd/README.md) — `namespace.yaml` + pinned
  `install.yaml` (Argo CD v3.6.1).

## Key runs (evidence)
| Run | Workflow | Result | Shows |
|---|---|---|---|
| [`44057333626`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44057333626) | app pipeline (decoupled) | failure (correct) | all 5 gates run independently; Trivy executes on the app; publish/deploy skipped |
| [`44055796438`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44055796438) | security-fixtures | success (7/7) | each gate proven vuln→fail, clean→pass |
| [`44048569920`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44048569920) | app pipeline (enforcing, pre-decouple) | failure | SCA + Checkov block; deploy bot skipped |
| [`44062354609`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44062354609) | security-fixtures (+ secrets) | success (9/9) | gitleaks: planted secret detected, clean passes |
| [`44062354608`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44062354608) | app pipeline (+ secret-scan) | failure | secret-scan caught 8 real committed secrets |

## One-line summary
DSO-703 turned a green-by-design "security" pipeline into one where **every gate enforces,
runs independently, and is proven deterministically**, while a vulnerable build is never
published or deployed — with no gate weakened and no finding suppressed.
