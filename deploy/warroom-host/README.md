# War Room host — dedicated AWS EC2 (INC-005 hosted lab)

Workstream 1: the EC2 host and networking Terraform for the hosted War Room
lab. Scope is **host + networking only** — no IAM, no AWS SDK, no backend
authorization code (those are later workstreams).

## Directory

`deploy/warroom-host/` — self-contained Terraform root.

| File | Purpose |
|------|---------|
| `provider.tf` | Terraform + AWS provider, `default_tags`, local state (S3 backend commented) |
| `variables.tf` | Inputs and validation |
| `main.tf` | Default-VPC data sources, Ubuntu AMI, security group, EC2 instance |
| `outputs.tf` | Instance ID, public IP/DNS, application URL, SG ID |
| `user-data.sh` | Cloud-init: installs Docker + Compose, optionally runs the stack |
| `terraform.tfvars.example` | Copy to `terraform.tfvars` |

## AWS account and region

- Region: `aws_region` variable (default `us-east-1`).
- Account/credentials: standard AWS provider resolution (env vars, shared
  config, or instance profile). No credentials are stored in these files.
- Verify before applying: `aws sts get-caller-identity`.

## Deploy (standard Terraform workflow)

```bash
cd deploy/warroom-host

cp terraform.tfvars.example terraform.tfvars   # then edit
terraform init
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

No Bash wrapper and no `-auto-approve` — review the plan before applying.

## EC2 instance

- Latest Ubuntu 22.04 LTS (Canonical), `instance_type` (default `t3.small`).
- Default VPC + a default public subnet (reused, not rebuilt), public IP assigned.
- Root EBS: `gp3`, `root_volume_size` GiB (default 20), encrypted.
- `iam_instance_profile` variable is the clean seam for the IAM workstream.

## Security group exposure

| Port | Source | Notes |
|------|--------|-------|
| 80/tcp | `http_ingress_cidr` (default `0.0.0.0/0`) | Public HTTP for lab testers |
| 22/tcp | `ssh_ingress_cidr` | Only if set; `0.0.0.0/0` rejected by validation |
| all egress | `0.0.0.0/0` | Package/image pulls |

PostgreSQL (5432) and the backend (5000) are **not** in the security group —
they stay internal to the host/Compose network.

## Bootstrap behaviour

`user-data.sh` installs Docker Engine + the Compose plugin from Docker's
official repo. If `app_repo_url` is set it clones the repo and runs
`docker compose -f <app_compose_file> up -d --build`, which publishes the
frontend on port 80 (per the repo `docker-compose.yml`). Left empty, the host
is Docker-ready for a later deploy step.

The repo's `deploy/setup.sh` (Node/PostgreSQL/Nginx/PM2) is intentionally not
reused: this host runs the Dockerized Compose stack.

## Outputs / access

`public_ip`, `public_dns`, `application_url` (`http://<public_ip>`),
`instance_id`, `security_group_id`, `region`. Open the `application_url` in a
browser once the stack is up.

## Next workstream dependency

Attach an IAM instance profile via `iam_instance_profile` (created in the IAM
workstream) — no change to the EC2 resource is required.
