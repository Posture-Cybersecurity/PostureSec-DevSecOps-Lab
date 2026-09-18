# Sprint 1 War Room — INSTRUCTOR RUNBOOK (INC-001)

> **INSTRUCTOR ONLY. Do not give squads this directory (`docs/warroom/instructor/`)
> or `backend/tests/warroom_remediation.test.js`.** Build the student handout with
> `./scripts/make-student-handout.sh` — it excludes them automatically and fails
> if any leak. Squads get only the app, the scaffolding, `warroom.sh`, and
> `docs/warroom/LEARNER-RUNBOOK.md`.

---

## 0. The incident in one line

An **authenticated** blog user performs an **unauthorized** action against
**another user's** post/comment, because the server enforces *authentication* but
not *object ownership*.

---

## PRE-WAR-ROOM

**The student model is local.** Each squad runs the whole app on its **own
machine** with one command. There is no shared server, no instructor-hosted app,
no central database, no central timer, and no URL to hand out. Every squad uses
the same local address — `http://localhost:8080` — because each is on a different
laptop.

### What each squad receives (and does not)

- **Receive:** the student handout produced by `./scripts/make-student-handout.sh`
  — either the **folder** `dist/student-handout` or the **git bundle**
  `dist/sprint1-war-room-student.bundle` (the app + `warroom.sh` +
  `docs/warroom/LEARNER-RUNBOOK.md`).
- **Must NOT receive:** `docs/warroom/instructor/**` and
  `backend/tests/warroom_remediation.test.js` (this runbook, the remediation diff,
  the Fortify model, and the target test suite). The handout script strips these
  from BOTH the folder and the bundle and fails if either leaks.

### Build and distribute the student handout

```bash
cd <this repo checkout on feature/sprint1-war-room>
./scripts/make-student-handout.sh
# -> dist/student-handout/                     (a runnable folder)
# -> dist/sprint1-war-room-student.bundle      (a cloneable git bundle)
```

Give each squad the bundle (or a zip of the folder). Nothing else — no ports, no
URL, no token.

### What each squad's Team Lead does (exactly)

```bash
git clone sprint1-war-room-student.bundle warroom     # (or unzip the folder)
cd warroom
./warroom.sh up                                       # builds + starts locally
# -> "Your app is running at:  http://localhost:8080"
```

That is the whole setup. The fuse starts at `up`; the incident fires locally after
~5 minutes; the red banner appears on their own `http://localhost:8080`. Students
never need a squad number, a URL, or a token.

To re-run from scratch a squad does `./warroom.sh down && ./warroom.sh up`.

### Six squads = six laptops

Because each squad is on its own machine, ports do **not** need to be unique — all
six use `http://localhost:8080`. No coordination, no collisions, complete
isolation by virtue of separate machines and separate Docker runtimes.

### INSTRUCTOR REHEARSAL ONLY — several instances on one host (optional)

You do not need this for the class; it is only for testing multiple instances on a
single machine. Passing a squad number derives unique ports and enables the
trigger/reset controls:

```bash
export WAR_ROOM_INSTRUCTOR_TOKEN='<secret>'   # enables trigger/reset
./warroom.sh up 1 ; ./warroom.sh up 2 ; ...   # HTTP 8080+n, DB 55950+n, project posturesec-warroom-n
./warroom.sh trigger <n> ; ./warroom.sh reset <n>
```

---

## DURING WAR ROOM

### T+0 — what you say

> "Your squad now owns a running blogging platform. Treat it as production you are
> on call for. Explore it, create some content, get comfortable. Something may
> happen. When it does, work the incident and produce your seven answers with
> evidence."

Do **not** mention authorization, ownership, endpoints, or accounts.

### When the incident fires (auto at the fuse, or on your trigger)

> "You have an active incident, INC-001. Open it from the banner. Start your
> investigation. Remember: AI can suggest theories, but only the application's own
> evidence counts."

### What NOT to tell students

- Not "it's a BOLA / IDOR / broken access control / authorization bug."
- Not the endpoint, the method, the accounts, the user ids, or the fix.
- Not that the answer is "missing ownership check."

### Evidence students are expected to discover (unaided)

1. The request logs show a `PUT` (and, if you also want it, a `DELETE`) against a
   post, made by one account.
2. That post is **owned by a different account**.
3. The action **succeeded** (200) and the post's content changed / it was deleted.
4. The source shows the mutating routes check *who you are* but not *whether you
   own the object*.

### When to intervene / hint ladder (give the least that unblocks)

- **Stuck starting:** re-run `./warroom.sh up <squad>`; check Docker is running.
- **Hint 1 (find it):** "Compare who *made* each write with who *owns* the thing
  they wrote to."
- **Hint 2 (locate it):** "Read the code path that handles editing and deleting a
  post. What does it check before it runs the query?"
- **Hint 3 (fix shape):** "What must the server confirm about the caller and the
  object before allowing a change?"
- Never say "add an owner_id check" outright until the debrief.

---

## INCIDENT CONTROL (instructor)

```bash
./warroom.sh status  <squad>   # current alarm state (public)
./warroom.sh trigger <squad>   # fire INC-001 immediately (needs the token)
./warroom.sh logs    <squad>   # tail the backend access log (evidence)
./warroom.sh reset   <squad>   # restore the initial state (needs the token)
./warroom.sh down    <squad>   # stop + remove the stack AND its database volume
```

- **Fuse:** default 300s from `up`. Rehearse with
  `WAR_ROOM_INCIDENT_DELAY_SECONDS=30 ./warroom.sh up <squad>`.
- **Determinism:** `reset` then `trigger` reproduces the same sequence every time.

---

## EXPECTED INVESTIGATION

### Expected attack path

`alice.victim@warroom.local` creates a post (they own it) →
`mallory.attacker@warroom.local` signs in as themselves →
`mallory` sends `PUT /api/posts/<alice's post id>` (and the injector demonstrates
the same class on `DELETE /api/posts/:id` and `DELETE /api/comments/:id`) →
the server runs the update/delete **by id only** and returns 200.

### Expected root cause

Broken **object-level authorization** (OWASP API1:2023 — BOLA / IDOR) in
`backend/src/routes/posts.js` (`PUT /:id`, `DELETE /:id`) and
`backend/src/routes/comments.js` (`DELETE /:id`): `requireAuth` establishes
identity, but the handlers never compare the row's `owner_id` to `req.user.id`.
Authentication is correct; **authorization is missing**.

### Expected "What data was exposed?" — the exact factual answer

This is an **integrity** incident, **not a confidentiality breach**. Squads should
be able to establish this from the evidence:

- **Integrity — YES.** An authenticated non-owner can **overwrite** (`PUT`) and
  **destroy** (`DELETE`) another user's posts, and **delete** their comments. In
  the injected incident the victim's post title/content are replaced; the content
  genuinely changed (`updated_at` moves, the text differs).
- **Confidentiality — effectively NO.** Blog posts are already **public**: `GET
  /api/posts/:id` returns the full post (title, content, author, timestamps,
  `owner_id`) to an unauthenticated caller. The vulnerable `PUT` returns to the
  attacker only the row **after** their edit — i.e. their **own** submitted
  title/content plus non-secret metadata (`id`, `created_at`, `updated_at`,
  `owner_id`), every field of which is already available via the public `GET`. The
  victim's original content is **overwritten, not exfiltrated**. `DELETE` returns
  only `{message}`. No user PII (email, password hash) is exposed by any
  post/comment endpoint, and there is no private/draft resource in this app.
- **Nuance to reward:** a sharp squad notes the `PUT` response echoes `owner_id`
  (an internal user id) — but that is already public via `GET`, so it discloses
  nothing new. The correct headline is: *the incident compromised the integrity
  and authenticity of User B's content; it did not disclose data the attacker
  could not already read.*

Do **not** put this analysis anywhere learner-facing; let squads reach it.

### How many users were affected

In the injected incident, **one** victim's content was modified (the synthetic
`alice.victim`). But the *exposure* is platform-wide: **every** post and comment
is modifiable/deletable by **any** authenticated user, so the correct answer is
"one confirmed victim in this incident; all users' posts and comments are at risk
until the control is added."

### Expected containment

Short-term: revoke the offending session (`sessions` table), and/or take writes
offline (disable the mutating routes) until the fix ships. Containment is a
stopgap, not the fix.

### Expected remediation

Enforce ownership server-side in all three handlers — see `REMEDIATION.md` for the
exact diff. Load the row, `404` if missing, `403` if `owner_id !== req.user.id`
(allow `role='admin'`), then mutate.

### Expected validation

```bash
cd backend
npm run test:remediation   # red on the vulnerable code, green after the fix
npm test                   # base auth/health + scaffolding stay green
```

Then `./warroom.sh trigger <squad>` again: the attacker's `PUT` is now **403** and
the content is untouched — containment proven on the same evidence surface.

---

## DEBRIEF

### The exact answer

`PUT /api/posts/:id`, `DELETE /api/posts/:id`, `DELETE /api/comments/:id` enforced
authentication but not object ownership. Any signed-in user could edit or delete
any post/comment by id. Impact: **integrity** (tamper/destroy), not
confidentiality (the data was already public).

### Why authentication alone was insufficient

`requireAuth` answers *"who are you?"* (401 if unknown). It says nothing about
*"may you act on THIS object?"* Knowing a valid session belongs to a real user
does not make that user the owner of post #7. The app proved identity and then
skipped the ownership question entirely.

### Why object-level authorization matters

Almost every multi-tenant/multi-user feature has per-object rules. The number one
API risk (OWASP API1) is exactly this: endpoints that trust an object id from the
request and act on it without checking the caller owns it. It is invisible to
authentication tests and to the happy path — the owner's own requests always work.

### The server-side control that should exist

Before any state change on an object: fetch the object, confirm it exists (404
otherwise), confirm the caller is the owner (or holds a role that may act), then
proceed. Never trust the client to send only its own ids; never enforce this only
in the UI.

### Positive vs negative tests

- **Positive** tests prove the feature still works for the legitimate case (owner
  edits own post → 200). They pass both before and after the fix, so alone they
  would have **missed** this bug.
- **Negative** tests prove the boundary holds (non-owner edits another's post →
  403). This is the test that was missing and that catches the class. Teach squads
  that "it works" is not "it's safe" — every ownership rule needs a negative test.

### Lessons learned

- Authenticate, then **authorize per object** — they are different questions.
- Add a **negative** test for every ownership rule.
- Enforce on the **server**; the UI is not a security boundary.
- Public-by-design data (blog posts) shifts the impact to **integrity** — reason
  about C, I and A separately rather than saying "data was exposed."

---

## SAFETY

Local-only, synthetic `@warroom.local` accounts, no real data, no production, no
external targets. `reset` removes only synthetic accounts and their content, in
one squad's database, transactionally. Everything is reversible and per-squad
isolated. Nothing here touches the main PostureSec platform stack.
