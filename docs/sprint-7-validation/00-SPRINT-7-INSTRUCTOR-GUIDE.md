# Sprint 7 — Instructor Guide (GitOps & the CI/CD Security Pipeline)

The capstone guide tying the five tickets together. Read this first; each ticket has its own
evidence/instructor/student docs linked from the [README](README.md).

## The arc of the sprint
Sprint 7 turns a **green-by-design** pipeline into one where security **actually gates**, then
hands deployment to **GitOps** so the cluster pulls reviewed, declared state from Git.

1. **DSO-703 — make the gates enforce.** The pipeline already ran ESLint/npm-audit/Trivy/
   Checkov/Hadolint, but every job was `continue-on-error` — theatre. Enforce them, then
   **decouple** so each runs independently and a vulnerable image is never published.
2. **DSO-705 — stop secrets at the door.** Add a gitleaks gate + pre-commit + rotation, and
   flag GitHub push protection. (It immediately caught a *real* hardcoded DB password.)
3. **DSO-701 — install Argo CD.** GitOps principles + a pinned, vendored install.
4. **DSO-702 — wire the app.** An Argo CD `Application` syncing `k8s/` (managing no secrets).
5. **DSO-704 — close the loop.** CI bumps the image tag in Git; Argo CD deploys it; PR feedback.

## Teaching sequence (half-day)
| Block | Ticket(s) | Live? | Key "aha" |
|---|---|---|---|
| 1 | DSO-703 | ✅ yes | A red pipeline is the gate *working*; `continue-on-error` is theatre |
| 2 | DSO-705 | ✅ yes | Scanners find what audits miss; base64 ≠ encryption; rotate on exposure |
| 3 | DSO-701/702 | ◑ offline | GitOps = declarative + pull-based + self-healing; Argo CD holds no creds |
| 4 | DSO-704 | ◑ offline | CI writes the tag to Git; CD deploys it — no `kubectl`, no CI cluster creds |
| 5 | **War Room** | ✅ yes | Catch a re-weakened gate under incident pressure |

## Honest delivery status
- **Live-proven in CI (do these live):** DSO-703, DSO-705, and the War Room — all run on
  GitHub Actions with no cluster.
- **Proven live on a disposable k3s cluster:** DSO-701/702/704 were demonstrated end-to-end — install → sync → deploy → CI-bot bump → `git revert` rollback → reconcile, Healthy throughout (see [`10-DSO-701-702-704-LIVE-GITOPS.md`](10-DSO-701-702-704-LIVE-GITOPS.md)); reproduce on any Kubernetes cluster. (An initial minikube attempt failed on a minikube-1.34 ↔ Docker-29 skew; k3s was the working alternative.) In this
  build environment none was available (minikube 1.34 ↔ Docker 29 incompatibility; binary
  upgrades gated). The manifests are validated (701/702 against the real Argo CD CRD schema);
  to demo them live, give students a disposable **kind**/**minikube** (≥1.39) cluster, or an
  EKS cluster, and run the reproducible steps in each ticket's doc.

## Prerequisites
- A GitHub repo with Actions enabled (the gates + fixtures run there).
- For the GitOps blocks: Docker + a local cluster (`kind` or `minikube ≥1.39`), `kubectl`,
  `helm` optional. `gitleaks`/`trivy`/`checkov` run as pinned containers in CI (no local install).

## What to emphasize (and common student traps)
- **Enforcement, not green.** Grade on "the gate blocks a real finding," never on a green run.
  Watch for students sneaking `continue-on-error`/`|| true`/blanket `soft_fail`/broad allowlists
  to force green — that is an automatic fail (see the rubrics).
- **Determinism.** Pin the tool *and* (for CVE scanners) the vuln DB; assert on IDs, not counts.
- **Secrets split from GitOps.** Argo CD must not manage credentials; they're created out-of-band.
- **History ≠ working tree.** Removing a secret from a file doesn't remove it from git history —
  rotation is what protects you.

## Assets
- Per-ticket docs: [`01`–`09`](README.md) + fixtures in [`../../tests/security-fixtures/`](../../tests/security-fixtures/README.md) and Argo CD assets in [`../../argocd/`](../../argocd/README.md).
- Slide deck: [`SPRINT-7-SLIDES.md`](SPRINT-7-SLIDES.md) (Marp).
- War Room: [`../warroom/SPRINT-7-WARROOM-STUDENT.md`](../warroom/SPRINT-7-WARROOM-STUDENT.md) (+ instructor solution, same folder).
- Rotation runbook: [`DSO-705-SECRET-ROTATION.md`](DSO-705-SECRET-ROTATION.md).
