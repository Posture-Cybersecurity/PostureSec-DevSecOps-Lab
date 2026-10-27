# War Room INC-004 — "The Terraform Apply That Broke Production" (EC2 Edition)

INC-004 is a timed, automatically triggered War Room exercise built on the class's own EC2 stack (`deploy/aws-ec2`). Squads investigate an outage that a reviewed-looking Terraform change caused. They separate four things: what the **configuration** says, what the **state** records, what **AWS** is running, and what the **instance** is doing. Then they fix it through Terraform, prove the recovery and file a report.

INC-005 ("Console Hotfix Drift", the curriculum's DSO-W5 drill on the same EC2 stack) runs on the same squad platform; see [INC-005](#inc-005-spoiler-free-summary).

**Public vs instructor-only.** This repository is **public**: everything tracked here (documents, code, tests) can be read by students. Written answers — root causes, the expected investigation and fix, scoring keys, solved run logs — live only in `warroom/inc004/.operator/`, which is git-ignored, never committed, and distributed to instructors separately (the INC-003 precedent, commit `56f2fa0`).

| Document | Audience | Contains the answer? |
|---|---|---|
| this file | maintainers | no |
| [`../warroom/INC-004-STUDENT-BRIEFING.md`](../warroom/INC-004-STUDENT-BRIEFING.md) | squads | no |
| INC-005 brief: served by the War Room (`GET /api/incident`, symptom-level only) | squads | no |
| [`FACILITATOR-GUIDE.md`](FACILITATOR-GUIDE.md) | instructor | no (logistics, timing, rubric shape) |
| [`RUNBOOK.md`](RUNBOOK.md) | lab operator | no answer key; it does describe how the INC-004 fault is injected (deploy, fault, recover, reset, teardown, cost, troubleshooting) |
| [`SQUAD-OPERATED.md`](SQUAD-OPERATED.md) | maintainers | no answer key; it describes the platform design, including how the INC-004 fault is applied (one lab per squad, concurrency, isolation, security, status) |
| [`../warroom/INC-004-SQUAD-REAL-LAB.md`](../warroom/INC-004-SQUAD-REAL-LAB.md) | squads | no (running your squad's real lab) |
| `warroom/inc004/.operator/ANSWER-KEY.md` | instructor only | **yes** (INC-004). Git-ignored, never committed. |
| `warroom/inc004/.operator/inc005/INC-005-CONSOLE-HOTFIX-DRIFT.md` | instructor only | **yes** (INC-005: fault, fix, recovery checks, scoring, live-rehearsal procedure). Git-ignored, never committed. |
| `warroom/inc004/.operator/inc005/LIVE-05-inc005-rehearsal.log` | instructor only | **yes** (a solved INC-005 run on real AWS, masked). Git-ignored, never committed. |

## Branch and integration decisions

- **Branch:** `feature/warroom-terraform-ec2`, created from `feature/postureblog-ec2-compose` @ `96e980d` (verified identical to `lab/feature/postureblog-ec2-compose`). It lives in a separate worktree, `ENTERPRISE-TRAINING/warroom-tfec2-wt`. The original worktree and its uncommitted changes were not touched.
- **War Room engine:** `backend/src/warroom/`, INC-001 to INC-003. It is not on `lab/dev` or on the EC2 branch; it lives on `lab/feature/warroom-inc003` @ `56f2fa0`.
  - It is brought in by the merge commit `e3219ca` (parents `96e980d` and `56f2fa0`), exactly as committed upstream, so that branch and the student branches built on it stay compatible.
  - The only conflict was `.gitattributes` (added on both sides), resolved to the union of both.
  - Integration into `lab/dev`: one PR of this branch, merged with a merge commit (not squash or rebase). Merging `lab/feature/postureblog-ec2-compose` and `lab/feature/warroom-inc003` separately first would re-open the `.gitattributes` conflict.
- **INC-004 uses the engine's own contracts** rather than a parallel framework:
  - its injector implements `{ runIncident, reset }` and is listed in `incidents.js`;
  - the existing fuse (`timer.js`, default 300 s) fires it automatically;
  - the existing instructor controls (`trigger`, `reset`, `status/:state`) work unchanged;
  - INC-001 to INC-003 behave exactly as before. Their tests pass, and their code paths are untouched apart from additive `inc004` branches in `routes.js`.
- **The EC2 stack is reused, with additive changes only** (defaults leave the class stack as it was; its 12 offline tests still pass):
  - an optional `extra_tags` variable (default `{}`), so War Room resources can carry `WarRoom=INC-004|INC-005`. It is merged *under* the stack's own tags, so it can never override `Project`, `Stack`, `Environment`, `Owner` or `ManagedBy` (verified on a real plan);
  - an optional `instance_profile_name` (default `null`) to use a pre-created profile instead of creating the SSM role;
  - provider `ignore_tags` for the War Room's out-of-band progress tags (`WarRoomPhase`, `WarRoomScore`, used by INC-004 live only), so they are never drift.

## The incident (spoiler-free summary)

An infrastructure change goes out through the pipeline, and the site becomes unreachable for every user. Squads get an automatic SEV-1 alarm, a brief, and a workspace of investigation commands across monitoring, the network, the instance (via Session Manager), AWS and Terraform. They can also act directly on the instance or the console, which may be dangerous, or change things through Terraform with a plan review. The root cause, the evidence chain and the scoring key are in the answer key only.

## INC-005 (spoiler-free summary)

The squad deploys its own lab and sees it healthy. Some time later its website stops answering from the squad's network, while monitoring shows the instance itself as healthy. Nobody on the squad has changed the Terraform configuration. Squads investigate in the War Room workspace, restore the desired state through Terraform, and the platform verifies the recovery, scores it and destroys the lab — with no instructor step. Select it with `WAR_ROOM_INCIDENT=INC-005 ./warroom.sh up <n>` (a real AWS lab per squad; the operating procedure, the answer and a solved run are instructor-only, see the table above).

## How it works

```
                 squads (browser)                               lab operator (CLI)
                       │                                              │
   frontend IncidentPage + TfWorkspace                     warroom/inc004/lab.sh
                       │  /api/incident/*                             │  preflight · plan · apply (guarded)
   backend: routes.js ─┴─ routes_tf_ec2.js (INC-004 only)             │  verify · capture · destroy
          │                     │                                     ▼
   timer.js (auto) ──► injector_tf_ec2.js ──► tf_ec2/engine.js   terraform (warroom/inc004/terraform, LOCAL state)
                         │ row-locked attempt   (pure reducer)        └─ module "lab" = deploy/aws-ec2 (the class stack)
                         │ + audit table          │
                         ▼                        └─ tf_ec2/evidence.js ◄── captured/ (redacted real outputs)
                 warroom_inc004_attempt / _audit
```

- **In simulation mode (the default for INC-004), no squad action reaches AWS.** The squad works against a deterministic simulation (`tf_ec2/engine.js`). INC-004 live mode and INC-005 instead drive one real, isolated AWS lab per squad through `warroom/inc004/squad/` (see [`SQUAD-OPERATED.md`](SQUAD-OPERATED.md)). Its evidence is either representative (`source: simulated`) or recorded from the real War Room lab by `lab.sh capture`, redacted to RFC 5737 documentation addresses and labelled `source: captured`. A student therefore cannot damage real infrastructure, and every squad gets the same run.
- **Attempts:**
  - each trigger opens one attempt (database-enforced: at most one active);
  - reset closes it;
  - every state change runs in a transaction that holds a row lock, so concurrent clicks serialise;
  - every action, including refused ones, is audited with the acting user.
- **API**, all under `/api/incident`, and only when `WAR_ROOM_INCIDENT=INC-004`:

  | Method and path | Who may call it | What it does |
  |---|---|---|
  | `GET /workspace` | signed-in user | the squad's view: actions, hypotheses, revealed evidence, timeline |
  | `POST /actions` | signed-in user | performs one action from an allow-list |
  | `POST /report` | signed-in user | files the incident report |
  | `GET /debrief` | instructor token | the full record, including the scoring key and the audit trail |

  Each squad call needs a session (otherwise 401). The instructor call needs the token (otherwise 403). Inputs are validated against own-property allow-lists, and error responses never leak internal detail.

## Terraform state and resource isolation

| Concern | How it is isolated |
|---|---|
| State | `warroom/inc004/terraform/terraform.tfstate`: **local**, git-ignored, the EC2 stack's own convention. `lab.sh` refuses to run if a `backend` block appears in either directory. It never reads or writes the EKS stack's S3 backend (`posturesec-terraform-state`, which is not in this account anyway) or the class stack's own `deploy/aws-ec2/terraform.tfstate`. |
| Names | environment `warroom` + owner `inc004` give every resource the name `postureblog-ec2-warroom-inc004*`. `lab.sh` refuses to create anything if resources with those names already exist outside this state. |
| Tags | `WarRoom=INC-004` and `CleanupEligible=true` are added to the stack's own `Project`, `Stack`, `Environment`, `Owner` and `ManagedBy` tags. |
| Account and region | The stack's provider refuses any account other than the declared one (`allowed_account_ids`). `lab.sh` also compares the caller to `WARROOM_EXPECTED_ACCOUNT_ID` before every command. Region is `us-east-1`. |
| What a plan may do | `plan-guard.js` refuses any plan beyond its operation. `lab.sh apply` only applies saved plans that passed the guard (see the table below). |

What the guard allows for each operation:

| Operation | Allowed |
|---|---|
| create | creates only, of the stack's 7 resource types, inside `module.lab`, all tagged |
| fault | only the port-80 rules change: exactly the VPN rule is created, and only the users' rule is removed |
| recover | exactly one port-80 rule is added |
| reset | exactly the VPN rule is removed |
| noop | no changes at all |
| destroy | deletes only, and every taggable resource must be tagged `INC-004` |

## Tests and evidence

**Current (2026-10-27/28):** the INC-004 and INC-005 targeted suites pass — 152/152 jest tests across the 11 `warroom_inc004*` / `warroom_inc005*` suites on a disposable Postgres (`bash scripts/warroom-test-local.sh 'tests/warroom_inc00[45]'`), War Room `terraform test` 9/9 (7 INC-004 + 2 INC-005), EC2 stack `terraform test` 12/12. The DB-backed live suites FAIL (not skip) without Postgres; `WARROOM_ALLOW_NO_DB=1` reports them as skipped.

**Real AWS rehearsals (2026-10-27, us-east-1, dedicated lab account, all resources destroyed and independently verified gone):** INC-004 live (squad alpha, recovered and scored, cleaned) and INC-005 (squad alpha, fault injected automatically, restored through Terraform, verified, scored, cleaned). Their run logs are instructor-only (`.operator/`) or local-only (git-ignored `evidence/*.log`).

The table below is the **historical INC-004 simulation baseline** (2026-10-27, before the live mode and INC-005; no AWS resources created). Its logs are local-only (`evidence/*.log` is git-ignored); [`evidence/`](evidence/) keeps the sanitized text records.

| Check | Untouched baseline (engine on `96e980d`, before INC-004) | This branch |
|---|---|---|
| Backend jest (disposable Postgres via `scripts/warroom-test-local.sh`) | 60 passed / 10 skipped / 0 failed | **97 passed / 10 skipped / 0 failed** (+27 INC-004, +10 plan guard) |
| EC2 stack `terraform test` (offline, mock provider) | 12 passed | **12 passed** (with `extra_tags`) |
| War Room `terraform test` (the stack with the War Room's inputs) | — | **5 passed** |
| Frontend build (`vite build`, CI=false) | — | pass |
| tfsec: `deploy/aws-ec2` and `warroom/inc004/terraform` | — | 0 problems, 0 ignored |
| Real **read-only** plan (`lab.sh plan baseline`) | — | 7 to add / 0 change / 0 destroy; guard ALLOWED; all taggable resources tagged `WarRoom=INC-004`, stack tags intact |
| Real containers (`WAR_ROOM_INCIDENT=INC-004 … ./warroom.sh up 7`, fuse 30 s) | — | **The alarm fired automatically** 30 s after boot, with no trigger. Anonymous workspace → 401; golden path over HTTP → score 100, status `resolved`; debrief without the token → 403, with it 15 audit rows. Instructor reset and trigger worked. Torn down: containers and volumes equal the before-snapshot; the 2 locally built images were removed. ([`evidence/E2E-http.txt`](evidence/E2E-http.txt)) |
| Browser (built-in, against the containers) | — | Signed in, then the banner, the brief and the workspace rendered. Two investigation clicks rendered evidence labelled `simulated`; status `down`. The only console error is the expected pre-sign-in 401. |
| Mutation checks (each must fail the suite) | — | M1 no row lock → 1 failed · M2 verification ignores console rules → 2 failed · M3 prototype keys resolve → 2 failed · M4 guard allows non-lab resources → 1 failed; all files restored (checksums) |

The 10 skipped tests are the two red-by-design remediation suites, `warroom_remediation` and `warroom_api4_remediation`. They are skipped in the baseline as well.

What the INC-004 tests pin:
- **Registration:** INC-004 is registered and uses the shared contract.
- **Automatic fuse:** it fires exactly once at 300 s, re-arming never doubles it, and cancel works.
- **Determinism:** the same actions give byte-identical state.
- **Investigation evidence:** a timeout from outside while the app is healthy inside; no drift between configuration, state and AWS.
- **The golden path** scores 100.
- **Every unsafe path and its consequence:**
  - a console rule is invisible to `terraform plan` and blocks the Terraform fix as a duplicate;
  - 0.0.0.0/0 fails verification on exposure;
  - replacing the instance loses the data and changes the address;
  - a "harmless" redeploy forces a replacement;
  - state surgery is refused.
- **Idempotency:** penalties count once; a re-apply is a no-op; a second report gets 409; there is a cap of 200 actions per attempt (429).
- **Input hardening:** unknown, prototype and non-string actions are rejected.
- **No leaks:** the squad view carries no answer key and no internal flags.
- **The captured-evidence loader.**
- **Over HTTP:**
  - authentication (401) and instructor authorisation (403);
  - the full run, audited per user;
  - reset, and a clean re-run with a new attempt;
  - concurrent clicks serialised;
  - the instructor override;
  - the application's own data is untouched.

## Known limitations

- **Real AWS runs are billable** (≈ $0.028/h per squad lab). Every lab has a 3 h lifetime cap and is destroyed automatically after completion or failure; the 2026-10-27 rehearsals left no resources.
- **INC-004 simulation evidence is simulated until a lab run is captured.** `lab.sh capture outage|restored` records real, redacted outputs, which then replace the simulated ones (labelled `captured`).
- **Students can read the scenario source.** The repository is public, and the incidents' code and tests are in it, as INC-001's injector is. Only the written answer material (`.operator/`) is kept out. Older history on `lab/feature/warroom-inc003` (commit `0942258`) still contains the INC-003 instructor notes that `56f2fa0` removed; they are already public on that branch.
- **The concurrency test depends on timing.** It caught the missing row lock when that was removed, but a race can pass by chance.
- **Squad network:** a squad's approved addresses must include its control plane's own egress address (the platform probes from there).
- **Live checks are slow:** each evidence view and each platform check takes ≈ 35–60 s (SSM and `terraform plan`); they never hold the squad lock.
