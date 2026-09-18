# Sprint 1 War Room — Squad Runbook (INC-001)

Your squad runs its own isolated copy of the PostureSec blogging platform. This
runbook does not tell you what is wrong. Finding that out is the exercise.

---

## 1. Start your environment

Your instructor gives you your **squad number**.

```bash
# from the folder your instructor gave you
./warroom.sh up <squad>      # builds and starts YOUR isolated app
./warroom.sh url <squad>     # prints your app URL and database port
```

Open the app URL (e.g. `http://localhost:808<squad>`). Sign in, write a post, add
a comment — get familiar with the platform while it is quiet.

## 2. Join your squad call

Join your squad's video call and share what you find as you go.

## 3. An incident will occur

A few minutes after you start, a security incident is detected. A red alert
appears across the top of the site. Click **Open incident** to read the brief.

## 4. Investigate

Use the engineering and security tools you already know. Everything a responder
needs is available to you:

- the application's request logs,
- the application's database,
- the application's source code,
- the git history.

Cross-reference them. Reproduce anything you claim, using **your own** test
accounts — never anyone else's data.

> **AI is allowed, but AI output is not evidence.** If a model proposes a theory,
> confirm it against the running application, its logs, its database and its
> source before you write it down.

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

Write your own tests to demonstrate this.

## 7. When you're done

Submit `INC-001-<squad>.md` with evidence for every answer. Leave your stack
running for the debrief, or stop it with `./warroom.sh down <squad>`.

Good hunting. 🛡️
