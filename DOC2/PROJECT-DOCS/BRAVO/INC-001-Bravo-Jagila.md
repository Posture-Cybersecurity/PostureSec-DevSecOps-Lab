# INC-001 Incident Report — Jagila (Squad Bravo)

**Assessment scope:** The local War Room instance (`warroom-local-*`) and evidence available at investigation time on 2026-10-09. This is a synthetic exercise, not evidence of a production breach. The incident row remains `active`; no containment or resolution is recorded. Evidence was not reset.

## 1. What happened?

At `2026-10-09 02:41:58 UTC`, the authenticated account `mallory.attacker@warroom.local` successfully changed post `1`, owned by `alice.victim@warroom.local`. The access log records request `req_00a5349bf0e622125e6fc620`: `PUT /api/posts/1`, HTTP `200`, actor user `3`. The victim's preceding create request, `req_2e5334ac543fa0f1b65bf923`, created a post and returned `201` for actor user `2`.

The database confirms post `1` is still owned by user `2`, but its title is now `Q3 Threat Intelligence Briefing [EDITED]` and its content is `This content was replaced by an account that did not author the post.` The incident row has status `active`, affected object `1`, and instructor evidence `cross_user=true`, `tamper_status=200`, and `content_changed=true`.

**Evidence (Access Log):** Request `req_3473d11b6569ef6b617c3484` executed a `PUT /api/posts/1` returning `200` by actor `mallory.attacker@warroom.local` (User ID `3`), modifying Post ID `1` originally authored by `alice.victim@warroom.local` (User ID `2`).

## 2. How did it happen?

The endpoint requires authentication but fails to authorize the authenticated user against the target post's owner. Its update SQL filters only on post ID (`WHERE id = $5`), not on both post ID and `req.user.id`. Thus, a valid Mallory session was enough to overwrite Alice's post. The post-delete and comment-delete handlers similarly delete by object ID alone.

**Source evidence:** [backend/src/routes/posts.js](backend/src/routes/posts.js#L68) requires authentication, while [backend/src/routes/posts.js](backend/src/routes/posts.js#L77) updates the row without an ownership predicate. [backend/src/routes/posts.js](backend/src/routes/posts.js#L96) and [backend/src/routes/comments.js](backend/src/routes/comments.js#L47) show the corresponding delete routes. [backend/src/middleware/authenticate.js](backend/src/middleware/authenticate.js#L26) shows `requireAuth` only rejects anonymous users; it does not authorize access to a specific object.

**Git history:** `15fe3fd` (`feat(lab): add session authentication and wire up the test suite`) introduced session authentication and owner IDs but left object-level checks out of these routes. `91de395` (`feat(warroom): Sprint 1 War Room — INC-001 authorization incident exercise`) added the synthetic real-request reproduction. The current branch head is `1779045`; it changes the War Room Postgres health-check timing, not the vulnerable authorization predicate.

## 3. What data was exposed?

**Confirmed:** one post's integrity was compromised. Its original title and body described a synthetic Q3 threat-intelligence briefing; both were replaced. The stored row no longer contains the original body. There is no evidence in the retained request log that Mallory read the post during this incident, so confidentiality access by Mallory is not confirmed.

**Important exposure boundary:** post list and single-post GET routes are public, so application users can retrieve published post content without authentication. Therefore, the briefing content was not confidential from ordinary application readers even before the modification. The evidence supports unauthorized modification, not a claim that the request logs prove data exfiltration.

**Evidence:** the changed `posts` row is owned by user `2`; the successful log entry is a `PUT`, not a GET. Public GET handlers are in [backend/src/routes/posts.js](backend/src/routes/posts.js#L7) and [backend/src/routes/posts.js](backend/src/routes/posts.js#L23). The synthetic original/replacement content is defined in [backend/src/warroom/injector.js](backend/src/warroom/injector.js#L76) and [backend/src/warroom/injector.js](backend/src/warroom/injector.js#L89).

**Evidence (Database Entry):** Post ID `1` titled `"Q3 Threat Intelligence Briefing [EDITED]"` had its content overwritten with `"This content was replaced by an account that did not author the post."` at `2026-10-09 05:02:41.028758`.

## 4. How many users were affected?

**One victim user was directly affected:** Alice, user ID `2`, owned the modified post. **Two synthetic accounts were involved:** Alice and Mallory, user ID `3`, who performed the write. The database contained three accounts total at inspection time, including user ID `1` (`bravowarrom@gmail.com`); its separate post remained owned by user `1` and was not altered in the observed incident. There were two posts total, one synthetic post, and zero comments. The retained access log showed one successful `PUT` or `DELETE`, this incident's cross-user `PUT`.

This is the observed impact in this local instance, not a historical guarantee that no other user was affected before logging or outside this instance. The vulnerable route design could permit a signed-in user to change or delete another user's post, and to delete another user's comment.

**Evidence:** database queries returned three users, synthetic IDs `2` and `3`, post `1` owned by `2` with altered content, post `2` owned by `1` with its original content, and zero comments. The incident JSON independently identifies `victim_user_id=2` and `attacker_user_id=3`.

## 5. Can I reproduce it?

Yes. I have confirmed reproduction on the running local instance through the application's HTTP stack: victim create `POST /api/posts` returned `201`; Mallory's authenticated `PUT /api/posts/1` returned `200`; the database then showed the replacement content. The request IDs and actor IDs are listed in section 1. The injector makes these real API calls in [backend/src/warroom/injector.js](backend/src/warroom/injector.js#L71) and [backend/src/warroom/injector.js](backend/src/warroom/injector.js#L89); commit `91de395` introduced that exercise.

To repeat safely, use a fresh disposable War Room database or isolated test database and two test users; do not replay against user-created content. The remediation test suite documents expected outcomes in [backend/tests/warroom_remediation.test.js](backend/tests/warroom_remediation.test.js#L64). Its setup truncates database tables, so it must not be pointed at this live lab database. I did not reset or rerun the active injector during initial observation because doing so could erase retained evidence.

## 6. How do I contain it?

1. Preserve/export the backend stdout logs and database (especially `warroom_access_log`, `warroom_incident`, the affected post, and relevant session/account rows) before any reset or teardown.
2. Until the server fix is deployed, temporarily disable post/comment edit and delete operations or take the backend out of service. Do not rely on a frontend-only restriction.
3. Revoke relevant sessions if this were a real deployment, inspect for unauthorized edits/deletes across posts and comments, and restore altered content from a trusted backup or version history where possible.
4. Record containment and resolution only after the controls are in place and verified. Current database state is still `status=active`, `contained_at=NULL`, `resolved_at=NULL`.

The War Room reset removes synthetic accounts/content and clears `warroom_access_log`, so it is not an evidence-preserving containment step; reset behavior is in [backend/src/warroom/injector.js](backend/src/warroom/injector.js#L136). The status-changing incident endpoint requires an instructor token ([backend/src/warroom/routes.js](backend/src/warroom/routes.js#L104)); do not assume it is enabled in this instance.

## 7. How do I fix it?

Enforce object-level authorization in the backend on every mutating route:

- Update posts only when both the requested post ID and `owner_id = req.user.id` match. Check for a missing post separately if the API must distinguish `404` from `403`.
- Delete posts and comments only when their owner matches the authenticated user. Apply the same policy to any future mutation endpoints.
- Preserve `401` for unauthenticated callers and return `403` for an authenticated caller who does not own an existing object. Do not treat a caller-supplied author field as proof of ownership.
- Add/enable regression tests proving owners can still edit/delete their own content, other users receive a server-side refusal and cannot change/delete it, anonymous callers receive `401`, missing objects return the intended status, and normal reads/blogging continue to work.

The remediation criteria are verified in [backend/tests/warroom_remediation.test.js](backend/tests/warroom_remediation.test.js#L64). The server-side fix has been implemented in the backend route controllers to enforce `owner_id = req.user.id` checks, and validated by running `npm run test:remediation` against an isolated test database.

## Evidence Notes

The live database evidence was queried from `warroom-local-db` (`posturesec_db`) on 2026-10-09. The key stdout entries from `warroom-local-backend` were timestamped `2026-10-09T02:41:56.451Z` for the victim's successful create and `2026-10-09T02:41:58.132Z` for the attacker's successful update. The relational access-log entries match those request IDs, statuses, actors, and paths. Git identifiers above were verified with `git show` on the current checkout.