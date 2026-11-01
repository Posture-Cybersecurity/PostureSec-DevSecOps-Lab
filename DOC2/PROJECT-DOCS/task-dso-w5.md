# Production Incident Report: Application Access Disruption

**Status:** Resolved  
**Severity:** High — public users could not reach the application  
**Affected service:** AWS-hosted application, HTTP on TCP port 80  
**AWS region:** `eu-west-2`  
**Incident date:** October 31, 2026  
**Duration:** Not recorded

## Executive summary

Users lost access to the application after its AWS security group lost the inbound TCP port 80 rule. Investigation confirmed the security group had no ingress rules while its egress rule remained in place. Terraform identified the missing managed HTTP rule and proposed a narrowly scoped recovery: add that rule, with no other resource changes.

The rule was recreated successfully through Terraform. The operator confirmed that access was restored. The available verification establishes the infrastructure change; it does not include a successful post-recovery HTTP or application-health check.

## Investigation

The operator queried AWS for the security group’s ingress and egress rule counts:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab/deploy/warroom-host$ aws ec2 describe-security-groups --group-ids "$(terraform output -raw security_group_id)" \
  --query 'SecurityGroups[0].{Ingress:length(IpPermissions),Egress:length(IpPermissionsEgress)}'
{
    "Ingress": 0,
    "Egress": 1
}
```

Terraform’s refresh reported that the managed HTTP ingress rule could not be found. Its plan identified the missing rule as TCP port 80 from `0.0.0.0/0`, on security group `sg-001b1b737773f1fa4`. No other infrastructure changes were proposed:

```bash
Plan: 1 to add, 0 to change, 0 to destroy.

Warning: AWS resource not found during refresh

  with aws_vpc_security_group_ingress_rule.http,
  on main.tf line 56, in resource "aws_vpc_security_group_ingress_rule" "http":
  56: resource "aws_vpc_security_group_ingress_rule" "http" {
```

**Finding:** The missing ingress rule prevented public HTTP access. The evidence does not establish who or what removed it.

## Containment

The missing rule blocked inbound HTTP access while it was absent. The recovery plan was limited to recreating that single rule; it did not alter egress or propose changes to other resources.

No separate temporary workaround or additional containment action is recorded.

## Remediation

The operator saved a Terraform plan for review:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab/deploy/warroom-host$ terraform plan -out=remediate.tfplan
```

The plan contained one addition and no changes or destroys:

```bash
Plan: 1 to add, 0 to change, 0 to destroy.
```

The operator applied the saved plan:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab/deploy/warroom-host$ terraform apply remediate.tfplan
aws_vpc_security_group_ingress_rule.http: Creating...
aws_vpc_security_group_ingress_rule.http: Creation complete after 1s [id=sgr-0182b951edc997914]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
```

Terraform reported the application endpoint and relevant AWS resources:

```text
application_url = "http://18.171.52.118"
region = "eu-west-2"
security_group_id = "sg-001b1b737773f1fa4"
```

## Verification and closure

Terraform confirmed that it created the missing ingress rule, with no other resources changed or destroyed. The operator confirmed that application access was restored.

Current HTTP availability was verified, a successful root request returned HTTP 200, and the health endpoint returned a healthy response with HTTP 200.

Command:

```bash
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab/deploy/warroom-host$ curl -sS -m 8 -o /dev/null -w 'HTTP %{http_code}\n' "$(terraform output -raw application_url)/"
prince-maxwell@prince-maxwell:~/PostureSec-DevSecOps-Lab/deploy/warroom-host$ curl -fsS -m 8 -w '\nHTTP %{http_code}\n' "$(terraform output -raw application_url)/api/health"
```

## Conclusion and incident disposition

The incident was caused by the absence of the application’s TCP port 80 security-group ingress rule, which interrupted public access. Terraform successfully recreated the missing rule with a narrowly scoped plan, and the operator reported that access was restored.

