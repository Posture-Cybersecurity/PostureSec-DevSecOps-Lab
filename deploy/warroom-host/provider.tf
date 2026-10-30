terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state by default so the lab host can stand on its own.
  # The repo's EKS root uses an S3 backend; mirror it here with a distinct
  # key if you want shared/remote state for this host:
  # backend "s3" {
  #   bucket         = "posturesec-terraform-state"
  #   key            = "warroom-host/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "posturesec-tf-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "PostureSec"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Component   = "warroom-host"
    }
  }
}
