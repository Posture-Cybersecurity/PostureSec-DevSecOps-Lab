# Sprint 1 War Room — Squad Runbook (INC-001)

Your squad runs its own isolated copy of the PostureSec blogging platform. A few
minutes after you start it, a security incident will be detected. Your job is to
run the investigation, contain it, fix it, and prove your fix — using the
application's own evidence.

This runbook does not tell you what the vulnerability is. Finding that out is the
exercise.

---

## 1. Start your squad's platform

Your instructor gives you your **squad number** and your **instructor token**.

```bash
# from the repository root
./warroom.sh up <squad>       # builds and starts YOUR isolated stack
./warroom.sh url <squad>      # prints your app URL, API and database port
```

Open the app URL (e.g. `http://localhost:808<squad>`). It should look like a
normal blogging platform. Create an account, write a post, add a comment — get
familiar with it while it is quiet.

**Roughly five minutes after start, an incident fires automatically.** A red
alert appears across the top of the site. Click **Open incident** to read the
brief.

> Your instructor can also trigger it on demand, and reset it. You do not need
> the instructor token for the investigation.

---

## 2. Investigate

The incident brief states a symptom only. Establish the facts yourself. You have
everything a real responder would:

| Source | How to reach it |
|---|---|
| **Request logs** | `./warroom.sh logs <squad>` (backend stdout), and the `warroom_access_log` table in your database |
| **Database** | `psql` to your squad's DB port (user `posturesec_user`, db `posturesec_db`) — tables `users`, `sessions`, `posts`, `comments` |
| **Source code** | `backend/src/` and `frontend/src/` in this repository |
| **Git history** | `git log`, `git blame` on the files you suspect |
| **Security tooling** | whatever your squad already uses (linters, `npm audit`, manual review) |

Cross-reference the sources. A single table or a single log line rarely tells the
whole story; the truth is in how they line up.

> **AI is allowed, but AI output is not evidence.** If a model proposes a theory,
> confirm it against the running application, the logs, the database and the
> source before you write it down. An unverified AI claim in your report counts
> against you, not for you.

---

## 3. Answer these — with evidence

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

For **Can we reproduce it?** include the exact requests you made and the
responses you got. Reproduce with your own two test accounts — never with anyone
else's data.

---

## 4. Contain, then fix

- **Contain** first: state the immediate action that stops the bleeding, and why
  it is a stopgap rather than a fix.
- **Fix** the root cause in the application, server-side. A change only in the
  browser, or only in the user interface, is not a fix.

## 5. Prove your fix

Your fix must satisfy all four, and you must show the evidence:

- **Positive** — a user can still do the legitimate thing to their **own** content.
- **Negative** — a user **cannot** do it to **someone else's** content.
- **Regression** — normal blogging (sign in, post, comment, read) still works.
- **Security** — an unauthenticated caller is refused, and the cross-user action
  is refused **by the server**, not just hidden in the UI.

There is a test suite that encodes the target behaviour. Ask your instructor when
to run it; when your fix is right, it goes green:

```bash
cd backend && npm run test:remediation
```

Keep the existing suite green too:

```bash
cd backend && npm test
```

---

## 6. When you're done

- Submit `INC-001-<squad>.md` with evidence for every answer.
- Leave your stack running for the debrief, or stop it with
  `./warroom.sh down <squad>` (this also removes your squad's database).

Good hunting. 🛡️
