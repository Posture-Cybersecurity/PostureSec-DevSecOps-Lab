# ==============================================================
# App delivery without the private Git remote: Terraform uploads a source
# bundle to a PRIVATE S3 bucket; the instance profile grants read on just that
# object; user-data pulls + builds it. No GitHub PAT, no SSH-to-world, no keys
# baked into the image.
# ==============================================================

resource "aws_s3_bucket" "app" {
  bucket        = "warroom-inc005-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # so `terraform destroy` removes the bundle with the bucket
  tags          = { Name = "${var.name_prefix}-app-bundle" }
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket                  = aws_s3_bucket.app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  bucket = aws_s3_bucket.app.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The application source bundle (built locally, excludes .git and node_modules).
resource "aws_s3_object" "app_bundle" {
  bucket      = aws_s3_bucket.app.id
  key         = "app-bundle.tgz"
  source      = var.app_bundle_path
  source_hash = filemd5(var.app_bundle_path)
}
