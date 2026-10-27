# INC-004 — Student briefing

**SEV-1. PostureBlogging is unreachable for every user.**

Your team runs PostureBlogging on one EC2 instance, built by the Terraform stack you used in class (`deploy/aws-ec2`). The containers run under Docker Compose, the instance sits behind a security group, and Session Manager gives you a shell with no SSH. Shortly before the alert, an infrastructure change went out through the Terraform pipeline.

You have about **five minutes** to restore the service safely and prove it.

## Start

```bash
WAR_ROOM_INCIDENT=INC-004 ./warroom.sh up
```

1. Open http://localhost:8080 and register an account. Every action you take is recorded against it.
2. The alarm fires on its own, after the fuse. You do not trigger it.
3. Open **the incident page** (the red banner), then **the workspace** beneath the brief.

## What you can do in the workspace

- **Investigate.** Run read-only commands against monitoring, the network, the instance (Session Manager), AWS and Terraform. Each output says whether it is *simulated* or *captured* from the real lab.
- **Act directly** on the instance or in the AWS console. Some of these actions help, some do nothing, and some make things worse.
- **Change through Terraform.** Propose a change, **review its plan**, then apply it.
- **Verify** from the users' side.
- **File your incident report:** the root cause your evidence supports, plus a short summary covering impact, cause, fix, verification and prevention.

## Rules of engagement

- Every infrastructure change goes through Terraform with a reviewed plan. Console changes are recorded.
- Never edit Terraform state by hand.
- Do not make the service reachable by making it less secure. This is an intentionally vulnerable training application.
- AI may help you form a hypothesis. It is not evidence: confirm every claim against an output before you write it down.

## Questions to answer, with evidence

1. What is the user impact, and since when?
2. Is the application itself healthy? How do you know?
3. Why do users get no response at all?
4. What changed, who changed it, and through which path?
5. Do the Terraform configuration, the Terraform state and the real AWS resources agree?
6. What is the safe recovery, and how do you prove it worked?
7. What would stop this recurring?

## Scoring

Points are awarded for:

- evidence from each layer;
- a correct root cause;
- a recovery made through Terraform, with the plan reviewed;
- a passing verification;
- a complete report.

Unsafe actions cost points, even when they make the site load again. Your score appears when the incident is complete.
