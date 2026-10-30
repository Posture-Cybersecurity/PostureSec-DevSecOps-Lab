variable "aws_region" {
  description = "AWS region to deploy the War Room host"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "name_prefix" {
  description = "Prefix for resource names/tags"
  type        = string
  default     = "warroom"
}

variable "instance_type" {
  description = "EC2 instance type for the War Room host. t3.medium is the default so the on-host image build (Vite + npm) has RAM headroom; t3.small can OOM the frontend build."
  type        = string
  default     = "t3.medium"
}

variable "db_password" {
  description = "PostgreSQL password for the hosted stack, supplied securely at deploy time (TF_VAR_db_password). No default: each deployment supplies a unique value. Never committed, never in outputs or the bundle."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.db_password) >= 12
    error_message = "db_password must be at least 12 characters."
  }
}

variable "root_volume_size" {
  description = "Root EBS volume size in GiB"
  type        = number
  default     = 20
}

variable "http_ingress_cidr" {
  description = "CIDR allowed to reach the public HTTP (TCP/80) endpoint. Public lab access is 0.0.0.0/0."
  type        = string
  default     = "0.0.0.0/0"
}

variable "ssh_ingress_cidr" {
  description = "CIDR allowed to reach SSH (TCP/22). Leave empty to create no SSH rule. Must not be 0.0.0.0/0."
  type        = string
  default     = ""

  validation {
    condition     = var.ssh_ingress_cidr != "0.0.0.0/0"
    error_message = "SSH must not be exposed to 0.0.0.0/0. Set ssh_ingress_cidr to your own IP/CIDR, or leave it empty."
  }
}

variable "key_name" {
  description = "Optional existing EC2 key pair name for SSH access. null = no key."
  type        = string
  default     = null
}

variable "app_bundle_path" {
  description = "Path to the locally-built application source bundle (.tgz, excluding .git and node_modules). Uploaded to S3 and pulled by user-data."
  type        = string
  default     = "app-bundle.tgz"
}

variable "app_compose_file" {
  description = "Compose file (inside the bundle) that user-data runs."
  type        = string
  default     = "docker-compose.inc005.yml"
}

variable "instructor_token" {
  description = "War Room instructor token (>= 32 chars) for the fire/reset/remediate controls. Empty = instructor controls disabled (fail closed). Pass via TF_VAR_instructor_token, never commit it."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = var.instructor_token == "" || length(var.instructor_token) >= 32
    error_message = "instructor_token must be at least 32 characters (or empty to disable instructor controls)."
  }
}

variable "incident_delay_seconds" {
  description = "Seconds from verified readiness to the INC-005 injection."
  type        = number
  default     = 300

  validation {
    condition     = var.incident_delay_seconds >= 5 && var.incident_delay_seconds <= 86400
    error_message = "incident_delay_seconds must be between 5 and 86400."
  }
}
