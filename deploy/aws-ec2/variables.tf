variable "allowed_account_id" {
  description = "The ONE approved lab AWS account ID. The provider refuses to run against any other account. Not a secret; pass it with TF_VAR_allowed_account_id"
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.allowed_account_id))
    error_message = "allowed_account_id must be a 12-digit AWS account ID."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "owner" {
  description = "Who this lab instance belongs to (lowercase GitHub username) — Owner tag and part of the name"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,20}$", var.owner))
    error_message = "owner must be 2-21 lowercase letters, digits or hyphens."
  }
}

variable "environment" {
  description = "Environment label. Disposable training lab only"
  type        = string
  default     = "lab"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,11}$", var.environment)) && !can(regex("prod|stag|live|uat", var.environment))
    error_message = "environment must be 2-12 lowercase characters and not a production/staging name: this stack is a disposable lab."
  }
}

variable "instance_type" {
  description = "EC2 instance type (x86_64; the image builds need ~2 GB RAM)"
  type        = string
  default     = "t3.small"

  validation {
    condition     = can(regex("^(t3|t3a|m5|m6i|c5|c6i)\\.", var.instance_type))
    error_message = "Use an x86_64 type (t3, t3a, m5, m6i, c5, c6i): the AMI is amd64."
  }
}

variable "root_volume_gb" {
  description = "Encrypted gp3 root volume size (Docker images + PostgreSQL data)"
  type        = number
  default     = 20

  validation {
    condition     = var.root_volume_gb >= 12 && var.root_volume_gb <= 100
    error_message = "root_volume_gb must be between 12 and 100."
  }
}

variable "subnet_id" {
  description = "Public subnet for the instance. null = the first subnet of the account's default VPC"
  type        = string
  default     = null
}

variable "ami_id" {
  description = "Override the AMI. null = the current Canonical Ubuntu 24.04 LTS amd64 image (from AWS's public SSM parameter)"
  type        = string
  default     = null
}

variable "http_ingress_cidrs" {
  description = "IPv4 CIDRs allowed to reach the app on port 80 — e.g. the classroom's egress IP as x.x.x.x/32. Required. 0.0.0.0/0 is refused unless allow_http_from_anywhere = true"
  type        = list(string)

  validation {
    condition     = length(var.http_ingress_cidrs) >= 1 && alltrue([for c in var.http_ingress_cidrs : can(cidrnetmask(c)) && cidrhost(c, 0) == split("/", c)[0]])
    error_message = "Supply at least one canonical IPv4 CIDR (a single address is x.x.x.x/32)."
  }
}

variable "allow_http_from_anywhere" {
  description = "Explicit opt-in to open port 80 to 0.0.0.0/0. The app is an intentionally vulnerable training app: keep it false unless the lab must be public"
  type        = bool
  default     = false
}

variable "ssh_ingress_cidrs" {
  description = "Narrow public IPv4 CIDRs (/24 or smaller) for SSH. Empty (default) = no SSH rule at all; use SSM Session Manager instead"
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for c in var.ssh_ingress_cidrs :
      can(cidrnetmask(c)) && cidrhost(c, 0) == split("/", c)[0] && tonumber(split("/", c)[1]) >= 24
    ])
    error_message = "Each SSH CIDR must be a canonical IPv4 CIDR no wider than /24. 0.0.0.0/0 is never allowed."
  }
  validation {
    condition     = length(var.ssh_ingress_cidrs) <= 3
    error_message = "At most 3 SSH CIDRs."
  }
}

variable "key_name" {
  description = "Existing EC2 key pair name, required only if ssh_ingress_cidrs is set"
  type        = string
  default     = null
}

variable "enable_ssm" {
  description = "Attach an instance role with AmazonSSMManagedInstanceCore so operators get a shell (Session Manager) with NO inbound port"
  type        = bool
  default     = true
}

variable "app_repo_url" {
  description = "Public https git URL of the application (no credentials in it)"
  type        = string
  default     = "https://github.com/Posture-Cybersecurity/PostureSec-DevSecOps-Lab.git"

  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+/[A-Za-z0-9._/-]+\\.git$", var.app_repo_url))
    error_message = "app_repo_url must be an https URL ending in .git, with no user, token or special characters."
  }
}

variable "app_git_ref" {
  description = "What to deploy: a full 40-character commit SHA (default: lab/dev 73922b0, tested 2026-10-20) or a branch/tag name"
  type        = string
  default     = "73922b03c6b746f1b39ef10d12ccca2cf50bfbd5"

  validation {
    condition     = can(regex("^([0-9a-f]{40}|[A-Za-z0-9][A-Za-z0-9._/-]{0,99})$", var.app_git_ref))
    error_message = "app_git_ref must be a full commit SHA or a plain branch/tag name."
  }
}

variable "extra_tags" {
  description = "Additional tags for every resource (e.g. a War Room marker). Cannot override the stack's own Project/Stack/Environment/Owner/ManagedBy tags. Default: none"
  type        = map(string)
  default     = {}
  validation {
    condition     = length(var.extra_tags) <= 10 && alltrue([for k, v in var.extra_tags : can(regex("^[A-Za-z][A-Za-z0-9_.:/=+@-]{0,62}$", k)) && length(v) <= 128])
    error_message = "extra_tags: at most 10 tags, keys 1-63 safe characters starting with a letter, values up to 128 characters."
  }
}

variable "instance_profile_name" {
  description = "Use this EXISTING instance profile instead of creating the SSM role and profile (e.g. one pre-created per War Room squad), so whoever deploys needs no IAM write permission. null (default) = create them when enable_ssm is true"
  type        = string
  default     = null
  validation {
    condition     = var.instance_profile_name == null || can(regex("^postureblog-ec2-[a-z0-9-]{1,80}$", var.instance_profile_name))
    error_message = "instance_profile_name must be a postureblog-ec2-* profile name."
  }
}
