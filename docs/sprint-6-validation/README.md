# Sprint 6 — Kubernetes Core Resources & Hardening: AWS Validation

Validated on **2026-11-03**, account `637551066935`, region `us-east-1`, cluster
`posturesec-eks` (EKS Auto Mode, k8s 1.32). Branch `feature/sprint-6-kubernetes-validation`.

## Ticket scorecard
| Ticket | Status | Notes |
|--------|--------|-------|
| DSO-504 Provision `posturesec-eks` | ✅ PASS | 57 resources, ACTIVE, state reviewed |
| DSO-505 Harden & connect | ✅ PASS | KMS encryption, 5 log types, auth chain verified |
| DSO-601 Backend & frontend | ✅ PASS | 2/2 each, probes, self-heal, scaling |
| DSO-602 StatefulSet + PVC | ✅ PASS | data survived pod reschedule, same PV |
| DSO-603 Secrets/ConfigMap/order | ✅ PASS | no hardcoded secrets, correct order |
| DSO-604 Services & NetworkPolicy | ⚠️ PARTIAL | types + policies correct; **Auto Mode does not enforce NetworkPolicies** |
| DSO-T6 Security review | ✅ PASS | 12-point review + seccompProfile hardening implemented |

## Contents
- `01-infrastructure-evidence.md` — Phases 1–3: branch, assessment, fmt/validate/plan, backend bootstrap.
- `02-cluster-access-evidence.md` — DSO-504/505: cluster status, encryption, logging, auth chain, Auto Mode.
- `03-workloads-evidence.md` — DSO-601/602/603/604: deployments, persistence, secrets, services, network policy.
- `04-security-review-DSO-T6.md` — security checklist, findings, the seccomp improvement.
- `05-INSTRUCTOR-MANUAL.md` — full reproducible procedure (16 sections) incl. cleanup.
- `06-SLIDES-PROMPT.md` — Phase 7 prompt for Claude to build the teaching deck.
- `artifacts/terraform-plan.txt` — the full `terraform plan` output.

## Material caveats (honest)
1. **No LoadBalancer** in this account → frontend is NodePort + `kubectl port-forward`.
2. **NetworkPolicies not enforced** by EKS Auto Mode's managed CNI → DSO-604 isolation
   not demonstrable here; remediation = managed node group with VPC CNI network-policy
   agent, or Calico policy-only mode.
3. AWS identity was account **root** (only working profile available).

## Cost
Running ≈ $175–265/mo (control plane, Auto Mode nodes, NAT gateway, EBS/KMS/logs).
Tear down same day → a few dollars. Cleanup steps in §16 of the instructor manual.
