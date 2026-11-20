terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state. Bucket + lock table already exist in account 637551066935.
  backend "s3" {
    bucket         = "posturesec-tfstate-637551066935"
    key            = "eks/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "posturesec-tf-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  # Safety guard: refuse to plan/apply against any other account.
  allowed_account_ids = ["637551066935"]

  default_tags {
    tags = {
      Project     = "PostureSec"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
