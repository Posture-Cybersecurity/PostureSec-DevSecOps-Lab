# DSO-703 Checkov fixture — INTENTIONALLY INSECURE.
# This file is NEVER applied: it has no provider block, no backend, no
# credentials, and lives outside terraform/ so the app's iac-scan never reads
# it and `terraform apply` never targets it. It exists only to prove the
# Checkov gate fails on a known misconfiguration.
#
# Expected primary finding: CKV_AWS_24 (security group allows ingress from
# 0.0.0.0/0 to port 22). Expected checkov exit status: 1 (soft_fail=false).

resource "aws_security_group" "open_ssh" {
  # Skip the architecture-only "SG must be attached" check so this fixture fails
  # on exactly the intended rule-level finding (CKV_AWS_24), nothing else.
  #checkov:skip=CKV2_AWS_5:Standalone fixture SG — attachment is out of scope
  name        = "dso703-fixture-open-ssh"
  description = "Intentionally open SSH for Checkov gate testing"
  vpc_id      = "vpc-0000000000000000f"

  ingress {
    description = "SSH open to the world — the intended finding (CKV_AWS_24)"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Restricted egress to keep the finding set focused on ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}
