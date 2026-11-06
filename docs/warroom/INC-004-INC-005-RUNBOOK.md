# INC-004 & INC-005 — Terraform drift + timed public-HTTP outage

Branch `feat/inc005-terraform-sdk`, base `feature/warroom-inc003` (`56f2fa0`).
This documents the **actual** implementation in this branch.

INC-004 is the Terraform drift-detection / guarded-remediation foundation.
INC-005 is the timed public-HTTP outage built on it: a fuse revokes the
dedicated security group's public TCP/80 ingress through the AWS SDK; students
investigate, detect the drift, pass a remediation plan through the guard, and
restore access.

---

## Components

| Area | File |
|------|------|
| EC2 host + network + SG rules | `deploy/warroom-host/main.tf` |
| IAM role, least-priv policy, instance profile | `deploy/warroom-host/iam.tf` |
| Variables / outputs / example tfvars | `deploy/warroom-host/{variables,outputs}.tf`, `terraform.tfvars.example` |
| Host bootstrap (user-data) | `deploy/warroom-host/user-data.sh` |
| Hosted Compose stack | `docker-compose.inc005.yml` |
| Terraform execution engine | `backend/src/warroom/tf_exec.js` |
| Plan guard | `backend/src/warroom/plan_guard.js` |
| Drift controller | `backend/src/warroom/drift_controller.js` |
| AWS SDK security-group control | `backend/src/warroom/aws_sg.js` |
| INC-005 injector | `backend/src/warroom/injector_sg_outage.js` |
| Timer readiness gate | `backend/src/warroom/timer.js` (`armWhenReady`) |
| Routes | `backend/src/warroom/routes.js` (`/drift`, `/remediate`, `/sg-state`) |
| Tests | `backend/tests/warroom_inc005_{plan_guard,drift,aws_sg}.test.js` |

The existing INC-003 architecture is **reused**: the single fuse in `timer.js`,
the injector registry in `incidents.js`, and the DB-backed incident state in
`state.js`. No new scheduler or timer was introduced.

---

## AWS account & region

- Account and region come from the AWS provider's default resolution. Verify
  with `aws sts get-caller-identity` before applying.
- Region defaults to `us-east-1` (`aws_region` variable / provider default).
- No credentials are stored in any file. Local Terraform uses your profile;
  the deployed backend uses the EC2 instance profile.

## Terraform deployment workflow

> Full step-by-step procedure: **[AWS-TERRAFORM-DEPLOYMENT-GUIDE.md](AWS-TERRAFORM-DEPLOYMENT-GUIDE.md)**. Summary:

```bash
# 1) build the app bundle (from the repo root)
tar -czf deploy/warroom-host/app-bundle.tgz \
  --exclude=node_modules --exclude=.git --exclude=.env --exclude=.env.example \
  backend frontend docker-compose.inc005.yml

# 2) deploy
cd deploy/warroom-host
export AWS_PROFILE=<scoped-deployer-profile>              # default-chain creds (prefer non-root)
export TF_VAR_instructor_token="$(openssl rand -hex 24)"  # ≥32 chars; record it; never commit
export TF_VAR_db_password="$(openssl rand -hex 12)"       # ≥12 chars, unique; never commit

terraform init
terraform fmt -check
terraform validate
terraform plan -out=warroom.tfplan        # 12 to add, 0 destroy; instance_type defaults to t3.medium
terraform apply warroom.tfplan
```

The host builds the images on boot (a few minutes); poll `http://<public_ip>/api/health`.

No Bash deployment wrapper; no `-auto-approve`. Review the plan first and
confirm only the intended resources, the public TCP/80 rule, and the IAM scope.

### Resources created (12)

Host + network: `aws_security_group.warroom`,
`aws_vpc_security_group_ingress_rule.http` (the drift target),
`aws_vpc_security_group_egress_rule.all`, `aws_instance.warroom`.
IAM: `aws_iam_role.warroom`, `aws_iam_role_policy.warroom_sg`,
`aws_iam_instance_profile.warroom`, `aws_iam_role_policy_attachment.ssm`.
App delivery (`delivery.tf`): `aws_s3_bucket.app`,
`aws_s3_bucket_public_access_block.app`,
`aws_s3_bucket_server_side_encryption_configuration.app`,
`aws_s3_object.app_bundle`. (A restricted SSH rule is created only if
`ssh_ingress_cidr` is set.)

### App delivery (no Git PAT, no SSH)

The private repo is not cloned on the host. Terraform uploads a locally-built
source bundle (`app-bundle.tgz`, excluding `.git` and `node_modules`) to a
private, encrypted, public-access-blocked S3 bucket; the instance profile is
granted `s3:GetObject` on just that object; `user-data.sh` pulls it with
`aws s3 cp` (instance-profile creds), extracts it, writes the backend env, and
runs `docker compose -f docker-compose.inc005.yml up -d --build`. Rebuild the
bundle before apply with:

```bash
cd <repo> && tar -czf deploy/warroom-host/app-bundle.tgz \
  --exclude=node_modules --exclude=.git backend frontend docker-compose.inc005.yml
```

### On-host access (SSM, no SSH)

`AmazonSSMManagedInstanceCore` is attached to the role for Session Manager
access (operational/debug), so no SSH port is opened. This is separate from the
least-privilege SG permissions.

## EC2 configuration

- Latest Ubuntu 22.04 LTS (Canonical AMI data source), `instance_type`
  (default `t3.medium` — headroom for the on-host image build), in the account's
  default VPC + a default public subnet.
- Root EBS `gp3`, `encrypted = true`, `root_volume_size` GiB (default 20).
- **IMDSv2 required** (`metadata_options.http_tokens = "required"`,
  hop limit 2 so containers can still reach the instance profile).
- `user-data.sh` installs Docker + Compose, writes the backend env
  (dedicated SG identity, delay, instructor token), and runs
  `docker-compose.inc005.yml`.

## Security-group exposure

| Rule | Port | Source | Notes |
|------|------|--------|-------|
| `...ingress_rule.http` | 80/tcp | `http_ingress_cidr` (default `0.0.0.0/0`) | Public lab access; the INC-005 drift target |
| `...ingress_rule.ssh` | 22/tcp | `ssh_ingress_cidr` | Only if set; `0.0.0.0/0` rejected by validation |
| `...egress_rule.all` | all | `0.0.0.0/0` | Outbound only |

PostgreSQL (5432) and the backend (5000) are **not** in the security group and
**not** published by Compose — they are reachable only on the internal network.

## IAM role & instance profile

`iam.tf` creates a least-privilege role assumed by `ec2.amazonaws.com`, attached
via an instance profile. The policy grants exactly:

| Action | Resource | Why |
|--------|----------|-----|
| `ec2:DescribeSecurityGroups`, `ec2:DescribeSecurityGroupRules` | `*` (no resource-level support in EC2) | Read-only discovery/verification |
| `ec2:AuthorizeSecurityGroupIngress`, `ec2:RevokeSecurityGroupIngress` | the dedicated SG ARN only | Revoke/restore the one public HTTP rule |

No broad EC2 admin, no other services. The mutating actions are scoped to the
single lab security group by ARN.

## SDK authentication

`backend/src/warroom/aws_sg.js` uses `@aws-sdk/client-ec2` with **no explicit
credentials** — the default credential chain resolves the EC2 instance profile's
temporary credentials via IMDSv2. **No static access keys**, no `~/.aws` mount,
no developer credentials in the container. The module only ever targets
`WARROOM_SG_ID`, re-validating the SG's account and identity tag
(`warroom:incident=INC-005`) before any mutation, and only touches tcp/80.

## Hosted Compose deployment

`docker-compose.inc005.yml`: `frontend` publishes `80:8080` (public);
`db` has no published port (internal only); `backend` is `read_only`,
`no-new-privileges`, with a Node health check. `restart: unless-stopped` on all
services means the stack returns after a host reboot. The backend health check
gates readiness; the incident timer arms only after readiness
(`armWhenReady` → DB reachable).

## Incident timer

Reuses the INC-003 fuse (`timer.js`): one idempotent, one-shot `setTimeout`,
default delay 300s (`WAR_ROOM_INCIDENT_DELAY_SECONDS`, clamped 5–86400),
persistent state in `warroom_incident`, restart-safe (an already-active incident
is not re-fired — `runIncident` checks current status), cancellable via the
instructor reset. For INC-005 the fuse arms only after verified readiness.

## The incident (what fires)

`injector_sg_outage.runIncident()` → `aws_sg.revokeHttpIngress()` revokes the
dedicated SG's tcp/80 rule, then records a **generic** availability alarm (no
root cause named). The app keeps running; only external reachability is lost.

## Terraform drift detection

`drift_controller.detect()` runs `terraform plan` and inspects the structured
plan JSON: if `aws_vpc_security_group_ingress_rule.http` shows a `create`, the
rule is missing in reality → drift. Unrelated changes are reported separately.

## Guarded student remediation

1. Inspect the incident: `GET /api/incident`.
2. Examine SG state: `GET /api/incident/sg-state` (instructor token).
3. Detect drift: `GET /api/incident/drift`.
4. Remediate: `POST /api/incident/remediate` — generates a plan, runs it through
   `plan_guard`, and applies **only** if the guard approves exactly one `create`
   of the HTTP rule. Any extra create/update/delete/replace, any other resource
   address, or a stale/modified plan is **rejected** and nothing is applied.
5. Verify: `drift_controller.verify()` confirms a fresh plan is a clean no-op on
   the target (`GET /api/incident/drift` → `drift_detected: false`).

Remediation can also be run on the host directly:

```bash
cd deploy/warroom-host
terraform plan -out=tfplan
terraform show -json tfplan   # inspect; the guard reasons over this JSON
terraform apply tfplan        # restores the one ingress rule
```

## Instructor reset

`POST /api/incident/reset` (instructor token) re-authorises the public HTTP rule
(`aws_sg.authorizeHttpIngress`), returns the alarm to idle, and cancels any
pending fuse. Idempotent: re-opening an already-open rule is a no-op.

## Host restart procedure

A reboot needs no manual steps: the Docker service is enabled and every
container has `restart: unless-stopped`, so the stack returns automatically and
the DB volume (`inc005_pgdata`) persists. The backend re-reads incident state
from the database (no duplicate injection), regains instance-profile
credentials from IMDS, and `armWhenReady` arms a FRESH fuse once readiness is
re-confirmed — so a rebooted lab re-injects the incident ~`delay` seconds later.
To keep HTTP up after a reboot, `POST /api/incident/reset` cancels the pending
fuse.

```bash
aws ec2 reboot-instances --instance-ids <id>   # stack self-recovers in ~40s
```

## Troubleshooting

- **`WARROOM_SG_ID is not configured`** — the backend env file was not written;
  check user-data and that `terraform apply` populated the SG id.
- **`AccessDenied` on revoke/authorize** — the instance profile is not attached,
  or the SG ARN in the policy does not match the live SG.
- **Timer never arms** — readiness probe failing; check DB health.
- **SSM `InvalidDocument`** — the Linux shell document is `AWS-RunShellScript`;
  `AWS-RunShellCommand` is not a real document name.
- **`DB_PASSWORD ... missing a value`** — `TF_VAR_db_password` was not set at
  deploy, so the host env file lacks it; re-deploy with the variable set.
- **Public HTTP still down after remediate** — confirm the guard approved and
  the apply succeeded (`/api/incident/drift` should show no drift).

## Infrastructure cleanup

```bash
cd deploy/warroom-host
terraform destroy      # removes the host, SG, rules, IAM role/policy/profile,
                       # and the S3 bucket + bundle (force_destroy = true)
```

Do not commit real state files or `terraform.tfvars` (the instructor token).
State is local by default and must not collide with the EKS root's S3 state.

## Known limitations

- The DB password is now a required `db_password` variable supplied at deploy via
  `TF_VAR_db_password` (no hardcoded value in `docker-compose.inc005.yml`). It and
  the instructor token still reach the host through EC2 user-data (readable via
  `ec2:DescribeInstanceAttribute` and in local state); for stronger isolation,
  move them to SSM Parameter Store / Secrets Manager fetched via the instance
  profile.
- The embedded GitHub PAT was removed from the `origin` remote URL; the exposed
  token must still be **rotated** on GitHub.
- Remediation (Terraform plan/guard/apply) runs from the operator's machine or
  the host, where the terraform CLI, state and the `deploy/warroom-host` root
  live — not inside the backend container (which has no terraform). The backend
  `/remediate` route works only where those are mounted/reachable; by design,
  the outage takes down port 80, so remediation is out-of-band anyway.
- Static root credentials were used for the Terraform runs (per operator
  choice); a scoped IAM principal is recommended. The hosted BACKEND uses the
  instance profile only — no static keys.
- The remediation plan must be generated with the same variable values as the
  deploy (`instance_type`, `instructor_token`, `db_password`); otherwise Terraform
  reports spurious drift and the guard (correctly) rejects the plan. Supply them
  via `TF_VAR_*`. (`instance_type` now defaults to `t3.medium`, matching deploys
  that take the default.)
