# INC-001 — Reference Remediation (INSTRUCTOR ONLY)

> Do not distribute to squads before the debrief.

Enforce **object-level authorization** on the three mutating routes: load the row,
`404` if it is missing, `403` if the caller is not the owner (an `admin` role may
override), then perform the write — server-side, before the mutation.

Apply this diff to `backend/src/routes/posts.js` and
`backend/src/routes/comments.js`, then verify:

```bash
cd backend && npm run test:remediation   # goes green (was red)
cd backend && npm test                    # stays green
```

Re-triggering the incident after the fix (`./warroom.sh trigger <squad>`) records
the attacker's `PUT` as **403** with the victim's content untouched — the same
evidence surface proves containment.

```diff
diff --git a/backend/src/routes/comments.js b/backend/src/routes/comments.js
--- a/backend/src/routes/comments.js
+++ b/backend/src/routes/comments.js
@@ -46,10 +46,14 @@ router.post('/', requireAuth, async (req, res) => {
 // DELETE comment
 router.delete('/:id', requireAuth, async (req, res) => {
   try {
-    const result = await pool.query('DELETE FROM comments WHERE id = $1 RETURNING *', [req.params.id]);
-    if (result.rows.length === 0) {
+    const owned = await pool.query('SELECT owner_id FROM comments WHERE id = $1', [req.params.id]);
+    if (owned.rows.length === 0) {
       return res.status(404).json({ error: 'Comment not found' });
     }
+    if (owned.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
+      return res.status(403).json({ error: 'You may not delete a comment you do not own' });
+    }
+    await pool.query('DELETE FROM comments WHERE id = $1', [req.params.id]);
     res.json({ message: 'Comment deleted 🗑️' });
   } catch (err) {
     console.error(err);
diff --git a/backend/src/routes/posts.js b/backend/src/routes/posts.js
--- a/backend/src/routes/posts.js
+++ b/backend/src/routes/posts.js
@@ -73,6 +73,15 @@ router.put('/:id', requireAuth, async (req, res) => {
   }
 
   try {
+    // Object-level authorization: you may only modify a post you own.
+    const owned = await pool.query('SELECT owner_id FROM posts WHERE id = $1', [req.params.id]);
+    if (owned.rows.length === 0) {
+      return res.status(404).json({ error: 'Post not found' });
+    }
+    if (owned.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
+      return res.status(403).json({ error: 'You may not modify a post you do not own' });
+    }
+
     const result = await pool.query(
       `UPDATE posts 
        SET title = $1, content = $2, author = $3, emoji = $4, updated_at = NOW() 
@@ -81,10 +90,6 @@ router.put('/:id', requireAuth, async (req, res) => {
       [title, content, author || 'Anonymous', emoji || '🛡️', req.params.id]
     );
 
-    if (result.rows.length === 0) {
-      return res.status(404).json({ error: 'Post not found' });
-    }
-
     res.json(result.rows[0]);
   } catch (err) {
     console.error(err);
@@ -95,10 +100,14 @@ router.put('/:id', requireAuth, async (req, res) => {
 // DELETE post
 router.delete('/:id', requireAuth, async (req, res) => {
   try {
-    const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING *', [req.params.id]);
-    if (result.rows.length === 0) {
+    const owned = await pool.query('SELECT owner_id FROM posts WHERE id = $1', [req.params.id]);
+    if (owned.rows.length === 0) {
       return res.status(404).json({ error: 'Post not found' });
     }
+    if (owned.rows[0].owner_id !== req.user.id && req.user.role !== 'admin') {
+      return res.status(403).json({ error: 'You may not delete a post you do not own' });
+    }
+    await pool.query('DELETE FROM posts WHERE id = $1', [req.params.id]);
     res.json({ message: 'Post deleted successfully 🗑️' });
   } catch (err) {
     console.error(err);
```
