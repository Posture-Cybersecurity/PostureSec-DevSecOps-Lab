# INC-004 lab runbook: deploy, inject, recover, reset, tear down

All AWS work goes through `warroom/inc004/lab.sh`. Squads never run it: they use the simulation. Every command:
- re-checks the identity, the account and the region;
- refuses anything not in the War Room's own state;
- applies only saved plans that passed `plan-guard.js`.

The script never reads, prints or stores a credential.

## 0. One-time operator settings (git-ignored)

Create `warroom/inc004/.operator/lab.env` with these three lines:

```
AWS_PROFILE=<the configured CLI profile>
WARROOM_EXPECTED_ACCOUNT_ID=<the lab account id>
WARROOM_ADMIN_CIDR=<your public IP>/32      # curl -s https://checkip.amazonaws.com
```

Then check the setup:

```bash
bash warroom/inc004/lab.sh preflight
```

Preflight shows the identity (account masked), the region and the state path. It also lists any `WarRoom=INC-004` resources that already exist and checks for name collisions.

## 1. Deploy the healthy lab (billable — needs the approved budget)

```bash
bash warroom/inc004/lab.sh plan baseline
```

- **Expect:** `7 to add, 0 to change, 0 to destroy`, then `ALLOWED`.
- **Review:** `.operator/plans/baseline-*.txt`.

```bash
bash warroom/inc004/lab.sh apply baseline-<timestamp>
WAIT_SECONDS=900 bash deploy/aws-ec2/healthcheck.sh "$(terraform -chdir=warroom/inc004/terraform output -raw app_url)"
```

First boot installs Docker and builds three images, so wait about 5 minutes before judging. The healthcheck is the class's own 18 checks.

## 2. Inject the fault (CHG-1042)

```bash
bash warroom/inc004/lab.sh plan fault          # expect: 1 to add, 0 to change, 1 to destroy; ALLOWED
bash warroom/inc004/lab.sh apply fault-<timestamp>
bash warroom/inc004/lab.sh capture outage      # record redacted evidence for the simulation
```

## 3. Recover through Terraform

```bash
bash warroom/inc004/lab.sh plan recover        # expect: 1 to add, 0 to change, 0 to destroy; ALLOWED
bash warroom/inc004/lab.sh apply recover-<timestamp>
bash warroom/inc004/lab.sh verify              # port-80 rules + the 18 checks from your address
bash warroom/inc004/lab.sh capture restored
```

Review the files in `backend/src/warroom/tf_ec2/captured/` before committing them. Check that every address reads as one of the documentation ranges (192.0.2.44, 203.0.113.10, 198.51.100.0/24) and that the account ID is masked.

## 4. Reset for the next class

```bash
bash warroom/inc004/lab.sh plan reset          # expect: 0 to add, 0 to change, 1 to destroy (the VPN rule); ALLOWED
bash warroom/inc004/lab.sh apply reset-<timestamp>
bash warroom/inc004/lab.sh plan baseline       # expect: No changes (guard mode noop)
```

Squad attempts in the simulation reset separately: `./warroom.sh reset <n>`, or `POST /api/incident/reset` with the instructor token.

## 5. Tear down (destructive — review the plan first)

```bash
bash warroom/inc004/lab.sh destroy-plan        # expect: 0 to add, 0 to change, 7 to destroy; ALLOWED (all tagged INC-004)
bash warroom/inc004/lab.sh destroy destroy-<timestamp>
bash warroom/inc004/lab.sh resources           # expect: no WarRoom=INC-004 instance left
```

What remains after teardown:
- the local state file, which then holds zero resources;
- the saved plans under `.operator/plans/` (git-ignored);
- the captured evidence files, if you kept them.

Nothing billable remains: no snapshots, no Elastic IP and no S3 bucket are created. The tag API can keep listing ARNs for a while after deletion. Confirm with direct lookups, as the EC2 stack's README describes.

## Retain or tear down?

| Option | Cost (us-east-1, list prices; the class stack's own figures) | When to choose it |
|---|---|---|
| Deploy on the day, destroy after class | ≈ $0.03/hour; ≈ $0.22 for an 8-hour day | Default |
| Keep it running between classes | ≈ $0.67/day; ≈ $20.40/month | Only if classes are back-to-back |
| Stop the instance between classes | EBS ≈ $1.60/month while stopped, but the public IP changes on every start (no Elastic IP) | Not recommended: URLs change |

The hourly figure breaks down as:

| Item | Hourly | 8-hour day | Month |
|---|---|---|---|
| `t3.small` instance | ~$0.0208 | ~$0.17 | ~$15.18 |
| 20 GB gp3 volume | ~$0.0022 | ~$0.01 | ~$1.60 |
| Public IPv4 address | ~$0.005 | ~$0.04 | ~$3.65 |
| **Total** | **≈ $0.028** | **≈ $0.22** | **≈ $20.40** |

- **Free:** Session Manager; CloudTrail event history (90-day lookup, no trail created).
- **Data transfer:** effectively zero for lab traffic.
- **Full validation run:** deploy, fault, capture, recover, capture, reset, destroy takes about an hour, so roughly **$0.03–$0.10**.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `REFUSED: AWS credentials unavailable or rejected` | The profile in `lab.env` is wrong, or its key is no longer active. Check with `aws sts get-caller-identity --profile <name>`. |
| `REFUSED: caller account … is not the expected lab account` | The profile points at a different account. Stop and check. |
| `REFUSED: resources named postureblog-ec2-warroom-inc004 already exist` | Something outside this state uses the War Room's names, such as a previous state that was lost. Investigate before creating anything; do not import blindly. |
| `REFUSED (…)` from `plan-guard` | The plan does more than its operation allows. Read the listed reasons; do not apply it. |
| Healthcheck fails right after apply | First boot takes about 5 minutes. Use `WAIT_SECONDS=900`. Then read `/var/log/postureblog-bootstrap.log` over Session Manager (`ssm_session_command` output). |
| `curl: (28) … timed out` from your machine | Your address changed. Update `WARROOM_ADMIN_CIDR`, then plan and apply `baseline`, which the guard checks as `noop`, `create` or `recover`. Or you are in the fault state, which is the exercise. |
| Chrome shows `ERR_TIMED_OUT` but curl works | Chrome upgraded the URL to `https://`, and port 443 is closed. Use `http://` explicitly. |
| `capture` hangs on an SSM step | The instance is not registered with SSM yet. Wait about 2 minutes after boot. |

## Squad simulation (no AWS)

```bash
WAR_ROOM_INCIDENT=INC-004 ./warroom.sh up                                          # student mode, fuse 300 s
WAR_ROOM_INCIDENT=INC-004 WAR_ROOM_INCIDENT_DELAY_SECONDS=30 ./warroom.sh up 1      # instructor rehearsal, squad 1
bash scripts/warroom-test-local.sh                                                 # the whole backend suite on a disposable Postgres
```
