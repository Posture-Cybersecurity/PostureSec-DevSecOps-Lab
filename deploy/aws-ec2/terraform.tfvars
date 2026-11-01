# Copy to terraform.tfvars (git-ignored). No secrets belong here: the database
# password is generated on the instance at first boot.
owner              = "princemaxi"
aws_region         = "eu-west-2"
instance_type      = "t3.small"
http_ingress_cidrs = ["0.0.0.0/0"]   
# ssh_ingress_cidrs = ["REPLACE.WITH.OPERATOR.IP/32"]    # optional; needs key_name
# key_name          = "REPLACE-existing-key-pair"
allowed_account_id = "686255973523"
allow_http_from_anywhere = true