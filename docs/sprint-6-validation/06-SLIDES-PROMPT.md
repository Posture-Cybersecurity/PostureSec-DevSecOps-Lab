# Phase 7 — Prompt for Claude to build the Sprint 6 teaching slides

Paste the prompt below into Claude (the chat assistant, **not** Claude Code). It is
derived from the actual implementation and the verified validation evidence in this
directory. Attach `01`–`04` evidence files + `05-INSTRUCTOR-MANUAL.md` if you can.

---

**PROMPT:**

You are creating a teaching slide deck for **Sprint 6 — Kubernetes: Core Resources &
Hardening**, part of the PostureSec DevSecOps training. Audience: junior-to-mid
DevSecOps learners who have finished Docker Compose and basic AWS sprints. Tone:
practical, security-first, honest about trade-offs. Produce ~18–22 slides with concise
bullets, a presenter note per slide, and a hands-on demo callout where relevant. Use
only the facts below — do not invent cloud outputs.

**The real system being taught:**
- AWS **EKS Auto Mode** cluster `posturesec-eks` (Kubernetes 1.32), provisioned by
  Terraform (VPC module + EKS module, 57 resources, S3/DynamoDB remote state).
- App: a 3-tier PostureSec stack — **PostgreSQL** (StatefulSet + 10Gi encrypted gp3
  PVC), **backend** (Node, 2 replicas), **frontend** (nginx, 2 replicas), private
  images from GHCR pulled via an imagePullSecret.
- Security posture: KMS secrets encryption, control-plane logging, non-root containers,
  dropped capabilities, seccomp `RuntimeDefault`, `automountServiceAccountToken: false`,
  resource limits, default-deny + allowlist NetworkPolicies.

**Teach these concepts explicitly (one or more slides each):**
1. **EKS Auto Mode** — what AWS manages vs what you declare; scale-from-zero (why
   `kubectl get nodes` is empty on a fresh cluster); managed Karpenter, CNI, EBS CSI, LB.
2. **The EKS authentication chain** — kubectl → `aws eks get-token` → pre-signed STS →
   aws-iam-authenticator → Access Entry (API auth mode) → cluster-admin. Emphasise there
   is no static kubeconfig secret; tokens are short-lived.
3. **StatefulSet vs Deployment** — stable identity, headless service, per-pod PVC via
   `volumeClaimTemplates`; why databases need it. Include the verified persistence demo
   (write row → delete `posturesec-db-0` → row survives, same PV re-binds).
4. **Deployments, probes, ReplicaSets, scaling** — liveness/readiness, self-heal,
   `kubectl scale` 2→3→2 (verified rollouts).
5. **Secrets & ConfigMaps** — Secret objects vs ConfigMaps; KMS encryption at rest;
   imagePullSecret for private registries; "no hardcoded secrets"; apply order
   namespace → secrets → configmaps → workloads → services.
6. **Services & network segmentation** — ClusterIP vs headless vs NodePort/LoadBalancer;
   default-deny + explicit allow NetworkPolicies as least-privilege networking.
7. **Container hardening** — non-root, drop ALL caps, readOnlyRootFilesystem, seccomp,
   no SA token automount, resource limits.

**Be honest about two real-world constraints (dedicate a "gotchas" slide):**
- This AWS account **cannot create LoadBalancers**, so the frontend is NodePort +
  `kubectl port-forward` — a realistic lesson in account/SCP limits.
- **EKS Auto Mode did not enforce the NetworkPolicies** (an unlabeled test pod reached
  PostgreSQL). The policies are correct but inert on Auto Mode's managed CNI. Teach the
  remediation: managed node group with the VPC CNI network-policy agent, or Calico in
  policy-only mode. Use this as a "validate your controls, don't assume" security lesson.

**Suggested flow:** title → sprint goals & tickets (DSO-504..604, T6) → architecture
diagram → Terraform/provisioning → Auto Mode → auth chain → namespace/secrets/configmaps
→ StatefulSet + persistence demo → deployments/probes/scaling → services & network
policies → container hardening & security review → the two gotchas → cost & cleanup →
recap/quiz.

**Per acceptance criteria**, mark each ticket PASS, and show DSO-604 as "controls
authored, enforcement blocked by platform — remediation known." End with a one-slide
cost note (~$175–265/mo running; tear down same day) and a 3-question knowledge check.

Output the deck as <your preferred format: Markdown slides / reveal.js / PPTX outline>.
