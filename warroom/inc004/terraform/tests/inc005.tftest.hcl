# Offline tests for INC-005 (console hotfix drift): the class's EC2 stack (deploy/aws-ec2) driven
# with EXACTLY what ../main.tf passes in the drift scenario (WarRoom=INC-005, AMI pinned at
# deploy). Mock AWS provider: no credentials, no API calls. (Like inc004.tftest.hcl, the runs
# target the stack module: its own provider block is what the mock replaces. A root-module run
# would configure the real provider instead — never do that here.)
#   cd warroom/inc004/terraform && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0fffffffffffffff0" }
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
  owner              = "alpha"
  instance_type      = "t3.small"
  root_volume_gb     = 20
  enable_ssm         = true
  extra_tags         = { WarRoom = "INC-005", WarRoomSquad = "alpha", CleanupEligible = "true" }
  http_ingress_cidrs = ["203.0.113.10/32"]
  ami_id             = "ami-0123456789abcdef0"
}

run "drift_lab_pins_its_ami_and_has_exactly_the_squad_rule" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  assert {
    condition     = aws_instance.app.ami == "ami-0123456789abcdef0" && length(data.aws_ssm_parameter.ubuntu) == 0
    error_message = "the pinned AMI is used and the moving 'current' Ubuntu lookup is not even read"
  }
  assert {
    condition     = toset(keys(aws_vpc_security_group_ingress_rule.http)) == toset(["203.0.113.10/32"])
    error_message = "exactly one port-80 rule: the squad's approved address (the rule the drift deletes)"
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.http["203.0.113.10/32"].from_port == 80 && aws_vpc_security_group_ingress_rule.http["203.0.113.10/32"].ip_protocol == "tcp"
    error_message = "the squad's rule is tcp/80"
  }
}

run "without_a_pin_the_stack_still_looks_up_ubuntu" {
  command = plan
  module {
    source = "../../../deploy/aws-ec2"
  }
  variables {
    ami_id = null
  }
  assert {
    condition     = length(data.aws_ssm_parameter.ubuntu) == 1 && aws_instance.app.ami == "ami-0fffffffffffffff0"
    error_message = "INC-004 / the class stack are unchanged: no pin = the current Ubuntu image"
  }
}
