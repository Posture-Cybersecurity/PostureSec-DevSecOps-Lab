# Sprint 6 — Infrastructure Evidence (Phases 1–3)

Region: **us-east-1** · AWS account: **637551066935** · Cluster: **posturesec-eks** (EKS Auto Mode, k8s 1.32)

## Phase 1 — Isolated branch
- Branch `feature/sprint-6-kubernetes-validation` created from `origin/dev` @ `73922b03c6b746f1b39ef10d12ccca2cf50bfbd5` ("sprint3-update").
- Verified the new branch HEAD equals `origin/dev`. Worked in a dedicated git worktree; upstream unset (no accidental push to `dev`). `dev` not modified.

## Phase 2 — Assessment (key findings)
- EKS **Auto Mode** (`cluster_compute_config.enabled = true`, node pools `general-purpose` + `system`) — EKS manages nodes, kube-proxy, CoreDNS.
- Security already in config: secrets **encryption at rest** (`cluster_encryption_config` → KMS), **control-plane logging** (api, audit, authenticator, controllerManager, scheduler), public + private endpoint, `authentication_mode = "API"`.
- VPC module `~>5.0` (10.0.0.0/16, 3 AZs, single NAT gateway); EKS module `~>20.31`.
- **Gaps flagged for ticket work:**
  - DSO-602 expects PostgreSQL as a **StatefulSet**, but `k8s/posturesec.yaml` defines it as a **Deployment** (Recreate) + PVC. Needs conversion.
  - DSO-604 expects a **LoadBalancer** frontend, but the account cannot create ELBs (manifest downgraded to NodePort, per its own note).
  - DSO-601/603: backend/frontend images on **ghcr.io are private** (anonymous pull → HTTP 403). Needs a valid `ghcr-secret` imagePullSecret.

## Phase 3 — Validation
- `terraform version` → v1.11.3.
- `terraform fmt` → `provider.tf` reformatted (was mis-indented).
- `terraform validate` → **Success! The configuration is valid.**
- Pre-existing state backend `posturesec-terraform-state` was **inaccessible (403 / AllAccessDisabled)** and lock table `posturesec-tf-lock` **did not exist** → init/plan blocked.
- **Fresh backend provisioned (out-of-band):**
  - S3 `posturesec-tfstate-637551066935` — versioning on, SSE-S3 default encryption, all public access blocked.
  - DynamoDB `posturesec-tf-lock` — PAY_PER_REQUEST, key `LockID`.
  - `provider.tf` backend repointed to the new bucket; `terraform init` succeeded.
- `terraform plan` → **`Plan: 57 to add, 0 to change, 0 to destroy`** (no destructive changes). Full plan: `artifacts/terraform-plan.txt`.
  - VPC module ~24 resources; EKS Auto Mode module ~33 (cluster, KMS key+alias, CloudWatch log group, IAM, SGs, OIDC provider, access entry).

## Cost
- `apply` starts EKS control-plane (~$0.10/hr) + NAT gateway billing immediately; Auto Mode EC2 nodes bill when workloads schedule.
- Same-day provision → validate → teardown ≈ $5–15. Left running 24/7 ≈ $175–265/mo.

## Apply
- `terraform apply tfplan.bin` started (background). Outcome recorded in the next evidence section once complete.
