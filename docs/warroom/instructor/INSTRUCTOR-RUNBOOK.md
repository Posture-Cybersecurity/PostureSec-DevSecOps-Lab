# Sprint 1 War Room — INSTRUCTOR RUNBOOK (INC-001)

> **INSTRUCTOR ONLY. Do not hand this directory (`docs/warroom/instructor/`) to
> squads — it contains the answer, the attack path and the fix.** Give squads
> only the app and `docs/warroom/LEARNER-RUNBOOK.md`.

---

## 1. The incident, in one line

An authenticated blogging user modifies (and can delete) **another user's**
post. The server enforces *authentication* but not *object ownership*.

## 2. Exact vulnerability

**Broken object-level authorization (OWASP API1:2023 / BOLA / IDOR)** on:

- `PUT /api/posts/:id`  — `backend/src/routes/posts.js` (update handler)
- `DELETE /api/posts/:id` — `backend/src/routes/posts.js` (delete handler)
- `DELETE /api/comments/:id` — `backend/src/routes/comments.js` (delete handler)

Each route uses `requireAuth` (so the caller must be signed in) but runs the
`UPDATE`/`DELETE` **by id only**, never comparing the row's `owner_id` to
`req.user.id`. `owner_id` is written on create and then never checked. The
identity layer is otherwise sound (bcrypt, opaque server-side sessions,
HttpOnly/SameSite=strict cookie), which is the point: this is an **authorization**
failure, not an authentication one.

`backend/src/db.js` even foreshadows it: *"Whether a signed-in user MAY act on a
given object is a separate question, answered per-route — see routes/posts.js."*

## 3. Exact synthetic attack sequence (what the injector does)

`backend/src/warroom/injector.js`, using **real HTTP** to the app's own API with
two obviously-synthetic accounts (`alice.victim@warroom.local`,
`mallory.attacker@warroom.local`):

1. Register both synthetic users (idempotent; 409 tolerated).
2. **Victim** logs in and creates a post *"Q3 Threat Intelligence Briefing"* —
   `owner_id` = victim.
3. **Attacker** logs in (a legitimate session of their own).
4. **Attacker** sends `PUT /api/posts/<victim post id>` and overwrites the title
   and content. On the vulnerable code this returns **200** and the victim's post
   row — a genuine cross-user modification and disclosure.
5. The injector raises **INC-001** with a generic headline. Richer facts are kept
   in `warroom_incident.evidence` for you and are **not** served to learners.

No evidence is fabricated: every log line comes from the real logging middleware
observing real requests.

## 4. Evidence the squads should find

- **Access log** (`./warroom.sh logs <squad>` and the `warroom_access_log` table):
  a `PUT /api/posts/<id>` with `actor_user_id` = the **attacker**, status 200, at
  time T.
- **Posts table**: that post's `owner_id` = the **victim**, `updated_at` ≈ T,
  content changed. Owner ≠ editor is the tell.
- **Sessions table**: the acting session belongs to the attacker.
- **Source + git**: the three routes lack an ownership check.

Timestamps are in the access log (`ts`) and `posts.updated_at`. Attacker and
victim are established by joining `warroom_access_log.actor_user_id` → `users`,
and `posts.owner_id` → `users`.

## 5. Exact remediation

See `REMEDIATION.md` (in this folder) for the full diff. In short: in each of the
three handlers, load the row first, `404` if it does not exist, `403` if
`owner_id !== req.user.id` (allow `role = 'admin'` to override), then perform the
mutation. Server-side, before the write.

Target suite (red on the vulnerable code, green after the fix):

```bash
cd backend && npm run test:remediation
```

## 6. Running the exercise

```bash
# one squad (repeat per squad number 1..N; ports derive from the number)
export WAR_ROOM_INSTRUCTOR_TOKEN=<your secret>      # optional; a per-squad default is used otherwise
./warroom.sh up <squad>          # build + start the squad's isolated stack
./warroom.sh url <squad>         # app URL + ports + the squad's token
./warroom.sh status <squad>      # current alarm state
./warroom.sh trigger <squad>     # fire INC-001 now (does not wait for the fuse)
./warroom.sh reset <squad>       # restore the initial state
./warroom.sh logs <squad>        # tail the access log
./warroom.sh down <squad>        # stop + remove the stack AND its database volume
```

- **Fuse:** default 300s from start. Rehearse with `WAR_ROOM_INCIDENT_DELAY_SECONDS=30 ./warroom.sh up <squad>`.
- **Immediate trigger:** `./warroom.sh trigger <squad>` (needs the token).
- **Isolation:** each squad is its own Compose project
  (`posturesec-warroom-<squad>`) with its own volume and ports
  (HTTP `8080+squad`, DB `55950+squad`). `down` for one squad cannot touch
  another. Squad 1 cannot affect Squad 2.
- **Determinism:** `reset` then `trigger` reproduces the same sequence every time.

## 7. Debrief flow

1. Each squad presents their seven answers **with evidence**.
2. Reveal the three routes and the missing `owner_id` check.
3. Have a squad apply the fix live and run `npm run test:remediation` to green,
   then `./warroom.sh trigger` again to show the same attempt now returns **403**
   and the content is untouched — containment proven end to end.

## 8. Safety

Local-only, synthetic accounts only, no real data, no production, non-destructive
(`reset` removes only `@warroom.local` accounts and their content), fully
reversible, and isolated per squad. Nothing here touches the main PostureSec
platform stack.
