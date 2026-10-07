# Security Audit/Authorization Remediation: Post and Comment Object Access

## Executive summary

Three high-severity broken access control vulnerabilities were identified and reproduced in the PostureSec API:

1. Any authenticated user could update another user's post.
2. Any authenticated user could delete another user's post.
3. Any authenticated user could delete another user's comment.

The root cause was that the routes enforced authentication with `requireAuth`, but did not enforce object-level authorization against the authenticated user's `owner_id`.

The fixes were implemented on:

```text
Branch: lab/s0-06-simulation
Repository: /home/prince-maxwell/PostureSec-DevSecOps-Lab
```

The corrected behavior is owner-only access:

- Owners can update or delete their own objects.
- Authenticated non-owners receive `404 Not Found`.
- Unauthorized users cannot modify or delete another user's data.
- No database migration is required because `owner_id` already exists and is populated during object creation.

---

## Vulnerability 1: Unauthorized post modification

### Classification

- **Category:** Broken Access Control / IDOR
- **Severity:** High
- **Affected endpoint:** `PUT /api/posts/:id`
- **Affected file:** `backend/src/routes/posts.js`
- **Affected code before remediation:** Lines 77–81

### Vulnerability

The route required the caller to be authenticated, but the SQL update filtered only on the post ID:

```js
UPDATE posts
SET title = $1, content = $2, author = $3, emoji = $4, updated_at = NOW()
WHERE id = $5
RETURNING *
```

Authentication established who the caller was, but no authorization check verified that the caller owned the post.

### Impact

Any registered user with a valid session could:

- Modify another user's post.
- Change the title and content.
- Change the displayed author.
- Change the emoji.
- Tamper with security-related content.
- Spoof authorship.

This was a horizontal privilege escalation because one normal user could operate on another normal user's object.

### Reproduction before the fix

Assume:

```bash
BASE_URL=http://localhost:5000
```

Alice creates a post:

```bash
POST=$(curl -sS -X POST "$BASE_URL/api/posts" \
  -b alice.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "title":"Authorization test post",
    "content":"Original content owned by Alice",
    "author":"Alice",
    "emoji":"🔐"
  }')

echo "$POST" | jq
POST_ID=$(echo "$POST" | jq -r '.id')
printf 'POST_ID=%s\n' "$POST_ID"
```

Bob updates Alice's post using Bob's session:

```bash
curl -i -sS -X PUT "$BASE_URL/api/posts/$POST_ID" \
  -b bob.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "title":"Bob unauthorized update",
    "content":"Bob changed Alice's post",
    "author":"Bob",
    "emoji":"🚨"
  }'
```

### Vulnerable result

```http
HTTP/1.1 200 OK
```

The response contained Bob's modified values even though the post's `owner_id` belonged to Alice.

---

## Fix for unauthorized post modification

The update query was changed in `backend/src/routes/posts.js` to include an ownership predicate:

```js
const result = await pool.query(
  `UPDATE posts 
   SET title = $1, content = $2, author = $3, emoji = $4, updated_at = NOW() 
   WHERE id = $5
     AND owner_id = $6
   RETURNING *`,
  [
    title,
    content,
    author || 'Anonymous',
    emoji || '🛡️',
    req.params.id,
    req.user.id,
  ]
);
```

The authorization condition is:

```sql
AND owner_id = $6
```

where `$6` is:

```js
req.user.id
```

### Corrected behavior

A user can update a post only when:

```text
posts.id = requested post ID
AND posts.owner_id = authenticated user ID
```

If the caller does not own the post, the query returns no rows and the route returns:

```http
HTTP/1.1 404 Not Found
```

### Reproduction after the fix

Bob repeats the unauthorized update:

```bash
curl -i -sS -X PUT "$BASE_URL/api/posts/$POST_ID" \
  -b bob.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "title":"Bob unauthorized update",
    "content":"Bob must not be able to change Alice's post",
    "author":"Bob",
    "emoji":"🚨"
  }'
```

Expected result:

```http
HTTP/1.1 404 Not Found
```

Verify that the post remains unchanged:

```bash
curl -sS "$BASE_URL/api/posts/$POST_ID" | jq
```

The original Alice-owned values must remain intact.

Alice can still update her own post:

```bash
curl -i -sS -X PUT "$BASE_URL/api/posts/$POST_ID" \
  -b alice.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "title":"Alice authorized update",
    "content":"Alice can update her own post",
    "author":"Alice",
    "emoji":"✅"
  }'
```

Expected result:

```http
HTTP/1.1 200 OK
```

---

## Vulnerability 2: Unauthorized post deletion

### Classification

- **Category:** Broken Access Control / IDOR
- **Severity:** High
- **Affected endpoint:** `DELETE /api/posts/:id`
- **Affected file:** `backend/src/routes/posts.js`
- **Affected code before remediation:** Line 98 in the original implementation

### Vulnerability

The original delete query filtered only by post ID:

```js
DELETE FROM posts WHERE id = $1 RETURNING *
```

There was no check that the authenticated user owned the post or had a privileged moderation role.

### Impact

Any authenticated user could:

- Permanently delete another user's post.
- Remove security content owned by another user.
- Trigger cascading deletion of associated comments.

The comments table references posts with `ON DELETE CASCADE`, so unauthorized post deletion could also destroy related comments.

### Reproduction before the fix

Alice creates a post:

```bash
DELETE_POST=$(curl -sS -X POST "$BASE_URL/api/posts" \
  -b alice.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "title":"Post deletion authorization test",
    "content":"Bob must not delete this post",
    "author":"Alice",
    "emoji":"🗑️"
  }')

echo "$DELETE_POST" | jq
DELETE_POST_ID=$(echo "$DELETE_POST" | jq -r '.id')
printf 'DELETE_POST_ID=%s\n' "$DELETE_POST_ID"
```

Bob deletes Alice's post:

```bash
curl -i -sS -X DELETE "$BASE_URL/api/posts/$DELETE_POST_ID" \
  -b bob.cookies
```

### Vulnerable result

```http
HTTP/1.1 200 OK
```

The post was deleted even though Bob was not its owner.

---

## Fix for unauthorized post deletion

The delete query was changed in `backend/src/routes/posts.js` to:

```js
const result = await pool.query(
  'DELETE FROM posts WHERE id = $1 AND owner_id = $2 RETURNING *',
  [req.params.id, req.user.id]
);
```

The critical authorization condition is:

```sql
AND owner_id = $2
```

where `$2` is the authenticated user ID.

### Corrected behavior

Only the post owner can delete the post:

```text
posts.id = requested post ID
AND posts.owner_id = authenticated user ID
```

A non-owner receives:

```http
HTTP/1.1 404 Not Found
```

The post and its comments remain intact.

### Reproduction after the fix

Create a fresh Alice-owned post and capture its ID:

```bash
DELETE_POST=$(curl -sS -X POST "$BASE_URL/api/posts" \
  -b alice.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "title":"Post deletion retest",
    "content":"Bob must not delete this post",
    "author":"Alice",
    "emoji":"🗑️"
  }')

echo "$DELETE_POST" | jq
DELETE_POST_ID=$(echo "$DELETE_POST" | jq -r '.id')
```

Bob attempts the deletion:

```bash
curl -i -sS -X DELETE "$BASE_URL/api/posts/$DELETE_POST_ID" \
  -b bob.cookies
```

Expected result:

```http
HTTP/1.1 404 Not Found
```

Verify that the post still exists:

```bash
curl -i -sS "$BASE_URL/api/posts/$DELETE_POST_ID"
```

Expected result:

```http
HTTP/1.1 200 OK
```

Alice can delete her own post:

```bash
curl -i -sS -X DELETE "$BASE_URL/api/posts/$DELETE_POST_ID" \
  -b alice.cookies
```

Expected result:

```http
HTTP/1.1 200 OK
```

---

## Vulnerability 3: Unauthorized comment deletion

### Classification

- **Category:** Broken Access Control / IDOR
- **Severity:** High
- **Affected endpoint:** `DELETE /api/comments/:id`
- **Affected file:** `backend/src/routes/comments.js`
- **Affected code before remediation:** Line 49 in the original implementation

### Vulnerability

The original comment deletion query used only the comment ID:

```js
DELETE FROM comments WHERE id = $1 RETURNING *
```

Although comments were created with an `owner_id`, that value was not used to authorize deletion.

### Impact

Any authenticated user could:

- Delete another user's comment.
- Remove legitimate security discussion.
- Censor or tamper with user-generated content.

### Reproduction before the fix

Alice creates a post:

```bash
POST=$(curl -sS -X POST "$BASE_URL/api/posts" \
  -b alice.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "title":"Comment authorization test",
    "content":"Comment ownership test",
    "author":"Alice",
    "emoji":"💬"
  }')

echo "$POST" | jq
POST_ID=$(echo "$POST" | jq -r '.id')
```

Alice creates a comment. This quoting format safely expands the numeric `POST_ID`:

```bash
COMMENT=$(curl -sS -X POST "$BASE_URL/api/comments" \
  -b alice.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "post_id": '"$POST_ID"',
    "author":"Alice",
    "content":"This comment must remain owned by Alice"
  }')

echo "$COMMENT" | jq
COMMENT_ID=$(echo "$COMMENT" | jq -r '.id')
printf 'COMMENT_ID=%s\n' "$COMMENT_ID"
```

Bob deletes Alice's comment:

```bash
curl -i -sS -X DELETE "$BASE_URL/api/comments/$COMMENT_ID" \
  -b bob.cookies
```

### Vulnerable result

```http
HTTP/1.1 200 OK
```

The comment was deleted even though Bob was not its owner.

---

## Fix for unauthorized comment deletion

The delete query was changed in `backend/src/routes/comments.js` to:

```js
const result = await pool.query(
  'DELETE FROM comments WHERE id = $1 AND owner_id = $2 RETURNING *',
  [req.params.id, req.user.id]
);
```

The critical authorization condition is:

```sql
AND owner_id = $2
```

where `$2` is the authenticated user ID.

### Corrected behavior

Only the comment owner can delete the comment.

A non-owner receives:

```http
HTTP/1.1 404 Not Found
```

The comment remains available.

### Reproduction after the fix

Create an Alice-owned comment:

```bash
COMMENT=$(curl -sS -X POST "$BASE_URL/api/comments" \
  -b alice.cookies \
  -H 'Content-Type: application/json' \
  --data '{
    "post_id": '"$POST_ID"',
    "author":"Alice",
    "content":"This comment must remain owned by Alice"
  }')

echo "$COMMENT" | jq
COMMENT_ID=$(echo "$COMMENT" | jq -r '.id')
```

Bob attempts to delete it:

```bash
curl -i -sS -X DELETE "$BASE_URL/api/comments/$COMMENT_ID" \
  -b bob.cookies
```

Expected result:

```http
HTTP/1.1 404 Not Found
```

Verify that the comment remains:

```bash
curl -sS "$BASE_URL/api/comments/post/$POST_ID" | jq
```

The response must still contain the comment with ID `$COMMENT_ID`.

Alice can delete her own comment:

```bash
curl -i -sS -X DELETE "$BASE_URL/api/comments/$COMMENT_ID" \
  -b alice.cookies
```

Expected result:

```http
HTTP/1.1 200 OK
```

Verify that the comment is removed:

```bash
curl -sS "$BASE_URL/api/comments/post/$POST_ID" | jq
```

The deleted comment ID should no longer be present.

---

## Validation matrix

| Operation | Non-owner result | Owner result | Corrected status |
|---|---:|---:|---|
| Update post | `404 Not Found` | `200 OK` | Fixed |
| Delete post | `404 Not Found` | `200 OK` | Fixed |
| Delete comment | `404 Not Found` | `200 OK` | Fixed |

## Deployment and runtime verification

The source changes must be deployed and the backend restarted from the intended checkout:

```bash
cd /home/prince-maxwell/PostureSec-DevSecOps-Lab
git branch --show-current
```

Expected branch:

```text
lab/s0-06-simulation
```

Confirm the source contains the ownership predicates:

```bash
grep -n -A12 -B3 "UPDATE posts" backend/src/routes/posts.js
grep -n "DELETE FROM posts" backend/src/routes/posts.js
grep -n "DELETE FROM comments" backend/src/routes/comments.js
```

Expected SQL fragments:

```sql
AND owner_id = $6
```

```sql
DELETE FROM posts WHERE id = $1 AND owner_id = $2 RETURNING *
```

```sql
DELETE FROM comments WHERE id = $1 AND owner_id = $2 RETURNING *
```

Restart the backend from that checkout:

```bash
cd /home/prince-maxwell/PostureSec-DevSecOps-Lab/backend
npm start
```

If a process manager is used, restart the specific backend process after confirming it points to the intended checkout.

## Security design notes

- The fix uses parameterized SQL and does not introduce SQL injection risk.
- Authorization is enforced at the database operation itself, preventing time-of-check/time-of-use gaps between a separate ownership lookup and the mutation.
- Returning `404` for unauthorized object access avoids disclosing whether another user's object exists.
- Existing `requireAuth` middleware remains responsible for authentication.
- The route-level SQL predicates are responsible for object-level authorization.
- No schema migration is required because `owner_id` already exists on posts and comments.
- Legacy records with `NULL owner_id` are not editable or deletable through these owner-only routes, which is the safer default.

### Compatibility and operational considerations

It could prevent legitimate administrators or users from editing/deleting legacy posts and comments with `NULL owner_id`, because the fix permits mutations only when the authenticated user exactly matches the object owner; any record with `owner_id IS NULL`, such as legacy data created before ownership tracking, cannot satisfy that condition, so even an otherwise legitimate user receives `404 Not Found`; likewise, administrators are denied unless explicit admin authorization is added.

This is deliberate fail-closed behavior. If legacy records or administrator access must remain manageable, the authorization policy should be expanded explicitly — for example, by adding a controlled administrator-role check or performing a reviewed ownership migration — rather than removing the ownership predicate.