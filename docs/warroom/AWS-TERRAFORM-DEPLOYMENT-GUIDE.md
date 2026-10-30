# POSTURESEC War Room — AWS Terraform Deployment Guide (INC-004 / INC-005)

A standalone, reproducible procedure to deploy the hosted INC-005 lab to AWS and
tear it down. No prior context required. The Terraform root is
`deploy/warroom-host/`; all commands run from the repository working tree.

> Secrets are supplied at deploy time via environment variables. Nothing secret
> is committed, placed in Terraform outputs, or included in the app bundle.

---

## 1. Architecture overview

```
Internet ──TCP/80──▶ EC2 (Ubuntu 22.04, t3.medium, IMDSv2 required)
                       │  Docker Compose (docker-compose.inc005.yml)
                       │   ├─ frontend  nginx :8080 ─▶ published :80
                       │   ├─ backend   node  :5000  (internal only)
                       │   └─ db        postgres     (internal only, volume)
                       │  Backend AWS SDK ──instance profile/IMDSv2──▶ EC2 API
                       ▼
            Dedicated security group  (tcp/80 from 0.0.0.0/0 = the drift target)

Terraform provisions: EC2, SG + standalone ingress/egress rules, IAM role +
least-priv policy + instance profile (+ SSM core), and a private, encrypted,
public-access-blocked S3 bucket holding the app source bundle. On boot the
instance profile pulls the bundle from S3 and `docker compose up --build`s it.

INC-005 lifecycle: a 300s fuse (after verified readiness) → backend AWS SDK
revokes the tcp/80 ingress rule → public outage → students detect the Terraform
drift, pass a remediation plan through the plan guard (exactly one create), and
apply it to restore access.
```

## 2. Prerequisites

| Tool | Why | Verify |
|------|-----|--------|
| Terraform ≥ 1.5 | provisioning | `terraform version` |
| AWS CLI v2 | auth + verification | `aws --version` |
| Git | source | `git --version` |
| tar | build the bundle | `tar --version` |

Node.js/npm and Docker are **not** required on the deployer machine — the images
build on the EC2 host. (They are only needed if you want to run the backend
tests locally.)

An AWS identity with permissions to create EC2, IAM, and S3 resources (see §4).

## 3. AWS authentication

Configure a named profile — never share or paste credentials:

```bash
aws configure --profile posturesec-deployer
aws sts get-caller-identity --profile posturesec-deployer
```

Confirm the returned `Account` is the intended lab account and set the region:

```bash
export AWS_PROFILE=posturesec-deployer
export AWS_REGION=us-east-1
aws configure get region --profile posturesec-deployer   # or rely on AWS_REGION
```

Do not rely on an unknown `default` profile. Prefer a scoped IAM principal over
root (root works but is discouraged).

## 4. Minimum deployer permissions

The deployer (distinct from the EC2 instance role) needs to create the stack.
A practical least-privilege starting policy (tighten `Resource` to your tags/ARNs):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "EC2", "Effect": "Allow", "Action": [
        "ec2:*SecurityGroup*", "ec2:*Instances", "ec2:Describe*",
        "ec2:*Tags", "ec2:*Volume*", "ec2:ModifyInstanceMetadataOptions" ],
      "Resource": "*" },
    { "Sid": "IAM", "Effect": "Allow", "Action": [
        "iam:CreateRole","iam:DeleteRole","iam:GetRole","iam:PassRole",
        "iam:PutRolePolicy","iam:DeleteRolePolicy","iam:GetRolePolicy",
        "iam:AttachRolePolicy","iam:DetachRolePolicy","iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:CreateInstanceProfile","iam:DeleteInstanceProfile","iam:GetInstanceProfile",
        "iam:AddRoleToInstanceProfile","iam:RemoveRoleFromInstanceProfile" ],
      "Resource": "*" },
    { "Sid": "S3", "Effect": "Allow", "Action": [
        "s3:CreateBucket","s3:DeleteBucket","s3:PutObject","s3:GetObject",
        "s3:DeleteObject","s3:PutEncryptionConfiguration","s3:PutBucketPublicAccessBlock",
        "s3:GetBucketLocation","s3:ListBucket","s3:GetEncryptionConfiguration",
        "s3:GetBucketPublicAccessBlock" ],
      "Resource": "*" }
  ]
}
```

The **EC2 instance role** created by Terraform is separately least-privilege:
Describe security groups (read), Authorize/Revoke ingress scoped to the one lab
SG ARN, `s3:GetObject` on just the bundle object, and `AmazonSSMManagedInstanceCore`.

## 5. Prepare the application bundle

From the repository root, build the source bundle (Terraform uploads it to S3):

```bash
tar -czf deploy/warroom-host/app-bundle.tgz \
  --exclude=node_modules --exclude=.git --exclude=.terraform \
  --exclude='*.tfstate*' --exclude=tfplan --exclude=app-bundle.tgz \
  --exclude=.env --exclude=.env.example \
  backend frontend docker-compose.inc005.yml
```

Verify it carries no real secrets and no junk:

```bash
tar -xzOf deploy/warroom-host/app-bundle.tgz | grep -icE 'ghp_[A-Za-z0-9]|AKIA[0-9A-Z]{16}'   # expect 0
tar -tzf  deploy/warroom-host/app-bundle.tgz | grep -cE '\.git/|node_modules/'                 # expect 0
```

You do **not** upload anything through the AWS console — `terraform apply` uploads
the bundle to the private S3 bucket for you.

## 6. Configure Terraform variables

| Variable | Required? | Default | Notes |
|----------|-----------|---------|-------|
| `instructor_token` | **secret, required** | – | ≥32 chars; `TF_VAR_instructor_token` |
| `db_password` | **secret, required** | – | ≥12 chars, unique; `TF_VAR_db_password` |
| `aws_region` | optional | `us-east-1` | |
| `instance_type` | optional | `t3.medium` | build headroom; don't drop below this for the build |
| `root_volume_size` | optional | `20` | GiB, gp3, encrypted |
| `http_ingress_cidr` | optional | `0.0.0.0/0` | public lab access (intentional) |
| `ssh_ingress_cidr` | optional | `""` (no SSH) | never `0.0.0.0/0` (validated) |
| `incident_delay_seconds` | optional | `300` | 5–86400 |
| `app_bundle_path` | optional | `app-bundle.tgz` | relative to the module |
| `name_prefix`, `environment` | optional | `warroom`, `dev` | |

Supply secrets by environment only (never in `terraform.tfvars`, never committed):

```bash
export TF_VAR_instructor_token="$(openssl rand -hex 24)"   # 48 chars; record it securely
export TF_VAR_db_password="$(openssl rand -hex 12)"        # 24 chars
```

Record the instructor token somewhere safe — you need it for the instructor
endpoints. `terraform.tfvars.example` holds non-secret placeholders only.

## 7. Initialize and validate

```bash
cd deploy/warroom-host
terraform init
terraform fmt -check
terraform validate
```

## 8. Review the plan

```bash
terraform plan -out=warroom.tfplan
```

Expect **12 to add, 0 to change, 0 to destroy**: SG + http ingress rule + egress
rule + EC2 instance; IAM role + SG policy + instance profile + SSM attachment;
S3 bucket + public-access-block + encryption config + bundle object. Confirm
there are **no destroys** and no unrelated resources, that tcp/80 is the only
public ingress, and that the IAM policy is scoped to the one SG.

## 9. Deploy

```bash
terraform apply warroom.tfplan        # applies the reviewed plan
# or, equivalently, review-and-apply in one step:
# terraform apply                     # prompts for confirmation (no -auto-approve)
```

## 10. Obtain the application URL

```bash
terraform output                      # all outputs
terraform output -raw application_url # e.g. http://<public_ip>
terraform output -raw instance_id
```

## 11. Verify readiness

**Host readiness** (instance + Docker) vs **application readiness** (containers
serving) are distinct — the images build on the host for a few minutes after the
instance is `running`.

```bash
IP=$(terraform output -raw public_ip)

# Host: instance running, profile attached, IMDSv2 required
aws ec2 describe-instances --instance-ids "$(terraform output -raw instance_id)" \
  --query 'Reservations[0].Instances[0].{State:State.Name,Profile:IamInstanceProfile.Arn,HttpTokens:MetadataOptions.HttpTokens}'

# Application: poll until healthy (build can take ~2–5 min)
until curl -fsS -m 5 "http://$IP/api/health"; do sleep 10; done; echo

# Frontend, backend, DB, auth
curl -s -o /dev/null -w 'frontend %{http_code}\n' "http://$IP/"
curl -s "http://$IP/api/health"; echo
curl -s -X POST "http://$IP/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"tester@warroom.local","password":"correct-horse-battery-staple"}'

# Instance-profile AWS auth + SG state (needs the instructor token)
curl -s "http://$IP/api/incident/sg-state" -H "x-warroom-token: $TF_VAR_instructor_token"

# On-host checks via SSM (no SSH). Use AWS-RunShellScript (NOT RunShellCommand):
aws ssm send-command --instance-ids "$(terraform output -raw instance_id)" \
  --document-name AWS-RunShellScript \
  --parameters commands='docker ps --format "{{.Names}} {{.Status}}"'
```

## 12. Test the incident (INC-005)

```bash
IP=$(terraform output -raw public_ip); T="$TF_VAR_instructor_token"

# Trigger now (same code path the 300s timer uses), or just wait for the fuse:
curl -s -X POST "http://$IP/api/incident/trigger" -H "x-warroom-token: $T"
# Observe outage: public HTTP stops; only tcp/80 is revoked, egress untouched:
curl -s -o /dev/null -w '%{http_code}\n' -m 6 "http://$IP/"   # -> 000
aws ec2 describe-security-groups --group-ids "$(terraform output -raw security_group_id)" \
  --query 'SecurityGroups[0].{Ingress:length(IpPermissions),Egress:length(IpPermissionsEgress)}'

# Remediate from here (operator machine or host), matching the deploy vars so the
# ONLY drift is the missing rule:
cd deploy/warroom-host
terraform plan -out=remediate.tfplan            # drift: one create of the http rule
terraform show -json remediate.tfplan | less    # the plan guard reasons over this JSON
terraform apply remediate.tfplan                # restores tcp/80
curl -s -o /dev/null -w '%{http_code}\n' "http://$IP/"   # -> 200

# Reset (idempotent) and confirm:
curl -s -X POST "http://$IP/api/incident/reset" -H "x-warroom-token: $T"
curl -s "http://$IP/api/incident/status"; echo
```

The backend also exposes `GET /api/incident/drift` and `POST /api/incident/remediate`
(instructor token) where the terraform CLI + this root are reachable; by design
the outage takes down port 80, so remediation is normally run out-of-band as above.

## 13. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `/api/health` never 200 | image build still running or failed; check via SSM `docker compose logs` |
| `AccessDenied` on revoke | instance profile not attached, or SG ARN in policy ≠ live SG |
| SSM `InvalidDocument` | use `AWS-RunShellScript`, not `AWS-RunShellCommand` |
| `DB_PASSWORD ... missing a value` | `TF_VAR_db_password` not set at deploy (env file not written) |
| remediation plan rejected by guard | plan generated with different `TF_VAR_instance_type`/`instructor_token`/`db_password` than deploy → spurious drift; re-run with the same values |
| `WARROOM_SG_ID is not configured` | env file not written; check user-data / that apply populated the SG id |

## 14. Teardown

Stopping the instance pauses compute billing but keeps EBS/other resources and
does not remove the lab. **Destroy** removes the entire deployment:

```bash
cd deploy/warroom-host
terraform destroy          # removes all 12 resources, incl. the S3 bucket + bundle
```

Destruction is never automatic after a deploy. Verify afterwards:

```bash
terraform state list                      # empty
aws ec2 describe-instances --instance-ids <id> --query 'Reservations[0].Instances[0].State.Name'  # terminated
aws s3api head-bucket --bucket warroom-inc005-<account_id>   # 404
```

## 15. Expected costs

Running (us-east-1, approx): t3.medium ~$0.0416/hr, 20 GB gp3 ~$1.60/mo,
1 public IPv4 ~$3.60/mo, S3 (≈160 KB) ~$0, minimal data transfer. A multi-hour
lab session is a few cents of compute; left running ~$0.05/hr. `terraform destroy`
stops all of it.

## 16. Security considerations

- Public **TCP/80 only**; PostgreSQL (5432) and backend (5000) are never published.
- **No SSH to the internet** (optional, restricted via `ssh_ingress_cidr`); on-host
  access is via SSM Session Manager.
- **IMDSv2 required**; backend uses the instance profile via the default credential
  chain — **no static keys, no `~/.aws` mount**.
- Least-privilege instance role: Describe (read), Authorize/Revoke scoped to the
  one SG ARN, `s3:GetObject` on the one bundle object, SSM core.
- Private S3 bucket: encrypted (AES256), all public access blocked.
- Secrets (`instructor_token`, `db_password`) are supplied via `TF_VAR_*`, written
  root-only to the host env file, and never committed, output, or bundled.
- Prefer a scoped deployer principal over root. Rotate any credential ever exposed
  (e.g. a PAT previously embedded in the git remote URL — now removed).
- **Residual note:** the instructor token and db password are passed to the host
  through EC2 user-data (readable via `ec2:DescribeInstanceAttribute` and in local
  state). For stronger isolation, store them in SSM Parameter Store / Secrets
  Manager and fetch them on the host via the instance profile.
- Terraform state is local and holds sensitive values — do not commit it; use a
  protected remote backend (distinct from the EKS root's state) for shared use.
