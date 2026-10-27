# Offline tests for INC-004: the class's own EC2 stack (deploy/aws-ec2) driven
# with EXACTLY the War Room's inputs (keep in step with ../main.tf). Mock AWS
# provider: no credentials, no API calls.
#   cd warroom/inc004/terraform && terraform init -backend=false && terraform test
#
# They pin the War Room's isolation (names, tags) and the exact shape of the
# fault and the recovery.

mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_data "aws_vpc" {
    defaults = { id = "vpc-0123456789abcdef0" }
  }
  mock_data "aws_subnets" {
    defaults = { ids = ["subnet-0123456789abcdef0"] }
  }
  mock_data "aws_subnet" {
    defaults = { id = "subnet-0123456789abcdef0", vpc_id = "vpc-0123456789abcdef0" }
  }
}

variables {
  allowed_account_id = "111111111111"
  aws_region         = "us-east-1"
  environment        = "warroom"
  owner              = "inc004"
  instance_type      = "t3.small"
  root_volume_gb     = 20
  enable_ssm         = true
  extra_tags         = { WarRoom = "INC-004", CleanupEligible = "true" }
  http_ingress_cidrs = ["203.0.113.10/32"]
}

run "baseline_names_tags_and_one_users_rule" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.http)) == toset(["203.0.113.10/32"])
    error_message = "the baseline allows exactly the users' address on port 80"
  }
  assert {
    condition     = aws_security_group.app.name == "postureblog-ec2-warroom-inc004" && aws_instance.app.tags["Name"] == "postureblog-ec2-warroom-inc004"
    error_message = "War Room resources are named postureblog-ec2-warroom-inc004*"
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.ssh) == 0
    error_message = "the War Room lab opens no SSH port (Session Manager only)"
  }
  assert {
    condition     = aws_instance.app.metadata_options[0].http_tokens == "required" && aws_instance.app.root_block_device[0].encrypted
    error_message = "the stack's IMDSv2 and encryption controls are unchanged"
  }
}

run "fault_leaves_only_the_vpn_range" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  variables {
    http_ingress_cidrs = ["198.51.100.0/24"]
  }
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.http)) == toset(["198.51.100.0/24"])
    error_message = "the fault leaves only the VPN range on port 80"
  }
}

run "recovery_keeps_the_vpn_and_restores_the_users" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  variables {
    http_ingress_cidrs = ["203.0.113.10/32", "198.51.100.0/24"]
  }
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.http)) == toset(["203.0.113.10/32", "198.51.100.0/24"])
    error_message = "the recovery allows both"
  }
}

run "the_stack_still_refuses_the_whole_internet" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  variables {
    http_ingress_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [aws_security_group.app]
}

run "rejects_bad_extra_tags" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  variables {
    extra_tags = { "bad key!" = "x" }
  }
  expect_failures = [var.extra_tags]
}

run "squad_lab_uses_the_precreated_profile_and_creates_no_iam" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  variables {
    owner                 = "alpha"
    instance_profile_name = "postureblog-ec2-warroom-alpha-ssm"
    extra_tags            = { WarRoom = "INC-004", WarRoomSquad = "alpha", CleanupEligible = "true" }
  }
  assert {
    condition     = length(aws_iam_role.ssm) == 0 && length(aws_iam_instance_profile.ssm) == 0 && length(aws_iam_role_policy_attachment.ssm) == 0
    error_message = "a squad lab creates no IAM resources: the instructor pre-creates the profile"
  }
  assert {
    condition     = aws_instance.app.iam_instance_profile == "postureblog-ec2-warroom-alpha-ssm" && aws_security_group.app.name == "postureblog-ec2-warroom-alpha"
    error_message = "the squad's instance uses the squad's own profile and names"
  }
}

run "rejects_a_profile_outside_the_lab_namespace" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  variables {
    instance_profile_name = "AdminProfile"
  }
  expect_failures = [var.instance_profile_name]
}
