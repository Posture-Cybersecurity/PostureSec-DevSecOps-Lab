# PostureSec Authentication and Authorization Fixes

**Repository:** `Posture-Cybersecurity/PostureSec-DevSecOps-Lab`  
**Branch reviewed:** `lab/s0-06-simulation`  
**Scope:** Authentication password verification and object-level authorization (BOLA/IDOR) for posts and comments.

> **Implementation note:** This document records the findings and remediation patterns discussed during the review. Confirm that the code and tests below match the final changes in your working tree before treating the fixes as merged or verified.

## 1. Summary

Two security issues were identified:

1. **Authentication — password verification was not awaited.** The login handler used the Promise returned by the asynchronous password verifier without awaiting its result. A Promise is truthy, so the password check could be treated as successful before the comparison completed.
2. **Authorization — broken object-level authorization (BOLA/IDOR).** Authenticated users could attempt to update or delete posts and delete comments by supplying an object ID. The mutation queries checked the ID but did not also constrain the operation to the authenticated user's `owner_id`.

## 2. Authentication fix: await password verification

**File:** `backend/src/routes/auth.js`

### Vulnerable pattern

```js
const ok = user && verifyPassword(password, user.password_hash);
```

`verifyPassword()` returns a Promise because it wraps `bcrypt.compare()`. Testing the Promise itself does not test whether the password matches.

### Corrected pattern

```js
const ok = user && (await verifyPassword(password, user.password_hash));
```

Ensure the containing route handler is declared `async`, so `await` is valid.

### Expected behavior

- Correct password: authentication may continue.
- Incorrect password: authentication is rejected.
- Unknown user: authentication is rejected.
- The server must not issue a successful login response unless the password comparison resolves to `true`.

## 3. Authorization fix: enforce ownership in database mutations

`requireAuth` identifies the authenticated user; it does not, by itself, prove that the user owns the requested post or comment. Enforce ownership in the backend for every operation that changes or removes an object.

### 3.1 Update a post

**File:** `backend/src/routes/posts.js`

Include `owner_id` in the `WHERE` clause and pass the authenticated user's ID as a parameter:

```js
const result = await pool.query(
  `UPDATE posts
   SET title = $1,
       content = $2,
       author = $3,
       emoji = $4,
       updated_at = NOW()
   WHERE id = $5 AND owner_id = $6
   RETURNING *`,
  [
    title,
    content,
    author || 'Anonymous',
    emoji || '🛡️',
    req.params.id,
    req.user.id
  ]
);
```

If `result.rows.length === 0`, do not report success. Return an appropriate not-found/authorization response according to the API's policy.

### 3.2 Delete a post

**File:** `backend/src/routes/posts.js`

```js
const result = await pool.query(
  `DELETE FROM posts
   WHERE id = $1 AND owner_id = $2
   RETURNING *`,
  [req.params.id, req.user.id]
);

if (result.rows.length === 0) {
  return res.status(403).json({
    error: 'You are not authorized to delete this post'
  });
}
```

Keep the route protected by `requireAuth`. Ensure the normal success response is sent only after a row has actually been deleted.

### 3.3 Delete a comment

**File:** `backend/src/routes/comments.js`

```js
const result = await pool.query(
  `DELETE FROM comments
   WHERE id = $1 AND owner_id = $2
   RETURNING *`,
  [req.params.id, req.user.id]
);

if (result.rows.length === 0) {
  return res.status(403).json({
    error: 'You are not authorized to delete this comment'
  });
}
```

Keep the route protected by `requireAuth` and send a success response only when a row was deleted.

> **Response-code note:** A query constrained by both object ID and owner ID cannot distinguish “object does not exist” from “object belongs to someone else.” Returning `404 Not Found` for both is also a valid policy and can reduce object-existence disclosure. If the API must return `403 Forbidden` for a known non-owner, perform a separate existence/authorization check safely. Apply one consistent policy across endpoints.

## 4. Verification procedure

Run the app locally and use two separate authenticated users. The examples assume the API is reachable at `http://localhost:5000`, the routes are mounted under `/api`, and the application uses cookie-based sessions. Adjust the URL, request fields, and authentication flow to match the actual app.

### 4.1 Authentication regression test

1. Log in with a valid account and correct password; expect success.
2. Attempt to log in with the same account and an incorrect password; expect an authentication failure (commonly `401 Unauthorized`).
3. Attempt login with an unknown account; expect an authentication failure.
4. Confirm that no session/token is issued for failed login attempts.

### 4.2 Create an object owned by User A

Log in as User A and create a post. Record the `id` returned in the response. Use that returned ID in the remaining tests; do not assume it is `1`.

Example:

```bash
curl -i -b userA.txt -X POST http://localhost:5000/api/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"User A post","content":"This belongs to User A","author":"User A"}'
```

Record the returned post ID. Create a comment as User A as well and record the returned comment ID if testing comment deletion.

### 4.3 Cross-user update and delete tests

With User B authenticated, try to update User A's post:

```bash
curl -i -b userB.txt -X PUT http://localhost:5000/api/posts/POST_ID \
  -H "Content-Type: application/json" \
  -d '{"title":"Unauthorized change","content":"User B must not edit this","author":"User B"}'
```

Try to delete the same post:

```bash
curl -i -b userB.txt -X DELETE http://localhost:5000/api/posts/POST_ID
```

Try to delete User A's comment:

```bash
curl -i -b userB.txt -X DELETE http://localhost:5000/api/comments/COMMENT_ID
```

Replace `POST_ID` and `COMMENT_ID` with the IDs returned by the API. Verify that the API rejects these cross-user operations and that User A's post/comment remains unchanged.

### 4.4 Positive ownership tests

Also verify that:

- User A can update and delete their own post, if those operations are intended to be allowed.
- User A can delete their own comment, if that operation is intended to be allowed.
- Unauthenticated users cannot call protected mutation routes.
- Requests using malformed or nonexistent IDs fail safely.

### 4.5 Restart and retest

Restart the backend after editing files unless a development watcher (for example, `nodemon`) reloads it automatically. Re-run both the authentication and authorization tests against the running code.

## 5. Acceptance criteria

- [ ] Password comparison is awaited before login success is determined.
- [ ] Wrong passwords and unknown users cannot authenticate.
- [ ] Post updates require both the requested post ID and `owner_id = req.user.id`.
- [ ] Post deletions require both the requested post ID and `owner_id = req.user.id`.
- [ ] Comment deletions require both the requested comment ID and `owner_id = req.user.id`.
- [ ] Cross-user mutation attempts are rejected and do not change/delete the owner's data.
- [ ] Legitimate owners can still perform permitted operations.
- [ ] Tests are run against the final backend code.

## 6. Security rationale

These changes follow two core principles:

- **Correct authentication:** wait for the password verifier's actual result before deciding whether login succeeds.
- **Object-level authorization:** enforce access rules on the server for each object and operation. Do not rely on frontend checks or on possession of an object ID.

**Status:** Documented remediation guidance. Mark each item as implemented and verified only after confirming the corresponding code and tests in the working branch.
