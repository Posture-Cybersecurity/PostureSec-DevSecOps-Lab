# =============================================================================
# INC-004 War Room lab: the class's OWN EC2 stack (deploy/aws-ec2), deployed as a
# separate, dedicated instance for the War Room.
#
# Isolation:
#   * its own root module and its own LOCAL state (warroom/inc004/terraform/
#     terraform.tfstate, git-ignored), the same convention deploy/aws-ec2 uses;
#     nothing here reads or writes any other state (in particular never the
#     EKS stack's S3 backend);
#   * its own names: environment "warroom", owner <squad_id> -> every resource is
#     "postureblog-ec2-warroom-<squad_id>*" (ONE lab per squad, shared by its members);
#   * its own tags: WarRoom=INC-004, WarRoomSquad=<squad>, CleanupEligible=true (on top of the stack's
#     Project/Stack/Environment/Owner/ManagedBy);
#   * the stack's provider refuses any account but var.expected_account_id.
#
# The incident is ONE input: http_ingress_cidrs.
#   baseline  TF_VAR_http_ingress_cidrs = ["<operator /32>"]        (lab.sh sets it)
#   fault     -var-file=env/fault.tfvars: ["198.51.100.0/24"]       (CHG-1042, "the new VPN")
#   recover   lab.sh adds the operator /32 back alongside the VPN range
#
# INC-005 (console hotfix drift) changes NO input: the platform deletes the squad's real
# port-80 rule in AWS, and the unchanged configuration's next plan is exactly "1 to add".
# =============================================================================
terraform {
  required_version = ">= 1.7.0"
}

variable "expected_account_id" {
  description = "The lab account (supplied at run time by lab.sh; never committed)"
  type        = string
}

variable "squad_id" {
  description = "Which squad this lab belongs to. ONE lab per squad: becomes the resource names (postureblog-ec2-warroom-<squad>*) and the WarRoomSquad tag."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,14}$", var.squad_id))
    error_message = "squad_id: 2-15 lowercase letters, digits, hyphens."
  }
}

variable "use_precreated_profile" {
  description = "Squad labs: use the instance profile the instructor pre-created for this squad (postureblog-ec2-warroom-<squad>-ssm), so the squad identity needs no IAM write. false = the stack creates it (operator use)."
  type        = bool
  default     = true
}

variable "http_ingress_cidrs" {
  description = "Who may reach port 80. The War Room incident changes only this."
  type        = list(string)
}

# INC-005 (console hotfix drift) runs on this same lab: it changes no input at all, only AWS.
variable "warroom_incident" {
  description = "Which War Room incident this lab serves (its WarRoom tag; the plan guard checks it)."
  type        = string
  default     = "INC-004"
  validation {
    condition     = contains(["INC-004", "INC-005"], var.warroom_incident)
    error_message = "warroom_incident: INC-004 or INC-005."
  }
}

variable "ami_id" {
  description = "Pin the AMI (INC-005 pins it at deploy, so a newly published Ubuntu image can never show up as a replacement in the squad's plan). null = the stack's current Ubuntu lookup."
  type        = string
  default     = null
  validation {
    condition     = var.ami_id == null || can(regex("^ami-[0-9a-f]{8,17}$", var.ami_id))
    error_message = "ami_id: null or ami-<hex>."
  }
}

module "lab" {
  source = "../../../deploy/aws-ec2"

  ami_id                = var.ami_id
  allowed_account_id    = var.expected_account_id
  aws_region            = "us-east-1"
  environment           = "warroom"
  owner                 = var.squad_id
  instance_type         = "t3.small"
  root_volume_gb        = 20
  http_ingress_cidrs    = var.http_ingress_cidrs
  enable_ssm            = true # evidence via Session Manager; no SSH, no key pair
  instance_profile_name = var.use_precreated_profile ? "postureblog-ec2-warroom-${var.squad_id}-ssm" : null
  extra_tags = {
    WarRoom         = var.warroom_incident
    WarRoomSquad    = var.squad_id
    CleanupEligible = "true"
  }
}

output "app_url" {
  value = module.lab.app_url
}

output "instance_id" {
  value = module.lab.instance_id
}

output "security_group_id" {
  value = module.lab.security_group_id
}

output "ssm_session_command" {
  value = module.lab.ssm_session_command
}
