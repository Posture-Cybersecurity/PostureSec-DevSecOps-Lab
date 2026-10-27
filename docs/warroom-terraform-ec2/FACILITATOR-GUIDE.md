# INC-004 facilitator guide (spoiler-free)

This guide covers how to run the exercise. The root cause, the expected investigation sequence and the interpretation of each output are in the answer key, `warroom/inc004/.operator/ANSWER-KEY.md`. That file is git-ignored and distributed to instructors separately. **Do not commit it and do not share it with squads.**

## Learning objectives

Squads should be able to:

1. Separate *the application is healthy* from *the application is reachable*, using evidence from each layer.
2. Read a Terraform plan and recognise when an "add one, destroy one" plan removes access someone depends on.
3. Tell apart what the Terraform **configuration** says, what the **state** records, what **AWS** runs, and what the **instance** does. Know what `terraform plan` can and cannot see.
4. Prefer a reviewed Terraform change over a console fix, and explain why the console fix is worse even when it works.
5. Verify the recovery from the users' side, and write a short incident report with a preventive control.

## Timing (about 15 minutes per squad)

| Minutes | What happens |
|---|---|
| 0–2 | Squads start the app, register, and read the brief. The fuse is armed. |
| 2–7 | The alarm fires automatically (default 300 s after boot). Squads have about 5 minutes of investigation and recovery. |
| 7–10 | Verification and the report. The score appears on completion. |
| 10–15 | Debrief, using the instructor debrief view and the answer key. |

## Before class

- **Rehearse locally:** `WAR_ROOM_INCIDENT=INC-004 WAR_ROOM_INCIDENT_DELAY_SECONDS=30 WAR_ROOM_INSTRUCTOR_TOKEN=<token> ./warroom.sh up`.
- **Optional real demonstration:** deploy the War Room EC2 lab and show the real outage and recovery with `RUNBOOK.md`. Run `lab.sh capture outage` and `lab.sh capture restored`, so squads see captured outputs instead of simulated ones. Review the captured files before committing them.
- Have the answer key open on the instructor machine only.

## During the exercise

| Need | Command |
|---|---|
| Fire it now (for squads who missed the fuse) | `./warroom.sh trigger <n>` or `POST /api/incident/trigger` with `x-warroom-token` |
| See a squad's full record: actions, score, flags, audit trail | `GET /api/incident/debrief` with the token |
| Mark progress for the debrief | `POST /api/incident/status/contained` (or `resolved`) with the token |
| Run it again | `./warroom.sh reset <n>` (closes the attempt). The next trigger opens a fresh, isolated attempt. |

## Facilitation notes

- Squads that act before they investigate learn a lot from their own penalties. Let them, then ask in the debrief why it happened.
- If a squad is stuck, ask a question rather than giving a hint:
  - "What is the difference between a timeout and a refusal?"
  - "Where would you see what changed, and who changed it?"
- The debrief view shows whether the plan was reviewed before it was applied. Make that a debrief point.

## Rubric shape (the weights are in `backend/src/warroom/tf_ec2/scenario.js`)

| Area | Points |
|---|---|
| Evidence from the symptom, platform and change layers | 30 (10 per layer) |
| Correct root cause | 30 |
| Recovery through Terraform: plan reviewed 20, not reviewed 15 | 20 |
| Verification passed | 10 |
| Report summary of 40 characters or more | 10 |

Unsafe actions are penalised once each, and the score cannot go below 0.

## Debrief prompts

- What did each layer tell you, and which layer told you the truth about users?
- What can `terraform plan` not see, and what does that mean for console changes?
- What review, test or policy would have caught this change before it shipped?
