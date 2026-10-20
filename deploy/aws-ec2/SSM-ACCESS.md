# Connecting to the lab instance with AWS Systems Manager (Windows)

The PostureBlogging EC2 lab has **no SSH**: no port 22 rule and no key pair.
Operators get a shell through **Session Manager**, which needs no inbound port.
Everything below runs in **PowerShell** on Windows. Replace `INSTANCE_ID` with
the instance's ID (`terraform -chdir=deploy/aws-ec2 output -raw instance_id`).

> The lab instances from the 2026-10-20 runs and their IAM
> roles and instance profiles were **destroyed** at the end of each run
> (verified: instance terminated, `NoSuchEntity` afterwards). These steps are
> for the next deployment.

## 1. AWS CLI v2

```powershell
aws --version          # expect aws-cli/2.x
```

If it is missing, install AWS's official MSI, then open a **new** PowerShell window:

```powershell
winget install -e --id Amazon.AWSCLI
```

(or download `https://awscli.amazonaws.com/AWSCLIV2.msi` and run it).

## 2. Session Manager plugin (needed only for interactive sessions)

```powershell
session-manager-plugin
```

Expected: `The Session Manager plugin was installed successfully. Use the AWS CLI
to start a session.` If the command is not found, install AWS's official plugin
installer, then open a **new** PowerShell window (the installer adds
`C:\Program Files\Amazon\SessionManagerPlugin\bin` to `PATH`):

```powershell
Invoke-WebRequest https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe -OutFile $env:TEMP\SessionManagerPluginSetup.exe
Start-Process $env:TEMP\SessionManagerPluginSetup.exe -Wait
```

`aws ssm send-command` (section 8) does **not** need the plugin.

## 3. Profile and region

Credentials go into your own terminal only — never into chat, files in the
repository, or Terraform variables.

```powershell
aws configure --profile postureblog-lab           # access key, secret, region us-east-1
aws configure set region us-east-1 --profile postureblog-lab
aws configure get region --profile postureblog-lab   # expect: us-east-1
```

(On 2026-10-20 the profile had **no region set**; every command then needed
`--region us-east-1`. Setting it removes that trap. The commands below still
pass both flags so they work either way.)

## 4. Confirm who you are

```powershell
aws sts get-caller-identity --profile postureblog-lab --region us-east-1
```

Expected: `"Account": "<lab-account-id>"` and an **IAM user or role** ARN such as
`arn:aws:iam::<lab-account-id>:user/postureblog-lab-operator`. If the ARN ends in
`:root`, you are using root credentials — stop and switch to the operator
identity (`iam/operator-policy.json`).

## 5. Find the instance

```powershell
aws ec2 describe-instances --profile postureblog-lab --region us-east-1 `
  --filters Name=tag:Stack,Values=postureblog-ec2 Name=instance-state-name,Values=running `
  --query "Reservations[].Instances[].[InstanceId,PublicIpAddress,State.Name]" --output table
```

## 6. Check the instance's IAM role has `AmazonSSMManagedInstanceCore`

```powershell
# 1) which instance profile is attached
aws ec2 describe-instances --profile postureblog-lab --region us-east-1 --instance-ids INSTANCE_ID `
  --query "Reservations[0].Instances[0].IamInstanceProfile.Arn" --output text
# 2) which role the profile contains
aws iam get-instance-profile --profile postureblog-lab --instance-profile-name postureblog-ec2-lab-<owner>-ssm `
  --query "InstanceProfile.Roles[].RoleName" --output text
# 3) which policies the role has
aws iam list-attached-role-policies --profile postureblog-lab --role-name postureblog-ec2-lab-<owner>-ssm `
  --query "AttachedPolicies[].PolicyArn" --output text
```

Expected: `…:instance-profile/postureblog-ec2-lab-<owner>-ssm`, the role of the
same name, and exactly `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore`.

## 7. Check the instance is registered and online

```powershell
aws ssm describe-instance-information --profile postureblog-lab --region us-east-1 `
  --filters "Key=InstanceIds,Values=INSTANCE_ID" `
  --query "InstanceInformationList[].[InstanceId,PingStatus,AgentVersion,PlatformName]" --output table
```

Expected: one row with `PingStatus` **Online**. (2026-10-20: Online ~1 minute
after launch.) An empty result means the agent has not registered — see
Troubleshooting.

## 8. Interactive shell

```powershell
aws ssm start-session --target INSTANCE_ID --profile postureblog-lab --region us-east-1
```

You land as `ssm-user`. Useful commands on the instance:

```bash
sudo docker compose -p postureblog ps              # run from /opt/postureblog/app
sudo tail -n 50 /var/log/postureblog-bootstrap.log
sudo docker logs --tail 50 posturesec-frontend
curl -s http://localhost/api/health
```

**Exit:** type `exit` (or press Ctrl+D). The session ends and the CLI prints
`Exiting session with sessionId …`. If a session hangs, end it from your machine:

```powershell
aws ssm terminate-session --profile postureblog-lab --region us-east-1 --session-id SESSION_ID
```

## 9. One-off diagnostic command (no plugin needed)

PowerShell 5.1 mangles double quotes inside arguments passed to native
programs, so put the commands in a JSON file instead of on the command line:

```powershell
'{"commands":["cd /opt/postureblog/app && docker compose -p postureblog ps","tail -n 20 /var/log/postureblog-bootstrap.log"]}' |
  Set-Content -Encoding ascii $env:TEMP\ssm-params.json
$id = aws ssm send-command --profile postureblog-lab --region us-east-1 --instance-ids INSTANCE_ID `
  --document-name AWS-RunShellScript --parameters file://$env:TEMP\ssm-params.json `
  --query Command.CommandId --output text
aws ssm wait command-executed --profile postureblog-lab --region us-east-1 --command-id $id --instance-id INSTANCE_ID
aws ssm get-command-invocation --profile postureblog-lab --region us-east-1 --command-id $id --instance-id INSTANCE_ID `
  --query "[Status,StandardOutputContent]" --output text
```

`AWS-RunShellScript` runs as **root** on the instance (no `sudo` needed). Never
print `/opt/postureblog/.env` — it holds the database password.

If the output contains emoji (the backend logs do) and the CLI fails with
`'charmap' codec can't encode character`, set UTF-8 output first (seen on
2026-10-20):

```powershell
$env:PYTHONUTF8 = "1"
```

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `SessionManagerPlugin is not found` | Plugin missing or the terminal predates its install — section 2, then a new PowerShell window |
| `AccessDeniedException` on `StartSession` / `SendCommand` / `GetCommandInvocation` / `DescribeInstanceInformation` | Your identity lacks the SSM statements in `iam/operator-policy.json` (`ssm:StartSession` / `ssm:SendCommand` on instances tagged `Stack=postureblog-ec2` plus the `SSM-SessionManagerRunShell` / `AWS-RunShellScript` documents; `ssm:GetCommandInvocation`, `ssm:DescribeInstanceInformation`, `ssm:TerminateSession`). Fix the policy — do not fall back to root |
| `TargetNotConnected`, or the instance is absent from `describe-instance-information` | (1) Wait 1–5 minutes after launch. (2) Section 6: the instance profile must be attached and its role must have `AmazonSSMManagedInstanceCore`. (3) The agent must run — Ubuntu 24.04 AMIs ship it as a snap; look at `aws ec2 get-console-output --instance-id INSTANCE_ID --latest --output text` for agent or cloud-init errors. (4) Wrong region/profile — every command must say `us-east-1` |
| Registered once, now `ConnectionLost` | The agent lost outbound HTTPS. It must reach `ssm`, `ssmmessages` and `ec2messages` endpoints in us-east-1 on port 443. This lab allows all outbound traffic from a public subnet; a private subnet would need a NAT gateway or VPC endpoints |
| Works but `docker` says permission denied | Session Manager logs in as `ssm-user`, which is not in the `docker` group — use `sudo docker …` |

## How the instance got its SSM permissions (2026-10-20 run, now destroyed)

Terraform (`main.tf`, `enable_ssm = true`) created three IAM resources for the
instance — not for any person:

| Resource | Name | What it did |
|---|---|---|
| `aws_iam_role.ssm` | `postureblog-ec2-lab-emanet1-ssm` | A role that **only the EC2 service** may assume (trust policy principal `ec2.amazonaws.com`) |
| `aws_iam_role_policy_attachment.ssm` | AWS-managed `AmazonSSMManagedInstanceCore` | The only permission on the role: lets the SSM agent register the instance and receive commands and sessions. No S3, no IAM, nothing else |
| `aws_iam_instance_profile.ssm` | `postureblog-ec2-lab-emanet1-ssm` | The container that attaches the role to an instance; set on `aws_instance.app` at launch |

At boot the SSM agent (running on the host) fetched short-lived credentials for
that role from the instance metadata service (IMDSv2 only, one hop — so the
Docker containers could not), registered with Systems Manager, and showed as
Online. All three were destroyed with the stack at 15:53 UTC on 2026-10-20 and
`aws iam get-role` / `get-instance-profile` then returned `NoSuchEntity`.
