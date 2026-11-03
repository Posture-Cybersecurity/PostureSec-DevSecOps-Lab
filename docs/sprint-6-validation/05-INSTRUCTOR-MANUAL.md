# Sprint 6 — Instructor Manual: Kubernetes Core Resources & Hardening on EKS

A step-by-step, reproducible procedure to stand up Sprint 6 on AWS EKS (Auto Mode),
deploy and validate the PostureSec app, and tear it down. All commands and outputs
below were executed and verified on 2026-11-03 against account `637551066935`,
region `us-east-1`, cluster `posturesec-eks`.

> **Known platform limitation (read first):** EKS **Auto Mode** does **not** enforce
> Kubernetes NetworkPolicies (its CNI is managed off-cluster; `kube-system` is empty,
> `aws eks list-addons` → `[]`). The policies in this lab are authored correctly but
> are **not enforced**. For a lab that must demonstrate network isolation (DSO-604),
> use a managed **node group** with the VPC CNI network-policy agent, or install
> **Calico** in policy-only mode. Everything else below is fully enforced.

---

## 1. Prerequisites
| Tool | Version verified | Check |
|------|------------------|-------|
| Terraform | 1.11.3 (≥ 1.5) | `terraform version` |
| AWS CLI v2 | — | `aws --version` |
| kubectl | 1.31 (skew ±1 of 1.32) | `kubectl version --client` |
| An AWS identity with admin-equivalent rights in the target account | — | `aws sts get-caller-identity` |

## 2. AWS account and IAM setup
- Target account: `637551066935`, region `us-east-1` (profile `postureblog-lab`).
- The identity that runs `terraform apply` becomes the cluster's admin via
  `enable_cluster_creator_admin_permissions = true` (an EKS **Access Entry**).
- **Note:** this account cannot create ELBs, so the frontend uses NodePort, not LoadBalancer.

```bash
export AWS_PROFILE=postureblog-lab
export AWS_REGION=us-east-1
aws sts get-caller-identity          # confirm the account/identity
```

## 3. Repository checkout and branch
```bash
git clone https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab.git
cd PostureSec-DevSecOps-Lab
git checkout feature/sprint-6-kubernetes-validation   # Sprint 6 branch (from origin/dev)
```

## 4. Terraform initialization (backend bootstrap)
The `terraform/` backend uses S3 + DynamoDB. Create them **once** per account
(bucket names are globally unique — use the account id suffix):
```bash
BUCKET="posturesec-tfstate-$(aws sts get-caller-identity --query Account --output text)"
aws s3api create-bucket --bucket "$BUCKET" --region us-east-1
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws dynamodb create-table --table-name posturesec-tf-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST --region us-east-1
```
Set the bucket name in `terraform/provider.tf` (`backend "s3" { bucket = "<BUCKET>" ... }`), then:
```bash
cd terraform
terraform init      # → "Terraform has been successfully initialized!"
terraform fmt -check
terraform validate  # → "Success! The configuration is valid."
```

## 5. Terraform plan and apply
```bash
terraform plan -out tfplan.bin     # verified: "Plan: 57 to add, 0 to change, 0 to destroy."
terraform apply tfplan.bin         # verified: "Apply complete! Resources: 57 added, 0 changed, 0 destroyed."
```
Apply takes ~10–15 min (EKS control plane). The plan creates the VPC (~24) and the
EKS Auto Mode cluster (~33: cluster, KMS key, CloudWatch log group, IAM, SGs, OIDC).

## 6. EKS cluster verification
```bash
aws eks describe-cluster --name posturesec-eks --region us-east-1 \
  --query 'cluster.{status:status,version:version,encryption:encryptionConfig,logging:logging.clusterLogging[0]}'
# verified: status ACTIVE, version 1.32, secrets encrypted (KMS), logging [api,audit,authenticator,controllerManager,scheduler]
terraform output     # cluster_name, cluster_endpoint, vpc_id, region
```
**EKS Auto Mode** manages: node provisioning/scaling (scale-from-zero via managed
Karpenter), node OS patching, CoreDNS, kube-proxy, the VPC CNI, the EBS CSI driver,
and the load-balancer controller. You declare node pools + workloads only.

## 7. AWS CLI and kubeconfig
```bash
aws eks update-kubeconfig --region us-east-1 --name posturesec-eks
kubectl get nodes      # On a fresh cluster: "No resources found" — Auto Mode scales from zero.
kubectl auth whoami    # confirms the IAM → EKS access-entry mapping
```
**Auth chain:** kubectl → `aws eks get-token` (pre-signed STS GetCallerIdentity, ~15-min token)
→ EKS API server → aws-iam-authenticator validates against STS → Access Entry maps the
ARN → admin access-policy grants cluster-admin.

## 8. Kubernetes namespace and configuration
```bash
kubectl apply -f k8s/namespace.yaml        # namespace/posturesec created
```

## 9. Secrets and ConfigMaps (create BEFORE the workloads)
Secrets are created out-of-band so **no credentials live in the repo**:
```bash
kubectl create secret generic posturesec-db-secret -n posturesec \
  --from-literal=POSTGRES_USER=posturesec_user \
  --from-literal=POSTGRES_PASSWORD='<choose-a-strong-password>' \
  --from-literal=POSTGRES_DB=posturesec_db

# Private GHCR images → imagePullSecret (use a read:packages token; revoke after)
kubectl create secret docker-registry ghcr-secret -n posturesec \
  --docker-server=ghcr.io --docker-username=<github-user> --docker-password='<read:packages-token>'
```
The non-sensitive config (`DB_HOST`, `DB_PORT`, `PORT`) is the `posturesec-config`
ConfigMap inside `k8s/posturesec.yaml`.

## 10–12. Deploy the app (StatefulSet, Deployments, Services, NetworkPolicies)
```bash
kubectl apply -f k8s/posturesec.yaml
kubectl wait --for=condition=Ready pod --all -n posturesec --timeout=540s
kubectl get pods,pvc,svc,statefulset,deploy,netpol -n posturesec
```
Expected: `posturesec-db-0` (StatefulSet) Ready; PVC `db-storage-posturesec-db-0`
**Bound** (10Gi gp3); backend 2/2, frontend 2/2; services `posturesec-db` (headless
ClusterIP), `posturesec-backend` (ClusterIP), `posturesec-frontend` (NodePort). The
first workload triggers Auto Mode to launch a node (~50s).

Access the frontend (no LoadBalancer in this account):
```bash
kubectl port-forward svc/posturesec-frontend 8080:80 -n posturesec   # then http://localhost:8080
```

## 13. Probes and scaling
```bash
kubectl scale deployment posturesec-backend -n posturesec --replicas=3
kubectl rollout status deployment/posturesec-backend -n posturesec    # "successfully rolled out"
kubectl delete pod -n posturesec <a-backend-pod>                      # ReplicaSet recreates it
kubectl scale deployment posturesec-backend -n posturesec --replicas=2
```
Probes: backend/ frontend use HTTP `GET /api/health` and `GET /` respectively; DB uses
`pg_isready` exec probes.

## 14. Persistence testing (StatefulSet)
```bash
kubectl exec -n posturesec posturesec-db-0 -- psql -U posturesec_user -d posturesec_db \
  -c "CREATE TABLE IF NOT EXISTS persistence_test(id serial, note text);" \
  -c "INSERT INTO persistence_test(note) VALUES ('survives-reschedule');"
kubectl delete pod -n posturesec posturesec-db-0
kubectl wait --for=condition=Ready pod/posturesec-db-0 -n posturesec --timeout=180s
kubectl exec -n posturesec posturesec-db-0 -- psql -U posturesec_user -d posturesec_db \
  -c "SELECT count(*), max(note) FROM persistence_test;"   # verified: 1 | survives-reschedule
```
The same PV re-binds to the rescheduled pod — data persists. (Local socket uses `trust`,
so no password is needed inside the pod.)

## 15. Troubleshooting
| Symptom | Cause / fix |
|---------|-------------|
| `terraform init` fails on the backend | state bucket missing/inaccessible or lock table absent → run the §4 bootstrap; bucket names are global |
| `terraform init` module download fails with `GIT_DIR too big` | a stray `GIT_DIR` env var; run `env -u GIT_DIR -u GIT_WORK_TREE terraform init`, or init from inside the repo |
| `kubectl get nodes` → No resources found | normal on a fresh Auto Mode cluster (scale-from-zero); deploy a workload |
| Pods `ImagePullBackOff` on GHCR images | `ghcr-secret` missing/invalid, or packages private → recreate the secret with a valid `read:packages` token |
| Backend pod one restart at first boot | it started before Postgres was ready; the `wait-for-db` initContainer + restart resolves it |
| A "test" pod can still reach the DB | expected — Auto Mode does not enforce NetworkPolicies (see top note) |

## 16. Cleanup and AWS cost management
Running cost ≈ $175–265/mo (EKS control plane ~$73, Auto Mode nodes, NAT gateway ~$33,
EBS/KMS/logs). **Tear down the same day** to keep it to a few dollars.
```bash
# delete k8s load-bearing objects first (releases EBS volumes; PVCs use Retain)
kubectl delete -f k8s/posturesec.yaml -n posturesec
kubectl delete pvc --all -n posturesec        # Retain policy keeps the PV/EBS otherwise
cd terraform && terraform destroy              # removes the 57 resources
# backend bootstrap (optional, if you won't redeploy):
aws s3 rm "s3://posturesec-tfstate-637551066935" --recursive
aws s3api delete-bucket --bucket posturesec-tfstate-637551066935 --region us-east-1
aws dynamodb delete-table --table-name posturesec-tf-lock --region us-east-1
```
Verify nothing remains: `aws eks list-clusters --region us-east-1` → `[]`, and check for
stray EBS volumes/NAT gateways in the console.
