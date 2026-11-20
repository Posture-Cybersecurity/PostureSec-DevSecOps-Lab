---
marp: true
title: "Sprint 7 — GitOps & the CI/CD Security Pipeline"
paginate: true
theme: default
---

# Sprint 7
## GitOps & the CI/CD Security Pipeline
**PostureSec — POSTURE Academy**

From a pipeline that *looks* secure to one that *is* — and a cluster that deploys itself from Git.

<!-- Render: `marp SPRINT-7-SLIDES.md --pdf` (or --pptx). -->

---

# The five tickets
1. **DSO-703** — pipeline gates: make lint/SCA/scanners **enforce**
2. **DSO-705** — secret hygiene: scanning, pre-commit, rotation
3. **DSO-701** — GitOps principles & install Argo CD
4. **DSO-702** — wire PostureSec to Argo CD
5. **DSO-704** — the CI bot closes the loop

> Theme: **enforcement over green**, then **pull-based delivery from Git**.

---

# The problem we started with
The pipeline already *ran* ESLint, npm-audit, Trivy, Checkov, Hadolint…

```yaml
jobs:
  trivy:
    continue-on-error: true   # "Demo: scans can fail without blocking"
```

…but **every job was `continue-on-error`**. Every run was green, regardless of findings.

**That is security theatre.**

---

# DSO-703 — make the gates enforce
- Remove `continue-on-error` / `|| true`; gate the deploy behind the scanners.
- **Decouple**: all five scanners run independently (one failure no longer hides the rest).
- Build the image **once**; Trivy scans what ships; publish/deploy only after **all** gates pass.

**Result:** the first enforced run went **red** — caught a real ESLint error, then real
HIGH/CRITICAL deps (axios SSRF), Terraform misconfigs, and image CVEs. *Red = working.*

---

# DSO-705 — stop secrets at the door
- gitleaks **gate** (full history) + **pre-commit** hook + **rotation runbook**.
- Deterministic fixtures: a planted secret **must** be caught; a clean file **must** pass.

**It immediately found a real one:**
```yaml
# k8s/posturesec.yaml  (committed!)
POSTGRES_PASSWORD: <REDACTED — a base64 value was committed here; base64 ≠ encryption>
```
→ removed from the manifest, created out-of-band, password flagged for rotation.
> The actual base64 string was itself scrubbed from this slide deck: embedding a real
> (even historical) credential in teaching material keeps it in Git history and trips
> the very scanner this slide is about. See the DSO-705 rotation runbook for the
> redacted-before/after.

---

# GitOps in one slide (DSO-701)
| Principle | Argo CD |
|---|---|
| Declarative | you commit manifests |
| Git = source of truth | syncs *from* Git |
| Continuous reconciliation | `Synced` / `OutOfSync` |
| Pull-based | cluster pulls; **CI holds no cluster creds** |
| Self-heal | reverts drift back to Git |

Installed from a **vendored, pinned** Argo CD v3.6.1 manifest.

---

# DSO-702 / DSO-704 — wire it & close the loop
- **DSO-702:** an Argo CD `Application` syncs `k8s/` — and manages **no secrets** (they're
  created out-of-band, so no credential re-enters Git).
- **DSO-704:** CI builds → **writes the new image tag to Git** (`[skip ci]`) → Argo CD deploys it.

```
push → gates ✓ → build-push → bot bumps tag in Git → Argo CD syncs → live
```
No `kubectl`. No cluster creds in CI.

---

# Honest status
- ✅ **Live-proven in CI:** DSO-703, DSO-705 (both run with no cluster).
- ✅ **Proven live on a disposable k3s cluster:** DSO-701/702/704 — install → sync → deploy →
  CI-bot bump → `git revert` rollback → reconcile, Healthy throughout (doc 10). An initial
  minikube attempt hit a minikube-1.34 ↔ Docker-29 skew; k3s-in-Docker was the working path.

**We don't fake a green checkmark — and here it's green because it actually ran.**

---

# Saturday War Room
**INC-007 — "The green pipeline that shipped a vulnerability."**

Someone re-weakened a gate; a HIGH-severity finding sailed through. You're on call:
find the weakened gate, restore enforcement, and prove it now blocks.

→ `docs/warroom/SPRINT-7-WARROOM-STUDENT.md`

---

# Takeaways
1. A **red** security gate is the gate doing its job.
2. `continue-on-error`, `|| true`, blanket `soft_fail`, broad allowlists = **theatre**.
3. **Pin** the tool *and* the vuln DB; assert on **IDs**, not counts.
4. **base64 ≠ encryption**; rotate on any exposure; history ≠ working tree.
5. GitOps: the cluster **pulls** reviewed state from Git — CI needs no cluster creds.
