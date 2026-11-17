# Sprint 7 — GitOps & the CI/CD Security Pipeline: Validation

Branch `feature/sprint-7-gitops-cicd-security`. Work validated on GitHub Actions in
`Posture-Cybersecurity/PostureSec-DevSecOps-Lab` on 2026-11-17.

## Ticket scorecard
| Ticket | Status | Notes |
|--------|--------|-------|
| **DSO-703** Pipeline gates: lint, SCA & scanners | ✅ **PASS** | All five gates enforce **and** run independently; each proven by a deterministic fixture; publish/deploy gated |
| DSO-701 GitOps principles & install Argo CD | ⬜ not started | greenfield; needs a cluster (local kind for test) |
| DSO-702 Wire POSTURESec to Argo CD | ⬜ not started | manifests exist; needs an Argo CD `Application` |
| DSO-704 CI bot closes the loop | ⬜ not started | depends on 701/702; manifest-update bot already present |
| DSO-705 Secret hygiene: push protection & rotation | ⬜ not started | greenfield; gitleaks + push protection + rotation runbook |

## DSO-703 contents
- [`01-DSO-703-EVIDENCE.md`](01-DSO-703-EVIDENCE.md) — implementation, CI runs, per-gate
  findings, deterministic fixtures, AC verification, caveats, integrity statement.
- [`02-DSO-703-INSTRUCTOR-GUIDE.md`](02-DSO-703-INSTRUCTOR-GUIDE.md) — reproducible
  walkthrough (theatre → enforce → decouple → prove), teaching notes, discussion questions.
- [`03-DSO-703-STUDENT-EXERCISE.md`](03-DSO-703-STUDENT-EXERCISE.md) — the practical
  exercise, assessment rubric, and a troubleshooting guide of real issues.
- Fixtures: [`../../tests/security-fixtures/`](../../tests/security-fixtures/README.md).

## Key runs (evidence)
| Run | Workflow | Result | Shows |
|---|---|---|---|
| [`44057333626`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44057333626) | app pipeline (decoupled) | failure (correct) | all 5 gates run independently; Trivy executes on the app; publish/deploy skipped |
| [`44055796438`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44055796438) | security-fixtures | success (7/7) | each gate proven vuln→fail, clean→pass |
| [`44048569920`](https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab/actions/runs/44048569920) | app pipeline (enforcing, pre-decouple) | failure | SCA + Checkov block; deploy bot skipped |

## One-line summary
DSO-703 turned a green-by-design "security" pipeline into one where **every gate enforces,
runs independently, and is proven deterministically**, while a vulnerable build is never
published or deployed — with no gate weakened and no finding suppressed.
