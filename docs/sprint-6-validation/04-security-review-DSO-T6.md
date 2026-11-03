# Sprint 6 — DSO-T6 Team Security Review

Reviewed `k8s/posturesec.yaml` + the Terraform against a hardening checklist.

| # | Control | Result |
|---|---------|--------|
| 1 | Non-root execution | Backend `runAsUser 1000`, Frontend `runAsUser 101` ✅. Postgres runs initdb as root then drops (official-image constraint) — documented ⚠️ |
| 2 | `allowPrivilegeEscalation: false` | All containers ✅ |
| 3 | Drop ALL capabilities | Backend, Frontend ✅. Postgres none (needs chown/setuid at init) ⚠️ |
| 4 | `readOnlyRootFilesystem` | Backend `true` ✅. Frontend `false` (nginx cache/pid) ⚠️ acceptable. Postgres `false` (data dir) ✅ expected |
| 5 | **seccompProfile** | **`RuntimeDefault` on all three workloads ✅ — implemented this sprint (was missing)** |
| 6 | `automountServiceAccountToken: false` | All workloads ✅ |
| 7 | Resource requests + limits | All app containers ✅ (initContainer has none ⚠️) |
| 8 | Image provenance / tags | App images pinned `:ab0403d` (not `latest`) ✅; base images from `public.ecr.aws` pinned ✅ |
| 9 | Secrets handling | Kubernetes `Secret` objects, **KMS-encrypted at rest** (DSO-505), not committed to the repo; private registry via `ghcr-secret` ✅ |
| 10 | Encryption of storage | `posturesec-ebs-sc` gp3 `encrypted: "true"`, `reclaimPolicy: Retain` ✅ |
| 11 | Network segmentation | default-deny + allowlist policies authored ✅ — **but not enforced by Auto Mode's managed CNI** ❌ (see DSO-604) |
| 12 | Probes (liveness/readiness) | All workloads ✅ |

## Improvement implemented (required by DSO-T6)
**Added `securityContext.seccompProfile.type: RuntimeDefault`** to the PostgreSQL StatefulSet and the backend & frontend Deployments. This replaces each container's implicit `Unconfined` seccomp with the container-runtime default profile, blocking dangerous syscalls — a kubelet-enforced control that is unaffected by the CNI network-policy gap. Verified: `jsonpath` shows `RuntimeDefault` on all three; all pods rolled out and stayed `Running`.

## Findings carried forward (recommended, not yet implemented)
1. **NetworkPolicy enforcement** — author-correct but inert on EKS Auto Mode. Enforce via a managed node group with the VPC CNI network-policy agent, or Calico in policy-only mode. *(High value — it is the DSO-604 isolation control.)*
2. **Postgres non-root** — run as a non-root UID with `fsGroup` + an init to own the data dir, so `runAsNonRoot: true` and dropped caps become possible.
3. **Pin images by digest** (`@sha256:…`) rather than the mutable `:ab0403d` tag.
4. **initContainer** `wait-for-db` should carry resource requests/limits.
5. **Default-deny egress** NetworkPolicy (once enforcement exists).
