# PostureBlogging on one EC2 instance (Docker Compose) — disposable lab

Terraform provisions **one Ubuntu EC2 instance**, installs **Docker + the
Compose plugin**, and runs the repository's **existing `docker-compose.yml`**
(frontend, backend, PostgreSQL). Nothing more: no NAT, load balancer, RDS,
Lambda, API Gateway, CloudFront or Kubernetes.

> **Status (2026-10-20): implemented and validated locally. NOT deployed.**
> No AWS call has been made and no plan exists yet against a real account —
> see [Plan and deploy](#plan-and-deploy-needs-approval).
>
> **Disposable lab configuration:** plain **HTTP on a public IP**, an
> **intentionally vulnerable** training app, synthetic data only. Not
> production, not HTTPS, not for real users or real data.

This stack is independent of `deploy/aws-postureblog/` (the deferred
Lambda/RDS design, on another branch) and of the EKS stack: own directory, own
local state, names `postureblog-ec2-*`, tag `Stack = postureblog-ec2`.

## Architecture

```
   approved CIDR(s) only            (optional) operator /32 -- SSH 22
          |  HTTP 80                          |
  +-------v-----------------------------------v-----------------------+
  | Security group postureblog-ec2-<env>-<owner>: nothing else inbound |
  |  EC2 t3.small, Ubuntu 24.04, encrypted gp3, IMDSv2 (hop limit 1)   |
  |   Docker Compose project "postureblog" (restart: unless-stopped)   |
  |     frontend  nginx :8080 <- host :80   serves the React build,    |
  |                                         proxies /api -> backend    |
  |     backend   Node/Express :5000        (not published)            |
  |     db        PostgreSQL 16 :5432       (not published)            |
  |   /opt/postureblog/.env  POSTGRES_PASSWORD generated at first boot |
  +--------------------------------------------------------------------+
   default VPC, public subnet; outbound open (apt, GitHub, npm, Docker Hub, SSM)
```

**This automates the manual process already proven on a real EC2 instance** —
install Docker Engine + the Compose plugin exactly as
`deploy/warroom-ec2-bootstrap.sh` (War Room branches) does, get the repository,
`docker compose up -d --build` — and adds only what an unattended run needs:
a pinned commit, a generated database password, a health wait.

Boot sequence (`user_data.sh`, logged to `/var/log/postureblog-bootstrap.log`):
base packages → 2 GB swap → Docker Engine + Compose plugin from Docker's apt
repository (key via `gpg --dearmor`, as in the War Room bootstrap) → `ubuntu`
added to the `docker` group (so you can run `docker compose` by hand, as in the
manual process) → `git fetch` of the app at a **pinned commit** → write the Compose
override and a generated `.env` → `docker compose up -d --build` → wait up to
10 minutes for `http://localhost/api/health`. Re-running it is safe: it keeps
the existing password and data. After a reboot, Docker starts at boot and the
`restart: unless-stopped` policy brings all three containers back.

## The Compose configuration reused

`docker-compose.yml` at the repository root, **unchanged** — services `db`
(`postgres:16-alpine`, healthcheck), `backend` (`backend/Dockerfile`,
non-root, read-only root filesystem, waits for a healthy db), `frontend`
(`frontend/Dockerfile`, nginx on 8080 published as host port 80). The app is
deployed from `https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab.git`
at `lab/dev` commit `73922b03c6b746f1b39ef10d12ccca2cf50bfbd5` (`app_git_ref`).

One small override, [`compose.ec2.yaml`](compose.ec2.yaml), and why:

| Change | Why |
|---|---|
| `POSTGRES_PASSWORD` / `DB_PASSWORD` from `.env` (required — Compose refuses to start without it) | The base file commits a demo password; an internet-facing host must not use it |
| `db.ports: !reset []` | The base file publishes PostgreSQL on host port 55900 for local development; on EC2 it must not be published at all |

## Security controls

* **Inbound:** port 80 from `http_ingress_cidrs` only (required; `0.0.0.0/0`
  refused unless `allow_http_from_anywhere = true` is set deliberately). SSH
  only if `ssh_ingress_cidrs` is set (≤ /24, never `0.0.0.0/0`, needs
  `key_name`). PostgreSQL (5432/55900) and the API (5000) are never published.
* **No SSH needed:** Session Manager via an instance role with only
  `AmazonSSMManagedInstanceCore` (`enable_ssm`, default on).
* **No secrets in Terraform, user data, state, plan, outputs or logs:** the DB
  password is generated on the instance (`openssl rand -hex 24`) into
  `/opt/postureblog/.env` (root, mode 600).
* **IMDSv2 required, hop limit 1:** containers cannot reach the instance
  metadata service (and so cannot borrow the instance role).
* **Encrypted gp3 root volume**, deleted with the instance.
* **Account guard:** `allowed_account_id` — the provider refuses any other account.
* **Lab-only guard:** production/staging-style `environment` names are refused.
* **Pinned, validated inputs:** commit SHA and repo URL are validated (no
  shell metacharacters, no credentials in the URL); a new commit replaces the
  instance (`user_data_replace_on_change`).
* **Cost guard:** `cpu_credits = "standard"` (no surprise "unlimited" charges).

## Incident 2026-10-20: bootstrap died on a Windows checkout (fixed)

A deployment from a fresh Windows clone failed: no Docker, nothing on port 80,
health check 1 passed / 13 failed. Git for Windows' default `core.autocrlf=true`
checked `user_data.sh` out with CRLF, and bash on the instance stopped at line 15
(`set: pipefail: invalid option name` in `/var/log/cloud-init-output.log`;
`cloud-init status: error`; no `/var/log/postureblog-bootstrap.log`).
Fix: `main.tf` strips `` from `user_data.sh` and `compose.ec2.yaml`, a test
asserts the rendered user data has none, and `.gitattributes` checks `*.sh` and
these YAML files out with LF.

If a run ever shows the same symptoms, check over SSM:
`grep -n -i "invalid option\|command not found" /var/log/cloud-init-output.log`.

## Known limitations (accepted for a disposable lab)

| Limitation | Note |
|---|---|
| HTTP only, on a public IP | Session cookies travel unencrypted. HTTPS needs a domain + certificate (a load balancer/CloudFront or a reverse proxy with ACME) — out of scope by design |
| Intentionally vulnerable app | Any signed-in user can edit or delete any post (`backend/src/routes/posts.js` checks login, not ownership) — kept for the War Room exercises; restrict `http_ingress_cidrs` |
| Outbound traffic unrestricted | Needed for apt, GitHub, npm and Docker Hub during the build. tfsec 1.28 does not evaluate `aws_vpc_security_group_egress_rule`, so its "no problems" does not cover this |
| Images built on the instance at boot | First boot takes several minutes and depends on GitHub, npm, Docker Hub and Docker's apt repository being reachable |
| Single instance, no backups | The database is a Docker volume on the root disk; `destroy` deletes it |
| Local Terraform state | One operator; nothing secret in it. A shared/team setup would add an S3 backend |
| Default VPC | `subnet_id` selects another public subnet; accounts without a default VPC must set it |
| Reboot recovery | Verified locally (out-of-order restart recovers in seconds) and on a real EC2 reboot (2026-10-20) |

Scanner results (2026-10-20): **tfsec** 6 passed, 0 findings (see the egress
caveat above). **Checkov 3.3.29** (CI flags): **30 passed / 3 failed** (29 / 4 before the
`ebs_optimized` fix) — `CKV_AWS_88` public IP (by design), `CKV_AWS_126`
detailed monitoring (cost; accepted), `CKV_AWS_46` "secret in user data"
(false positive: the base64 value is `compose.ec2.yaml`, asserted by
`terraform test` to contain no password), `CKV_AWS_135` EBS-optimized (fixed).
**shellcheck**: `user_data.sh` clean; `healthcheck.sh` info-level only.

## Cost (approximate, us-east-1 on-demand list prices)

| Item | Price | 8-hour lab day | Left running 730 h (a month) |
|---|---|---|---|
| `t3.small` (2 vCPU, 2 GiB), standard CPU credits | ~$0.0208 / hour | ~$0.17 | ~$15.18 |
| gp3 root volume, 20 GB | ~$0.08 / GB-month | ~$0.01 | ~$1.60 |
| Public IPv4 address | ~$0.005 / hour | ~$0.04 | ~$3.65 |
| Data transfer out | first 100 GB / month free (AWS free tier for data transfer out) | ~$0 | ~$0 for lab traffic |
| Session Manager | no charge for sessions | — | — |
| **Total** | | **≈ $0.22** | **≈ $20.40** |

Assumptions: Linux on-demand, no free-tier instance hours (a `t3.micro` has
1 GiB and is too small to build the images reliably), one instance, 20 GB.
Check the AWS Pricing Calculator for your region. Destroy it the same day.

## Local validation (no AWS)

```bash
cd deploy/aws-ec2
terraform init -backend=false     # local providers only; creates nothing in AWS
terraform fmt -check
terraform validate
terraform test                    # 12 runs, mocked AWS provider
```

Results 2026-10-20 — see [Evidence](#evidence-2026-10-20).

## Plan and deploy (needs approval)

**Blocked:** no approved AWS profile is configured yet. When it is (an IAM
Identity Center profile — never paste keys anywhere):

```bash
export AWS_PROFILE=<approved-lab-profile>
aws sts get-caller-identity                      # read-only: confirm the account BEFORE anything else
export TF_VAR_allowed_account_id=<that 12-digit account ID>
cd deploy/aws-ec2
cp terraform.tfvars.example terraform.tfvars     # set owner and http_ingress_cidrs
terraform init                                   # local state; no bucket, no AWS resources
terraform validate
terraform plan -out=tfplan                       # read-only AWS calls (AMI parameter, default VPC/subnets, identity)
terraform show tfplan                            # REVIEW
sha256sum tfplan
```

Expected plan with the defaults and one HTTP CIDR (counted from the offline
plan): **7 to add, 0 to change, 0 to destroy** — `aws_instance.app`,
`aws_security_group.app`, one `aws_vpc_security_group_ingress_rule.http`,
`aws_vpc_security_group_egress_rule.all`, `aws_iam_role.ssm`,
`aws_iam_role_policy_attachment.ssm`, `aws_iam_instance_profile.ssm` (+1 per
extra HTTP or SSH CIDR). Review: only port 80 (and 22 if requested) inbound,
the CIDRs are the approved ones, `http_tokens = "required"`,
`encrypted = true`, the instance type and region are the approved ones.

Only after explicit authorization of that reviewed plan:

```bash
terraform apply tfplan
WAIT_SECONDS=900 bash healthcheck.sh             # 18 checks through http://<public-ip>, then the printed MANUAL browser step
```

Operator access and logs (no SSH needed) — full Windows walkthrough, checks
and troubleshooting in [SSM-ACCESS.md](SSM-ACCESS.md):

```bash
aws ssm start-session --target "$(terraform output -raw instance_id)"
sudo tail -n 50 /var/log/postureblog-bootstrap.log
sudo docker compose -p postureblog ps
```

IAM the operator needs: [`iam/operator-policy.json`](iam/operator-policy.json)
(create it as a **customer-managed** policy — it is larger than the 2,048-character
inline-policy limit). Derived from the 7 planned resources, their refresh and
destroy calls, and the post-deploy inspection: read-only EC2 `Describe*` in
us-east-1; `RunInstances` / `CreateSecurityGroup` / `CreateTags` in us-east-1;
change and delete **only resources tagged `Stack=postureblog-ec2`**; IAM limited to
`role/postureblog-ec2-*` and `instance-profile/postureblog-ec2-*`, may attach
**only** `AmazonSSMManagedInstanceCore`, may pass the role **only** to EC2;
`ssm:GetParameter` on the one Canonical AMI parameter; SSM `SendCommand` /
`StartSession` only on instances tagged `Stack=postureblog-ec2`. No `iam:*`,
`ec2:*`, user/access-key/policy creation, or `AdministratorAccess`.

## Teardown (destructive — needs approval; do not run without it)

```bash
cd deploy/aws-ec2
terraform plan -destroy -out=destroy.tfplan && terraform show destroy.tfplan   # review: 7 to destroy, nothing else
terraform apply destroy.tfplan
aws ec2 describe-instances --filters Name=tag:Stack,Values=postureblog-ec2 Name=tag:Owner,Values=<owner> \
  --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output table      # expect: none, or terminated
```

The database volume is deleted with the instance (`delete_on_termination`).
This state file only knows this stack, so it cannot touch any other.

### Second real run — 2026-10-20, frontend verified in a browser on EC2

| Step | Result |
|---|---|
| Fresh plan / apply (16:13 UTC) | 7 to add → 7 added; `i-<instance-id>`, `http://<public-ip>` |
| Bootstrap | HEALTHY 16:19:12 UTC (Docker 29.9.1, Compose v5.6.0, commit `73922b03…`) |
| `healthcheck.sh` (18 checks) against the **public EC2 URL** | **18 passed, 0 failed** (JS 242,897 B `application/javascript`, CSS 12,673 B `text/css`, relative `/api`, full auth + post flow) |
| Ports from the internet | 80 open; 443, 22, 5000, 5432, 55900, 8080 closed/filtered |
| **Real browser on the EC2 URL** (built-in Chromium pane, fresh tab) | home page rendered (header, hero, posts area with a live post, Sign in); `/login` form rendered; network `/`, JS, CSS, `/api/posts` 200 and `/api/auth/me` 401 (expected, not signed in); no JavaScript errors |
| User's own Chrome | first attempt `ERR_TIMED_OUT` — reproduced as `https://<public-ip>` timing out (443 is closed by design) while `http://` answered in 0.34 s; after loading `http://`, the user confirmed the frontend; nginx logged 8 requests from that Chrome |
| Destroy (16:24 UTC, reviewed destroy plan) | 7 destroyed; instance terminated, SG / rules / role / profile NotFound, 0 volumes, EIPs, ENIs, snapshots |

## Frontend verification — what each check proves

| Layer | Proves | Does not prove |
|---|---|---|
| `healthcheck.sh` (18 checks, 2026-10-20 version) | HTML shell + title; every referenced `/assets` JS and CSS bundle returns 200 with the right MIME type and size; a missing asset is **not** served as JavaScript; the bundle's API base is the relative `/api` with no `localhost`/`:5000` target; `/api` routes work through the same public origin | That a browser executed the JavaScript and rendered the page |
| **Manual browser step** (printed by the script) | The page renders: "Welcome to PostureSec", Sign in, `/login` form; DevTools shows bundles 200 and only the expected 401 from `/api/auth/me` | — |

Why MIME matters here: `frontend/nginx.conf` uses `try_files $uri $uri/ /index.html`,
so a missing `/assets/*.js` returns **200 `text/html`** (the SPA shell). A status-only
check passes; a browser refuses to run HTML as a module script and shows a blank
page. Demonstrated locally on 2026-10-20 by deleting the bundle in the test
container: the old checks' inputs were unchanged (`GET /` 200, `#root` present),
the new check failed on the bundle (`200 text/html 911 B`) and on the `/api` base,
exit 1; a cache-bypassing browser fetch received `<!DOCTYPE html>` for the JS URL.

Use `http://` explicitly: this lab has no HTTPS (port 443 is closed). Browsers in
HTTPS-only / "always use secure connections" mode try `https://<ip>` and fail.

## Evidence (2026-10-20)

| Check | Result |
|---|---|
| `docker compose config` on the unchanged `docker-compose.yml` | valid (`db`, `backend`, `frontend`) |
| Merged config with `compose.ec2.yaml` | valid; only host port 80 published; demo password absent; **fails closed** without `POSTGRES_PASSWORD` |
| All three containers built and run locally with the EC2 override (unique test names, `127.0.0.1:18080`) | db healthy; `healthcheck.sh` **11 passed, 0 failed** |
| Same local stack, re-run 2026-10-20 after the frontend report | `healthcheck.sh` (18 checks) **18 passed, 0 failed**; **real browser** (built-in Chromium pane): home page and `/login` rendered; network: `/`, JS, CSS, `/api/posts` 200, `/api/auth/me` 401 (expected, not signed in); no other console errors |
| Negative test: bundle deleted in the local frontend container | new check **16 passed, 2 failed, exit 1** (bundle served as `text/html`; no `/api` base) — the old 11-check version would have passed |
| Restart policy / published ports | all three `unless-stopped`; db and backend publish nothing |
| Out-of-order restart (backend before db, as after a reboot) | backend restarts on its own, healthy ~6 s after db; data persisted; health 11/0 again |
| `user_data.sh` run twice in a disposable `ubuntu:24.04` container (apt/docker/systemctl/gpg stubbed, real `git` from GitHub) | **13/13**: Docker installed on run 1 and skipped on run 2, Docker repo for `noble` signed by `docker.gpg`, `ubuntu` in the `docker` group, pinned commit deployed, override byte-identical, `.env` 600 with a 48-hex password kept across runs, password in no log, Compose invoked with base + override + `.env`, Docker enabled at boot. (An earlier 9/9 run had a harness gap — the stub reported Docker as already installed, so the install branch was not exercised; fixed.) The real apt/Docker installation itself runs only on EC2 |
| `terraform fmt -check`, `init -backend=false`, `validate` | pass |
| `terraform test` (mocked AWS) | **12 passed, 0 failed**; mutations (IMDS hop limit 2, unencrypted volume) each caught |
| Backend Jest suite (disposable Postgres) | 22 passed, 0 failed |
| tfsec / Checkov / shellcheck | see "Scanner results" above |
| **Real AWS lifecycle (2026-10-20, us-east-1, user-authorized)** | see below |

### Real AWS run — 2026-10-20 (authorized lab lifecycle)

Run with the configured lab identity in a dedicated, disposable lab account.
Use an identity limited to `iam/operator-policy.json` for future runs.

| Step | Result |
|---|---|
| Fresh plan | 7 to add, 0 change, 0 destroy — matched the reviewed scope exactly |
| Apply (saved plan, 15:42 UTC) | 7 added; `t3.small` in us-east-1d, encrypted 20 GB gp3, IMDSv2 required |
| Bootstrap | HEALTHY ~3.5 min after boot (Docker 29.9.1, Compose v5.6.0, commit `73922b03…`) |
| `healthcheck.sh` (11-check version) via the public IP | 11 passed, 0 failed — **but** that version checked only the HTML shell (`<div id="root">`) and the API. It did **not** fetch the JS/CSS bundles, and **no browser** loaded the page on EC2. Frontend rendering on EC2 is therefore **not proven**; see "Frontend verification" |
| Containers | db healthy, backend, frontend up; all `unless-stopped`; only host port 80 published |
| External port probe | 80 open; 22, 5000, 5432, 55900, 8080 closed/filtered |
| Secrets | `.env` 600 root:root; password in no log |
| Session Manager | instance Online; Run Command and a Session Manager session both worked |
| Real reboot | containers back automatically, data kept, health 11/0 |
| Destroy (saved destroy plan, 15:53 UTC) | 7 destroyed; direct lookups: instance terminated, volume / SG / rules / role / profile NotFound; 0 volumes, EIPs, ENIs, snapshots left |

The app was reachable only from 15:46:57 UTC (bootstrap HEALTHY) to 15:53:28 UTC
(terminated — EC2 `StateTransitionReason`, CloudTrail `TerminateInstances`), minus
~20 s for the 15:49:22 reboot. A visit outside that window finds nothing.

Issue found and fixed: `healthcheck.sh` lost its cookie jar on Windows Git Bash
when `MSYS_NO_PATHCONV=1` was set (2 false failures); it now passes curl a native path.
