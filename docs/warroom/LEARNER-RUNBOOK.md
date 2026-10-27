# Sprint 1 War Room — Squad Runbook (INC-001)

Your squad runs the **entire** PostureSec blogging platform **on your own
machine**. Nothing is shared with other squads and nothing depends on a server
your instructor runs. This runbook does not tell you what is wrong — finding that
out is the exercise.

---

## 0. What you need

- **Docker Desktop** installed and running.
- **git**.
- The War Room code from your instructor (a git bundle or a folder).

## 1. Get the code (Team Lead)

If your instructor gave you a **git bundle**:

```bash
git clone sprint1-war-room-student.bundle warroom
cd warroom
```

If your instructor gave you a **folder**, just open a terminal in it.

## 2. Start the app locally (Team Lead) — one command

```bash
./warroom.sh up
```

This builds and starts everything on your machine (app, API, and its own
throwaway database). When it finishes it prints:

```
Your app is running at:  http://localhost:8080
```

Open **http://localhost:8080**. It is the same address on every squad's machine —
there is no URL to wait for. Sign in, write a post, add a comment, and get
familiar with the platform while it is quiet.

> Everything is local: the timer, the database, and the app all run in Docker on
> your laptop. You never need a token, a squad number, or a link from anyone.

## 3. An incident will occur

About five minutes after you start, a security incident is detected on your local
app. A red alert appears across the top of the site. Click **Open incident** to
read the brief.

## 4. Investigate — on your own machine

Use the engineering and security tools you already know. Everything a responder
needs is right there on your laptop:

- the application's request logs,
- the application's database,
- the application's source code,
- the git history.

Cross-reference them. Reproduce anything you claim, using **your own** test
accounts — never anyone else's data.

> **AI is allowed, but AI output is not evidence.** Confirm every theory against
> the running application, its logs, its database and its source before you write
> it down.

## 5. Produce your answers

Your deliverable is `INC-001-<squad>.md`. Answer every question and cite the
evidence (a log line, a query result, a file and line, a commit) for each.

```markdown
# INC-001 Incident Report — Squad <n>

## What happened?
## How did it happen?
## What data was exposed?
## How many users were affected?
## Can we reproduce it?
## How do we contain it?
## How do we fix it?
```

## 6. Contain, fix, and prove it

- **Contain** the incident, then **fix the root cause** in the application,
  server-side. A change only in the browser or the user interface is not a fix.
- **Prove your fix** with evidence for all four:
  - **Positive** — a user can still do the legitimate thing to their **own** content.
  - **Negative** — a user **cannot** do it to **someone else's** content.
  - **Regression** — normal blogging still works.
  - **Security** — an unauthenticated caller is refused, and the bad action is
    refused **by the server**.

Write your own tests to demonstrate this. (The blog's own test suite runs with
`cd backend && npm test`.)

## 7. Re-running or stopping

- **Re-run the incident from scratch:** `./warroom.sh down` then `./warroom.sh up`
  (a fresh app, a fresh database, a fresh five-minute fuse).
- **Stop for the day:** `./warroom.sh down` (removes the app and its local
  database).

Good hunting. 🛡️
