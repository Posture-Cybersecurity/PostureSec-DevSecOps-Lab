# Sprint 6 — DSO-504 & DSO-505 Evidence

## DSO-504 — Provision `posturesec-eks`
- `terraform apply tfplan.bin` → **`Apply complete! Resources: 57 added, 0 changed, 0 destroyed.`**
- Terraform outputs: `cluster_name = posturesec-eks`, `cluster_endpoint = https://580D450CD3192EF4F1D7D9D806D36EA4.gr7.us-east-1.eks.amazonaws.com`, `vpc_id = vpc-0ebfe33154a5d40fa`, `region = us-east-1`.
- `aws eks describe-cluster` → **status `ACTIVE`**, version **1.32**.
- **State reviewed:** 57 resources tracked in the S3 backend `posturesec-tfstate-637551066935` (key `eks/terraform.tfstate`), DynamoDB lock table `posturesec-tf-lock`.

### What EKS Auto Mode manages
With Auto Mode you declare node pools (`general-purpose`, `system`) and your workloads; AWS runs the rest of the data plane:
- **Compute** — node provisioning, right-sizing, **scale-from-zero**, consolidation, and node recycling/patching via a managed Karpenter (no self-managed node groups or AMIs).
- **Core add-ons** — CoreDNS, kube-proxy, the **VPC CNI** (incl. NetworkPolicy enforcement), the **EBS CSI** storage driver, and the AWS **load-balancer controller** — all managed/upgraded by EKS.
- **OS patching** of nodes and a bounded node lifetime.
You keep control of cluster config, workloads, and policy; you no longer manage node groups or add-on versions by hand. This is why `kubectl get nodes` returned *no nodes* on a fresh cluster — nodes appear only when a workload needs scheduling.

## DSO-505 — Harden the cluster & connect
| Criterion | Evidence |
|---|---|
| **Encryption at rest** | `encryptionConfig.resources = ["secrets"]` with KMS key `arn:aws:kms:us-east-1:637551066935:key/35f75b39-4557-4a80-92d9-9ce46c5e5c98` |
| **Control-plane logging** | enabled: `api, audit, authenticator, controllerManager, scheduler` |
| **Endpoint access** | public = true, private = true |
| **AWS CLI auth** | `aws sts get-caller-identity` → `arn:aws:iam::637551066935:root` (profile `postureblog-lab`) |
| **kubeconfig** | `aws eks update-kubeconfig --region us-east-1 --name posturesec-eks` → context added |
| **`kubectl get nodes` succeeds** | command returns successfully (`No resources found` initially — Auto Mode scale-from-zero) |
| **Identity to cluster** | `kubectl auth whoami` → `arn:aws:iam::637551066935:root`, group `system:authenticated`; cluster-admin granted via the creator **Access Entry** + `AmazonEKSClusterAdminPolicy` association |

### The authentication chain (explained)
1. `kubectl` invokes the kubeconfig **exec credential plugin** → `aws eks get-token`.
2. The AWS CLI uses the IAM principal's credentials (profile `postureblog-lab`) to build a **pre-signed STS `GetCallerIdentity`** request — a short-lived bearer token. No static Kubernetes credential exists.
3. `kubectl` sends that token to the **EKS API server**.
4. The **aws-iam-authenticator** validates the pre-signed request against STS and extracts the caller's IAM ARN.
5. Because `authentication_mode = "API"`, EKS maps that ARN through an **Access Entry**; the creator **admin access-policy association** grants `cluster-admin`.
6. The request is authorized. (Rotation is automatic: each call mints a fresh ~15-min token.)
