# ==============================================================
# PostureBlogging on ONE EC2 instance with the repo's own Docker Compose.
#
# Ubuntu 24.04 + Docker + the Compose plugin; cloud-init clones the app at a
# pinned commit and runs docker-compose.yml (+ compose.ec2.yaml). One security
# group: port 80 from approved CIDRs only, optional SSH from a narrow CIDR,
# nothing else inbound. PostgreSQL never leaves the Compose network.
#
# Independent of every other stack: own directory, own (local) state, own
# names and tags. DISPOSABLE LAB: plain HTTP on a public IP, not production.
# ==============================================================

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
  # No backend block: state is LOCAL (deploy/aws-ec2/terraform.tfstate,
  # git-ignored). It holds no secret — the DB password is generated on the
  # instance. Nothing else uses this state file.
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.allowed_account_id] # any other account -> provider error at start-up

  # The War Room platform's progress tags (set out of band) are not configuration drift.
  ignore_tags {
    keys = ["WarRoomPhase", "WarRoomScore"]
  }

  default_tags {
    # extra_tags first: the stack's own ownership tags always win.
    tags = merge(var.extra_tags, {
      Project     = "PostureBlogging"
      Stack       = "postureblog-ec2"
      Environment = var.environment
      Owner       = var.owner
      ManagedBy   = "Terraform"
    })
  }
}

locals {
  name = "postureblog-ec2-${var.environment}-${var.owner}"

  # A pre-created instance profile (e.g. one per War Room squad, made by the instructor)
  # replaces the role this stack would otherwise create, so the deployer needs no IAM write.
  create_ssm_role = var.enable_ssm && var.instance_profile_name == null

  # Header + static script: user_data.sh stays plain bash (no template
  # escaping). Values are validated in variables.tf, so quoting is safe.
  # CRs are stripped: a Windows checkout (core.autocrlf=true) gives CRLF files,
  # and bash on the instance then dies at `set -euo pipefail\r`.
  user_data = join("\n", [
    "#!/bin/bash",
    "REPO_URL='${var.app_repo_url}'",
    "GIT_REF='${var.app_git_ref}'",
    "COMPOSE_OVERRIDE_B64='${base64encode(replace(file("${path.module}/compose.ec2.yaml"), "\r", ""))}'",
    replace(file("${path.module}/user_data.sh"), "\r", ""),
  ])
}

# ---- Image and network (read-only lookups) ----------------------------------

data "aws_ssm_parameter" "ubuntu" {
  count = var.ami_id == null ? 1 : 0
  name  = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

data "aws_vpc" "default" {
  count   = var.subnet_id == null ? 1 : 0
  default = true
}

data "aws_subnets" "default" {
  count = var.subnet_id == null ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default[0].id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

data "aws_subnet" "selected" {
  id = var.subnet_id != null ? var.subnet_id : sort(data.aws_subnets.default[0].ids)[0]
}

# ---- Security group: the only way in ----------------------------------------

resource "aws_security_group" "app" {
  name        = local.name
  description = "PostureBlogging lab: HTTP 80 from approved CIDRs; optional narrow SSH; nothing else inbound"
  vpc_id      = data.aws_subnet.selected.vpc_id
  tags        = { Name = local.name }

  lifecycle {
    precondition {
      condition     = var.allow_http_from_anywhere || !contains(var.http_ingress_cidrs, "0.0.0.0/0")
      error_message = "http_ingress_cidrs contains 0.0.0.0/0. This app is intentionally vulnerable — use the classroom's CIDR, or set allow_http_from_anywhere = true deliberately."
    }
    precondition {
      condition     = length(var.ssh_ingress_cidrs) == 0 || var.key_name != null
      error_message = "ssh_ingress_cidrs needs key_name (an existing EC2 key pair). Or leave SSH off and use Session Manager."
    }
  }
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  for_each = toset(var.http_ingress_cidrs)

  security_group_id = aws_security_group.app.id
  description       = "HTTP to the frontend container (nginx serves the app and proxies /api)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  for_each = toset(var.ssh_ingress_cidrs)

  security_group_id = aws_security_group.app.id
  description       = "SSH from an approved operator address"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = each.value
}

# Outbound: apt (Ubuntu + Docker repositories), GitHub, npm and Docker Hub
# during the image build, and AWS SSM. Narrowing it needs a proxy/allow-list.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound for packages, source, images and SSM"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# ---- Optional: Session Manager (shell with no open port) --------------------

resource "aws_iam_role" "ssm" {
  count = local.create_ssm_role ? 1 : 0
  name  = "${local.name}-ssm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  count      = local.create_ssm_role ? 1 : 0
  role       = aws_iam_role.ssm[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ssm" {
  count = local.create_ssm_role ? 1 : 0
  name  = "${local.name}-ssm"
  role  = aws_iam_role.ssm[0].name
}

# ---- The instance -------------------------------------------------------------

resource "aws_instance" "app" {
  ami                         = var.ami_id != null ? var.ami_id : nonsensitive(data.aws_ssm_parameter.ubuntu[0].value)
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnet.selected.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  associate_public_ip_address = true
  ebs_optimized               = true # t3 is EBS-optimized by default; stated explicitly
  key_name                    = var.key_name
  iam_instance_profile        = var.instance_profile_name != null ? var.instance_profile_name : (local.create_ssm_role ? aws_iam_instance_profile.ssm[0].name : null)

  user_data                   = local.user_data
  user_data_replace_on_change = true # a new commit or config = a fresh instance, not drift

  # IMDSv2 only, one hop: containers on the Docker bridge cannot reach the
  # instance metadata service (and so cannot borrow the instance role).
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  # No surprise "unlimited" CPU-credit charges on a burstable instance.
  credit_specification {
    cpu_credits = "standard"
  }

  tags = { Name = local.name }
}
