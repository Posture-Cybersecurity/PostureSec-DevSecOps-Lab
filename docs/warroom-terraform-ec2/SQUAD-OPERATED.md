# INC-004: the squad-operated real-AWS War Room

**Status (2026-10-27): the squad platform has run end to end on real AWS** — INC-004 live and INC-005 (squad alpha, us-east-1, dedicated lab account; every resource destroyed and independently verified gone). Those runs used the account owner's **authorized dedicated-lab root** identity (`WARROOM_ALLOW_ROOT_FOR_LAB`), not a per-squad least-privilege identity: the squad identity and `squad-policy.json` below are still **not demonstrated on AWS** (see [Remaining](#remaining-needs-you-in-order)).

The design claims below are backed by local tests (fake driver, recorded script outputs, shimmed CLIs, a locally built image) and, for the platform journey, by those two real runs.

## The model (corrected)

**A squad is the unit.**

| One per squad | Per member | Isolated between squads |
|---|---|---|
| INC-004 incident, EC2 lab, Terraform state, fuse, timeline, recovery lifecycle, score | an authenticated War Room account, used for attribution and audit only | names, tags, Terraform workspace and state, configuration, plans, IAM scope, control plane |

Members collaborate on the same incident. The platform runs the exercise; the instructor only monitors and, in an emergency, overrides.

## Architecture

```
squad members (browsers, own accounts) ─► SQUAD CONTROL PLANE = this War Room in live mode
                                           (own host/port, e.g. :8080 — NOT behind the lab's port 80)
                                           ├─ backend: routes_tf_ec2_live.js ─ injector_tf_ec2_live.js
                                           │     └─ squad runner (operation lock) ─ controller (state machine)
                                           │           state: ONE row per squad (Postgres, row-locked)
                                           │           loop:  ONE per squad (timer.js → startLoop)
                                           └─ driver-real.js ─► squad-lab.sh ─► terraform (workspace = squad)
                                                                  │              ├─ plan-guard.js --squad
                                                                  │              └─ module "lab" = deploy/aws-ec2
                                                                  └─► aws (squad profile, never root) ─► the squad's EC2 lab
instructor ─► fleet.sh list (read-only tags) · fleet.sh override → the squad's control plane (token)
```

- **The control plane stays reachable during the outage.** It is the squad's War Room, on its own host and port. The fault only changes the lab's port-80 rules. The platform probes the lab from the control plane's own address, which must be in the squad's approved list, so the outage is observed for real.
- **The fault is a Terraform apply.** The platform acts as the squad's pipeline. It commits CHG-1042 to the squad's ingress configuration and applies it through the guard (`fault` mode). Configuration, state and AWS then agree, and `terraform plan` reports "No changes".

## Which files assumed per-student infrastructure, and what changed

| File (previous round) | Per-student assumption | Now |
|---|---|---|
| `warroom/inc004/terraform/main.tf` | `student_id`, `WarRoomStudent`, `…-<student>-ssm` | `squad_id`, `WarRoomSquad`, `…-<squad>-ssm` |
| `…/terraform/tests/inc004.tftest.hcl` | "student lab creates no IAM" | "squad lab creates no IAM" |
| `warroom/inc004/student/*` | one student, one actor, no lock | **removed** (my own uncommitted files), replaced by `warroom/inc004/squad/*`: squad state, `by` on every entry, operation lock, configuration history, four-eyes review |
| `backend/tests/warroom_inc004_student.test.js` | one-student journey | replaced by `warroom_inc004_squad.test.js` (three members, two squads) |
| `warroom/inc004/plan-guard.js` | recovery = exactly one rule; no ownership check | recovery = one or more of the squad's rules; `[squad]` argument refuses any resource tagged for another squad |
| `warroom/inc004/lab.sh` | operator address = "the users"; fixed name | unchanged in behaviour (instructor rehearsal, `squad_id=inc004`); squads use `squad/squad-lab.sh` |
| `deploy/aws-ec2` comments | "per student" | "per squad" |

## How concurrent members share one exercise safely

1. **One state document per squad**, updated only as an atomic read-modify-write. In the backend that is a row-locked `warroom_inc004_live` row.
2. **One operation lock per squad.** Every change (deploy, configuration, plan, review, apply, report, cleanup, the platform tick and the instructor override) takes `state.op` first, with a per-kind TTL. A second member gets **HTTP 409 naming who is running what**.
   - The platform tick simply skips while a member's operation runs.
   - A long operation runs in the background (**202**), and the UI polls.
   - An operation that outlives its TTL and is taken over **cannot overwrite** the newer holder (`LockLost`).
3. **The fuse fires once.** `fired_at` is persisted under the lock before the fault is applied. Concurrent ticks and control-plane restarts cannot re-fire it.
4. **Plans are the squad's, not a member's.** Only the squad's current plan can be reviewed or applied. Any configuration change invalidates it. A saved plan applies once. Another member's review is recorded as four-eyes review.
5. **Terraform's own state lock** (`-lock-timeout`) is the second line of defence, per squad workspace.

## Security boundaries

| Boundary | Control |
|---|---|
| Runtime identity | The squad's least-privilege profile (a name, with config mounted read-only). `squad-lab.sh` **refuses root** and any other account. Raw key variables are stripped from the driver's environment. |
| Permissions | `warroom/inc004/iam/squad-policy.json`: one policy for every squad, scoped by principal tag `WarRoomSquad`. |
| Isolation on one host | Terraform workspace = squad; `.operator/squads/<squad>/` holds that squad's configuration, plans and history; the guard checks squad ownership. |
| Network | Port 80 from the squad's approved addresses only. 0.0.0.0/0 is refused in four places: the configuration API, `squad-lab.sh`, the stack's precondition, and the guard. No SSH, no database port. |
| Inputs | Allow-lists everywhere (evidence ids, actions, hypotheses, tag keys, plan names). `execFile` with an argument array and no shell. |
| Image | Non-root, read-only root filesystem, state on volumes. The **fake driver is excluded from the image**, and the test hook refuses to run under `NODE_ENV=production`. |

What `squad-policy.json` contains:

- **Allow:** `t3.small` only; create only with your own squad tag; change or delete only your own squad's resources; `iam:PassRole` only for `postureblog-ec2-warroom-<squad>-ssm` and only to EC2; SSM only on your own instance.
- **Deny:** everything outside us-east-1, and everything else, IAM writes included.

## Cost

About **$0.028/h per squad**: a `t3.small`, 20 GB gp3 and one public IPv4 address. The control plane runs on the squad's own machine, or on a War Room host if you already have one.

| Scenario | Cost |
|---|---|
| One squad, one exercise (about 1 h) | ≈ $0.03 |
| One squad at the hard 3-hour cap | ≤ $0.09 |
| Ten squads | < $1 |

The platform also destroys a completed lab after the grace period, and destroys any lab at the lifetime cap.

## Evidence (local)

| Suite | What it proves |
|---|---|
| `warroom_inc004_squad.test.js` (18) | One squad, three members: deploy, auto-ready, auto-arm, **auto incident (once)**, shared investigation, configuration, plan, four-eyes review, apply, **auto verification**, one squad score of 100 with contributors, then cleanup. The exact `by:event` timeline; no instructor entry. Concurrent applies give one run plus a 409, and Terraform is never concurrent. 8 simultaneous ticks give exactly one fault. A restart doesn't re-fire. `LockLost`. **Cross-squad: alpha's whole journey leaves bravo's lab, fuse, state and score byte-identical**, and each squad's fault and score are its own. Remediation rules, lifetime and grace cleanup, the override. |
| `warroom_inc004_live.test.js` (5) | The same journey **through the real backend API and Postgres**, with the fake driver injected: alarm banner raised and resolved by the platform, background 202 operations, a concurrent-apply 409, token-gated instructor controls, a restart keeping the fuse, two squads in one table. |
| `warroom_inc004_driver_real.test.js` (10) | The real driver: exact argv with no shell, environment without raw keys, strict parsing, failing closed. |
| `warroom_inc004_squadlab.test.js` (12) | The real script with shimmed CLIs: **root refused before any Terraform**, wrong account refused (masked), per-squad workspace, configuration, plans and history, the guard refusing another squad's resources, apply once and only if allowed, the fault committed to configuration, allow-lists, the fleet tool read-only, and no delete-by-tag path. |
| `warroom_inc004_planguard.test.js` (14) | Guard modes, multi-address recovery, squad ownership. |
| `warroom_inc004_iam.test.js` (7) | Policy least privilege, squad scoping, and coverage of every CLI call in `squad-lab.sh`. |
| `terraform test` (7 War Room, 12 class stack) | A squad lab creates **no IAM**; names and tags per squad; fault and recovery shapes. |
| Control-plane image (`S1-control-plane-smoke.txt`) | Builds locally. Terraform 1.11.3 (SHA256-verified), AWS CLI v2, jq, bash, non-root. No fake driver. **No credentials gives a refusal, never a fallback.** The test hook is refused in production. |

## Remaining (needs you, in order)

1. **Read-only AWS:** evaluate `squad-policy.json` with `aws iam simulate-custom-policy` (own squad allowed, other squad denied, IAM writes denied, a non-t3.small instance denied).
2. **Authorization:** the instructor bootstrap for **one** test squad:
   - a squad identity with tag `WarRoomSquad=<id>`;
   - the customer-managed policy;
   - the squad's instance profile `postureblog-ec2-warroom-<id>-ssm`, with an EC2 trust and `AmazonSSMManagedInstanceCore`.

   Not written yet as code, deliberately, because it creates identities.
3. **Budget cap:** one **real** end-to-end run as that squad identity, from a control plane on a separate host or port, with evidence. Then verify nothing remains.

The platform journey itself has been demonstrated on real AWS (2026-10-27) with the authorized dedicated-lab root identity. Until step 3 has run, it is **not demonstrated as a least-privilege squad identity**.

### Known limits of the local proof

- **The policy is only self-consistent.** Terraform's own API calls (for example `DescribeInstanceAttribute` during refresh) are covered by `ec2:Describe*`, but IAM has never evaluated the policy.
- **SSM may race at first boot.** The real driver's `observe` waits up to about 40 s for SSM commands; during the first boot the platform simply re-checks on the next tick.
- **Per-member AWS attribution is not implemented.** CloudTrail shows the squad identity. Member attribution is in the War Room timeline.
