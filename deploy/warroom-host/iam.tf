# ==============================================================
# Least-privilege EC2 instance role for the INC-005 backend.
# The backend uses the default AWS credential chain -> the EC2
# instance profile's temporary credentials. No static keys.
#
# Permissions are the minimum the implemented SDK operations need:
#   - Describe* (read): no resource-level support in EC2, so "*", read-only.
#   - Authorize/Revoke ingress: scoped to the ONE dedicated lab SG by ARN.
# ==============================================================

data "aws_caller_identity" "current" {}

locals {
  sg_arn = "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:security-group/${aws_security_group.warroom.id}"
}

resource "aws_iam_role" "warroom" {
  name = "${var.name_prefix}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "${var.name_prefix}-ec2-role" }
}

# Read-only discovery/verification. EC2 Describe* actions do not support
# resource-level permissions, so Resource must be "*"; they are read-only.
data "aws_iam_policy_document" "warroom_sg" {
  statement {
    sid    = "DescribeSecurityGroups"
    effect = "Allow"
    actions = [
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSecurityGroupRules",
    ]
    resources = ["*"]
  }

  # Mutating ingress actions, scoped to the dedicated lab security group only.
  statement {
    sid    = "ModifyDedicatedIngress"
    effect = "Allow"
    actions = [
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupIngress",
    ]
    resources = [local.sg_arn]
  }

  # Read ONLY the app bundle object, so user-data can pull the source.
  statement {
    sid       = "ReadAppBundle"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.app.arn}/${aws_s3_object.app_bundle.key}"]
  }
}

# Session Manager access for on-host verification/ops (no SSH needed). This is
# operational access, separate from the least-privilege SG permissions above.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.warroom.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "warroom_sg" {
  name   = "${var.name_prefix}-sg-control"
  role   = aws_iam_role.warroom.id
  policy = data.aws_iam_policy_document.warroom_sg.json
}

resource "aws_iam_instance_profile" "warroom" {
  name = "${var.name_prefix}-instance-profile"
  role = aws_iam_role.warroom.name
}
