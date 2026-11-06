# ==============================================================
# PostureSec War Room — dedicated EC2 host (INC-005 hosted lab)
# Reuses the account's default VPC/subnets/IGW for public access.
# ==============================================================

# ---- Networking: reuse the default VPC and its default public subnets ----
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# ---- AMI: latest Ubuntu 22.04 LTS (Canonical), Docker-compatible ----
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---- Dedicated security group ----
# Rules are standalone resources (not inline blocks) so the INC-005 public
# HTTP rule is one addressable resource: when the SDK revokes it, a plan shows
# EXACTLY ONE resource to create (aws_vpc_security_group_ingress_rule.http),
# which the plan guard binds to. No DB ports; SSH never open to the world.
resource "aws_security_group" "warroom" {
  name        = "${var.name_prefix}-sg"
  description = "PostureSec War Room host: public HTTP, optional restricted SSH"
  vpc_id      = data.aws_vpc.default.id

  tags = {
    Name               = "${var.name_prefix}-sg"
    "warroom:incident" = "INC-005"
    "warroom:managed"  = "true"
  }
}

# The drift target: public TCP/80. Revoked by the incident, restored by the
# guarded remediation plan.
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.warroom.id
  description       = "Public HTTP for lab testers (INC-005 drift target)"
  cidr_ipv4         = var.http_ingress_cidr
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"

  tags = { Name = "${var.name_prefix}-http" }
}

# SSH only if a restricted CIDR is provided (never 0.0.0.0/0; enforced by var validation).
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  count             = var.ssh_ingress_cidr == "" ? 0 : 1
  security_group_id = aws_security_group.warroom.id
  description       = "Restricted SSH"
  cidr_ipv4         = var.ssh_ingress_cidr
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"

  tags = { Name = "${var.name_prefix}-ssh" }
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.warroom.id
  description       = "All outbound (package/image pulls, updates)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"

  tags = { Name = "${var.name_prefix}-egress" }
}

# ---- EC2 instance ----
resource "aws_instance" "warroom" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = element(tolist(data.aws_subnets.default.ids), 0)
  vpc_security_group_ids      = [aws_security_group.warroom.id]
  associate_public_ip_address = true
  key_name                    = var.key_name

  # Least-privilege instance profile (iam.tf). The backend reads temporary
  # credentials from it via the default AWS credential chain — no static keys.
  iam_instance_profile = aws_iam_instance_profile.warroom.name

  # IMDSv2 required: block the legacy token-less metadata endpoint (SSRF hardening).
  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 2
  }

  # The dedicated SG id is known here (the instance depends on the SG), so the
  # backend learns EXACTLY which SG it may act on — no discovery guesswork.
  user_data = templatefile("${path.module}/user-data.sh", {
    app_bucket       = aws_s3_bucket.app.id
    app_key          = aws_s3_object.app_bundle.key
    app_compose_file = var.app_compose_file
    warroom_sg_id    = aws_security_group.warroom.id
    warroom_region   = var.aws_region
    warroom_account  = data.aws_caller_identity.current.account_id
    instructor_token = var.instructor_token
    incident_delay   = var.incident_delay_seconds
    http_cidr        = var.http_ingress_cidr
    db_password      = var.db_password
  })

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.name_prefix}-host"
  }
}
