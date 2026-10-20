output "app_url" {
  description = "The application (plain HTTP on the public IP — disposable lab only)"
  value       = "http://${aws_instance.app.public_ip}"
}

output "instance_id" {
  value = aws_instance.app.id
}

output "public_ip" {
  value = aws_instance.app.public_ip
}

output "public_dns" {
  value = aws_instance.app.public_dns
}

output "instance_type" {
  value = aws_instance.app.instance_type
}

output "ami_id" {
  value = aws_instance.app.ami
}

output "security_group_id" {
  value = aws_security_group.app.id
}

output "deployed_git_ref" {
  value = var.app_git_ref
}

output "ssm_session_command" {
  description = "Shell on the instance without SSH (needs the Session Manager plugin)"
  value       = var.enable_ssm ? "aws ssm start-session --region ${var.aws_region} --target ${aws_instance.app.id}" : null
}

output "bootstrap_log" {
  description = "Where to look if the app does not come up"
  value       = "/var/log/postureblog-bootstrap.log (sudo tail -f on the instance)"
}
