# INC-001 Incident Report — Delta

## Executive summary

This incident was a server-side authorization failure on the PostureSec blogging platform. A user who was authenticated successfully was able to update a post that belonged to a different user. The root cause was object-level authorization missing from the update and delete routes for posts and comments.

The vulnerable behavior was reproduced from the live application, confirmed in the database, and then fixed by enforcing owner checks before mutation. The fix was validated with both command-line curl reproduction and a focused Jest proof suite.

---

## What happened?

An authenticated attacker account modified content that belonged to a different user. The live access log shows the exact sequence:

- victim creates a post as `alice.victim@warroom.local`
- attacker logs in as `mallory.attacker@warroom.local`
- attacker sends a `PUT /api/posts/1` request
- the request succeeded with status `200`
- the incident alarm fired: `INC-001`

Evidence from the application log:

```text
warroom-local-backend  | [access] {"ts":"2026-09-19T08:59:55.353Z","requestId":"req_5b5474a7b1ac9c47c45d2edc","method":"POST","path":"/api/posts","status":201,"actorUserId":1,"actorEmail":"alice.victim@warroom.local","sessionFp":"5ef55b52","ip":"127.0.0.1","durationMs":2}
warroom-local-backend  | [access] {"ts":"2026-09-19T08:59:55.458Z","requestId":"req_f3344bdf2160fc814c40f9c2","method":"POST","path":"/api/auth/login","status":200,"actorUserId":null,"actorEmail":null,"sessionFp":null,"ip":"127.0.0.1","durationMs":101}
warroom-local-backend  | [access] {"ts":"2026-09-19T08:59:55.472Z","requestId":"req_5b397290f15f5a04f88ee0b1","method":"PUT","path":"/api/posts/1","status":200,"actorUserId":2,"actorEmail":"mallory.attacker@warroom.local","sessionFp":"94d3588a","ip":"127.0.0.1","durationMs":6}
warroom-local-backend  | [warroom] INC-001 fired: {"skipped":false,"post_id":1,"victim_user_id":1,"attacker_user_id":2,"tamper_status":200,"cross_user":true,"succeeded":true,"content_changed":true}
```

---

## How did it happen?

The bug was in the server route logic for post updates and deletions. The route required authentication but never checked whether the caller owned the post before mutating it.

Relevant code:

- [backend/src/routes/posts.js](backend/src/routes/posts.js)
- [backend/src/routes/comments.js](backend/src/routes/comments.js)
- [backend/src/middleware/authenticate.js](backend/src/middleware/authenticate.js)

Before the fix, the update route looked like this conceptually:

```js
router.put('/:id', requireAuth, async (req, res) => {
  const { title, content, author, emoji } = req.body;
  const result = await pool.query(
    `UPDATE posts
     SET title = $1, content = $2, author = $3, emoji = $4, updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [title, content, author || 'Anonymous', emoji || '🛡️', req.params.id]
  );
});
```

There was no `owner_id` comparison, no `WHERE owner_id = req.user.id`, and no `403 Forbidden` denial. Authentication only answered, “Who are you?” but not, “Are you allowed to touch this resource?”

The database schema also had the correct ownership column already present:

```sql
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
```

and the application was creating posts with `owner_id = req.user.id` in the create route. The update/delete routes simply ignored that relationship.

---

## What data was exposed?

This incident was primarily an integrity issue rather than a broad data leak. The content belonging to the victim user was overwritten by another authenticated user.

Live database evidence after the incident:

```text
 id | owner_id | title                                 | author     | content
----+----------+---------------------------------------+------------+------------------------------------------------------------
  1 |        1 | Q3 Threat Intelligence Briefing [EDITED] | A. Victim | This content was replaced by an account that did not author the post.
```

The compromised object was the victim’s post content. The attacker was able to tamper with a record that they did not own.

---

## How many users were affected?

The incident involved two users in the live app:

- `alice.victim@warroom.local` — victim / owner of the post
- `mallory.attacker@warroom.local` — attacker / acting user

Directly affected: 1 user (the victim)

The attack did not expose an entire user table or a mass data set; it modified a specific user-owned object.

---

## Can we reproduce it?

Yes. I reproduced it using curl against the live app at `http://localhost:8080` before the fix.

### Reproduction flow

```bash
# login as victim
curl -sS -c /tmp/posturesec-victim.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice.victim@warroom.local","password":"warroom-victim-passphrase-01"}' \
  http://localhost:8080/api/auth/login

# create victim post
curl -sS -b /tmp/posturesec-victim.txt \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8080/api/posts \
  -d '{"title":"Q3 Threat Intelligence Briefing","content":"Internal draft — indicators of compromise for the Q3 review. Owned by the author.","author":"A. Victim","emoji":"🛡️"}'

# login as attacker
curl -sS -c /tmp/posturesec-attacker.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"mallory.attacker@warroom.local","password":"warroom-attacker-passphrase-01"}' \
  http://localhost:8080/api/auth/login

# unauthorized edit of victim post
curl -sS -D /tmp/attacker-edit.headers \
  -o /tmp/attacker-edit.out \
  -b /tmp/posturesec-attacker.txt \
  -H 'Content-Type: application/json' \
  -X PUT http://localhost:8080/api/posts/1 \
  -d '{"title":"Q3 Threat Intelligence Briefing [EDITED]","content":"This content was replaced by an account that did not author the post.","author":"A. Victim","emoji":"🛡️"}'
```

Observed result before the fix:

```text
HTTP 200
{"title":"Q3 Threat Intelligence Briefing [EDITED]",...}
```

This confirmed the cross-user write vulnerability.

---

## How do we contain it?

Containment is a short-term operational step: stop the vulnerable write path and revoke active sessions while preserving forensic evidence.

### Containment steps used in terminal

```bash
docker compose -f docker-compose.warroom.yml stop backend frontend
```

If you need to preserve evidence before cleanup:

```bash
docker exec -i warroom-local-db pg_dump -U posturesec_user posturesec_db > incident-before-fix.sql
```

To revoke active sessions at the DB level:

```bash
docker exec -i warroom-local-db psql -U posturesec_user -d posturesec_db \
  -c "UPDATE sessions SET revoked_at = NOW();"
```

This prevents further misuse while we ship the server-side fix.

---

## How do we fix it?

The fix is to enforce object-level authorization on all write operations involving user-owned content.

### Correct server-side behavior

Before allowing a post update or delete:

1. fetch the row by id
2. ensure it exists
3. compare `row.owner_id` to `req.user.id`
4. return `403 Forbidden` if they do not match
5. only then allow the mutation

The fix was implemented in:

- [backend/src/routes/posts.js](backend/src/routes/posts.js)
- [backend/src/routes/comments.js](backend/src/routes/comments.js)

The crucial logic is:

```js
const existing = await pool.query(
  'SELECT id, owner_id FROM posts WHERE id = $1',
  [req.params.id]
);

if (existing.rows.length === 0) {
  return res.status(404).json({ error: 'Post not found' });
}

if (existing.rows[0].owner_id !== req.user.id) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

and the update/delete SQL is guarded by `owner_id = req.user.id`.

---

## Proof of the fix

The fix was validated using both curl-based reproduction and the project test suite.

### A) Positive proof — owner can still do the legitimate thing to their own content

```bash
curl -sS -c /tmp/victim.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice.victim@warroom.local","password":"warroom-victim-passphrase-01"}' \
  http://localhost:8080/api/auth/login

curl -sS -b /tmp/victim.txt \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:8080/api/posts \
  -d '{"title":"My Post","content":"Body","author":"A. Victim","emoji":"🛡️"}'

curl -sS -b /tmp/victim.txt \
  -H 'Content-Type: application/json' \
  -X PUT http://localhost:8080/api/posts/1 \
  -d '{"title":"My Post v2","content":"Updated by owner","author":"A. Victim","emoji":"🛡️"}'
```

Expected result: `HTTP 200` and the updated post contents are returned.

### B) Negative proof — user cannot do it to someone else’s content

```bash
curl -sS -c /tmp/attacker.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"mallory.attacker@warroom.local","password":"warroom-attacker-passphrase-01"}' \
  http://localhost:8080/api/auth/login

curl -sS -D /tmp/attacker-edit.headers \
  -o /tmp/attacker-edit.body \
  -b /tmp/attacker.txt \
  -H 'Content-Type: application/json' \
  -X PUT http://localhost:8080/api/posts/1 \
  -d '{"title":"Edited by attacker","content":"This should not be allowed","author":"A. Victim","emoji":"🛡️"}'
```

Observed result after fix:

```text
HTTP 403 Forbidden
{"error":"Forbidden"}
```

The post remained unchanged.

### C) Regression proof — normal blogging still works

```bash
curl -sS http://localhost:8080/api/posts
```

Expected result: `HTTP 200` with the posts list still available to the public.

### D) Security proof — unauthenticated caller is refused and the server denies the bad action

```bash
curl -sS -D /tmp/anon.headers \
  -o /tmp/anon.body \
  -H 'Content-Type: application/json' \
  -X PUT http://localhost:8080/api/posts/1 \
  -d '{"title":"Nope","content":"Unauthorized"}'
```

Expected result:

```text
HTTP 401 Unauthorized
{"error":"Authentication required"}
```

This confirms the server refuses anonymous access, and the server also refuses the bad cross-user action.

---

## Test suite added

I added a focused proof suite to the backend tests:

- [backend/tests/incident_proof.test.js](backend/tests/incident_proof.test.js)

It covers the four required cases:

- positive owner update works
- different user cannot update another user’s post
- unauthenticated user is refused
- regression: public reads / normal blogging still work

Command run:

```bash
cd backend && npx jest tests/incident_proof.test.js --runInBand --forceExit
```

Result:

```text
PASS tests/incident_proof.test.js
  incident proof: object-level authorization
    ✓ positive: owner can update own post
    ✓ negative: different user cannot modify someone else's post
    ✓ security: unauthenticated caller is refused
    ✓ regression: public reads and normal blogging still work
```

---

## Final conclusion

The incident was caused by a failure to enforce object ownership on server-side writes. It was reproduced, contained, fixed, and re-tested. The application now enforces the correct rule:

- a logged-in user may modify their own content
- a different user cannot modify someone else’s content
- unauthenticated callers are rejected
- normal public read and owner write flows still work

This is the root-cause fix required by the runbook and is now supported by code, logs, DB evidence, and proof tests.
