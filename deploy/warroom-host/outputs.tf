output "instance_id" {
  description = "EC2 instance ID of the War Room host"
  value       = aws_instance.warroom.id
}

output "public_ip" {
  description = "Public IP of the War Room host"
  value       = aws_instance.warroom.public_ip
}

output "public_dns" {
  description = "Public DNS name of the War Room host"
  value       = aws_instance.warroom.public_dns
}

output "application_url" {
  description = "HTTP URL for the hosted War Room lab"
  value       = "http://${aws_instance.warroom.public_ip}"
}

output "security_group_id" {
  description = "ID of the dedicated security group"
  value       = aws_security_group.warroom.id
}

output "region" {
  description = "AWS region"
  value       = var.aws_region
}

output "account_id" {
  description = "AWS account ID the host runs in"
  value       = data.aws_caller_identity.current.account_id
}

output "iam_role_name" {
  description = "Least-privilege EC2 role name"
  value       = aws_iam_role.warroom.name
}

output "instance_profile_name" {
  description = "Instance profile attached to the host"
  value       = aws_iam_instance_profile.warroom.name
}

# Env block for the backend's INC-005 SDK module — it only ever operates on
# this dedicated SG, in this account/region. Consume via `terraform output`.
output "warroom_env" {
  description = "Backend INC-005 environment (SG identity the SDK is scoped to)"
  value = {
    WARROOM_SG_ID        = aws_security_group.warroom.id
    WARROOM_AWS_REGION   = var.aws_region
    WARROOM_AWS_ACCOUNT  = data.aws_caller_identity.current.account_id
    WARROOM_SG_HTTP_PORT = 80
    WARROOM_SG_HTTP_CIDR = var.http_ingress_cidr
  }
}
