# ==============================================================
# PostureSec EKS Cluster - Managed Node Groups
# ==============================================================

data "aws_availability_zones" "available" {
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}

# ---- VPC ----
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs             = local.azs
  private_subnets = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 4, k)]
  public_subnets  = [for k, v in local.azs : cidrsubnet(var.vpc_cidr, 8, k + 48)]

  enable_nat_gateway = true
  single_nat_gateway = true # Cost-saving for dev; use one per AZ for prod

  # Tags required for EKS Auto Mode to discover subnets
  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }
}

# ---- EKS Cluster ----
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  # Networking
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Security: private endpoint for in-VPC traffic, public for kubectl from the lab host
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  # API_AND_CONFIG_MAP: EKS access entries (preferred) plus legacy aws-auth
  authentication_mode = "API_AND_CONFIG_MAP"

  # Security: envelope encryption for secrets at rest
  cluster_encryption_config = {
    resources = ["secrets"]
  }

  # Security: control-plane audit logging
  cluster_enabled_log_types = [
    "api",
    "audit",
    "authenticator",
    "controllerManager",
    "scheduler"
  ]

  # Managed addons pinned to the versions compatible with cluster_version
  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni    = { most_recent = true }
  }

  # Allow the deploying principal (the assumed Terraform role) to manage the cluster
  enable_cluster_creator_admin_permissions = true

  # ---- Worker nodes ----
  # Standard managed node group: predictable instance type and cost.
  # EKS Auto Mode was removed because it provisions opaque m7g/c7g capacity
  # with no direct control over instance type or count.
  eks_managed_node_groups = {
    default = {
      name           = "${var.cluster_name}-ng-default"
      ami_type       = "AL2023_x86_64_STANDARD"
      instance_types = ["t3.medium"]
      capacity_type  = "ON_DEMAND"

      # Explicit short IAM role name: the module would otherwise derive
      # "<name>-eks-node-group", which exceeds the 38-char name_prefix limit.
      iam_role_name = "${var.cluster_name}-ng"

      min_size     = 2
      max_size     = 4
      desired_size = 2

      disk_size = 20
      disk_type = "gp3"

      labels = {
        role = "general"
      }

      tags = {
        Name = "${var.cluster_name}-ng-default"
      }
    }
  }
}

# ==============================================================
# EBS CSI driver
# ==============================================================
# Required by k8s/posturesec.yaml, which declares a StorageClass backed by
# ebs.csi.eks.amazonaws.com and a 10Gi PVC for PostgreSQL. Without this addon
# (and its IRSA role) the PVC stays Pending forever and the DB never starts.
# The driver is granted credentials via IRSA, never via node-instance-profile
# credentials, so the driver is the only identity that can create EBS volumes.

data "aws_iam_policy_document" "ebs_csi_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.eks.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.eks.oidc_provider}:sub"
      values   = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${var.cluster_name}-ebs-csi"
  description        = "IRSA role for the EBS CSI driver in ${var.cluster_name}"
  assume_role_policy = data.aws_iam_policy_document.ebs_csi_assume.json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

data "aws_partition" "current" {}

data "aws_eks_addon_version" "ebs_csi" {
  addon_name         = "aws-ebs-csi-driver"
  kubernetes_version = module.eks.cluster_version
  most_recent        = true
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name = module.eks.cluster_name
  addon_name   = "aws-ebs-csi-driver"

  addon_version               = data.aws_eks_addon_version.ebs_csi.version
  service_account_role_arn    = aws_iam_role.ebs_csi.arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "PRESERVE"

  depends_on = [aws_iam_role_policy_attachment.ebs_csi]
}
