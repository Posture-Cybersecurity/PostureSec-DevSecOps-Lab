# INC-004 — your squad's real EC2 lab (student guide)

Your squad runs this together. You share **one** lab, **one** incident, **one** timeline and **one** score. Every action you take is recorded under your own account, so the whole squad can see who did what.

**Who runs things.** Nobody runs it for you. Your squad deploys the lab. The platform arms the incident when the lab is healthy, fires it on its own, verifies your fix and scores it. Your instructor only watches.

## 1. Start the squad's War Room (one person, once)

Your instructor gives your squad:

- a **squad name** (for example `alpha`);
- an AWS profile for the squad (a least-privilege identity — never anyone's root);
- the squad's approved addresses.

One squad member starts the War Room on their own machine. It is the squad's **control plane**: it stays reachable while the lab is down.

```bash
WAR_ROOM_INCIDENT=INC-004 WAR_ROOM_INC004_MODE=live \
WARROOM_LIVE_SQUAD=alpha WARROOM_LIVE_SQUAD_CIDRS=<approved addresses, comma-separated> \
WARROOM_LIVE_ACCOUNT_ID=<lab account> WARROOM_LIVE_AWS_PROFILE=<squad profile> WARROOM_LIVE_AWS_DIR="$HOME/.aws" \
./warroom.sh up
```

- The approved list must include the address this machine reaches the internet from: `curl -s https://checkip.amazonaws.com`.
- Squad members open that War Room (port 8080 on that machine), register, and sign in.

## 2. Deploy

Open **/lab**, then **Deploy the squad lab**. The platform waits until the application is healthy and reachable from your network. That takes about 5 minutes on first boot.

## 3. The incident happens on its own

Once the lab is healthy, the incident is armed. It can happen at any time. When it does, the red banner appears.

## 4. Investigate, together

Use the workspace views. Each is a real, read-only look at your lab:

- what users see;
- the instance itself (via Session Manager);
- the instance status;
- the security-group rules;
- what Terraform state records;
- your squad's Terraform configuration and its history;
- a fresh `terraform plan`;
- the recent security-group API calls.

## 5. Fix it through Terraform

1. Edit the squad's ingress configuration in the workspace.
2. Run `terraform plan`.
3. Have **another squad member** review the plan.
4. Apply it.

Only the squad's current plan can be applied, and one member's Terraform runs at a time. If someone else is busy, the workspace tells you who and what.

## 6. The platform verifies, then you report

The platform checks your recovery from the users' side. When it passes, file the **squad's** incident report: the root cause, then a summary covering impact, cause, fix, verification and prevention. Your squad score appears.

## 7. Clean up

Press **Destroy the squad lab**. If you don't, the platform does it on its own shortly after completion, and at the lab's maximum lifetime.

Do **not** remove the War Room's volumes (`docker compose down -v`) while the lab exists. They hold your squad's Terraform state, and removing them would leave billable resources behind. `./warroom.sh down` keeps them.

## Rules

- Change infrastructure only through the squad's Terraform plan. The tempting shortcuts — the console, opening port 80 to the internet, rebuilding the instance — are detected and cost the squad points.
- Never use or share anyone's root credentials.
