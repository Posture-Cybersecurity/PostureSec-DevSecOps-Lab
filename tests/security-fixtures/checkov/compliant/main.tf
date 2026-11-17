# DSO-703 Checkov fixture — COMPLIANT CONTROL.
# Same resource type as checkov/insecure, but with no 0.0.0.0/0 exposure, so
# Checkov reports zero failed checks. Never applied (no provider/backend/creds).
#
# Expected finding: none. Expected checkov exit status: 0.

resource "aws_security_group" "restricted" {
  # CKV2_AWS_5 (SG must be attached to an ENI/instance) is an architecture/usage
  # check, not a rule-level security property. A standalone fixture SG is
  # unattached by design, so this check is out of scope for the IaC-gate test.
  #checkov:skip=CKV2_AWS_5:Standalone fixture SG — attachment is out of scope
  name        = "dso703-fixture-restricted"
  description = "Restricted security group — no world-open ingress"
  vpc_id      = "vpc-0000000000000000f"

  ingress {
    description = "HTTPS from the internal VPC range only"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    description = "HTTPS to the internal VPC range only"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}
