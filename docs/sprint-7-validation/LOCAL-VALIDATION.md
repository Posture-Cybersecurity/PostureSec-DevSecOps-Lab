# Sprint 7 — Local Validation Evidence

Recorded **2026-11-17** on `feature/sprint-7-gitops-cicd-security` @ `b03545b` (= origin).
These are **local** runs (not remote CI), per the closure task. No application dependency was
changed and no real vulnerability was suppressed.

## Task 1 — Scanner fixtures (local)

| Scanner (pinned) | Fixture | Command | Result |
|---|---|---|---|
| npm audit | `sca/vulnerable` (`lodash@4.17.4`) | `npm audit --audit-level=high` | **exit 1** · `GHSA-35jh-r3h4-6jhm` |
| npm audit | `sca/clean` (`ms@2.1.3`) | `npm audit --audit-level=high` | **exit 0** · `found 0 vulnerabilities` |
| Trivy 0.76.2 | `trivy/vulnerable` (`python@sha256:b5ee…1527`) | `trivy image --severity CRITICAL,HIGH --ignore-unfixed --skip-db-update --exit-code 1` | **exit 1** · `CVE-2024-45491` · `Total: 84 (HIGH 75, CRITICAL 9)` |
| Trivy 0.76.2 | `trivy/clean` (`distroless/static-debian12@sha256:d75c…43f2`) | same | **exit 0** |
| Checkov 3.4.5 | `checkov/insecure` (SG SSH `0.0.0.0/0`) | `checkov -d … --framework terraform` | **exit 1** · `CKV_AWS_24` failed |
| Checkov 3.4.5 | `checkov/compliant` | same | **exit 0** · 0 failed |

**Trivy DB reproducibility:** Trivy `0.76.2`; vuln-DB `Version 2`, `UpdatedAt 2026-11-17
06:59:44 UTC`, frozen via a cached DB + `--skip-db-update`. Assertion is a specific CVE id,
not a count, so DB drift cannot flip the result.

## Decoupled graph + deployment blocking (from the branch's `.github/workflows/ci-cd.yml`)
All invariants **PASS**:
- `image-scan` (Trivy) depends only on `build-image` — **independent of `sca`** (Trivy runs
  even when SCA fails).
- `sca` and `iac-scan` are independent.
- `security-gates` = `{lint, dockerfile-lint, sca, iac-scan, image-scan, secret-scan}`.
- `build-push` needs `security-gates`; `update-manifest` (deploy bot) needs `build-push`.
- No `continue-on-error` on any gate (only the deploy bot).

→ **Any mandatory gate failing ⇒ `security-gates` skipped ⇒ `build-push` + `update-manifest`
skipped = no publish, no deploy.** Corroborated in CI: fixtures run `44055796438` (9/9) and
app run `44057333626` (Trivy ran on the app, failed, deploy jobs skipped).

## Task 2 — Live GitOps validation: BLOCKED
Local tooling: `docker 29.8.1`, `minikube v1.34.0`, `kubectl`, `helm 3.17.1`; `kind`/`k3d`
absent. No running cluster (no minikube profile; no k8s containers; the only kube contexts are
unreachable EKS clusters).

**Exact blocker:** `minikube v1.34.0` cannot drive **Docker 29.8.1** (its `docker version`
probe renders `<no value>` → `PROVIDER_DOCKER_NOT_RUNNING`); installing a newer minikube/kind
(download + run a binary) is blocked by the environment's oversight guardrail.

**Minimum setup to unblock (owner action):** `minikube ≥ v1.39.0` *or* `kind ≥ v0.33.0`, then
run the 8-step demo in the DSO-701/702/704 docs (install → connect → auto-sync → deploy →
CI-bot bump → Git-revert rollback → reconcile → health).

**Status honesty:** DSO-701/702/704 remain **◑ implemented + offline-validated** (701/702
validated against the real Argo CD CRD schema) — **not** declared live-complete, as no live
evidence exists.

## Boundaries honored
No merge, no deploy, no prod-infra change, no credential rotation, no push-protection change,
no history rewrite, no cluster/container/volume deletion, no gate weakened, no secret exposed.
