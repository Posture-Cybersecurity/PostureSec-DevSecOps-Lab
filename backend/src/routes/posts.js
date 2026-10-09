const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authenticate');
const { rateLimit } = require('../middleware/rateLimit');

// One page. A caller cannot raise this, and a single read cannot return the table.
const MAX_PAGE = 100;
// Under the 100kb JSON cap, and under the 40kb bodies that filled the list.
const MAX_CONTENT_CHARS = 20000;

function contentTooLarge(content) {
  return typeof content === 'string' && content.length > MAX_CONTENT_CHARS;
}

// GET a bounded page of posts (newest first). Public, same as before.
router.get('/', rateLimit, async (req, res) => {
  const requested = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_PAGE)
    : MAX_PAGE;

  try {
    const result = await pool.query(
      `SELECT p.id, p.title, LEFT(p.content, 500) AS content, p.author, p.emoji,
              p.owner_id, p.created_at, p.updated_at,
              (SELECT COUNT(*)::int FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p
       ORDER BY p.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// GET single post with comments
router.get('/:id', async (req, res) => {
  try {
    const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [req.params.id]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const commentsResult = await pool.query(
      'SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({
      ...postResult.rows[0],
      comments: commentsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// CREATE post
router.post('/', requireAuth, async (req, res) => {
  const { title, content, author, emoji } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }
  if (contentTooLarge(content)) {
    return res.status(400).json({ error: 'Content is too large' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO posts (title, content, author, emoji, owner_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, content, author || 'Anonymous', emoji || '🛡️', req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// UPDATE post
router.put('/:id', requireAuth, async (req, res) => {
  const { title, content, author, emoji } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }
  if (contentTooLarge(content)) {
    return res.status(400).json({ error: 'Content is too large' });
  }

  try {
    const result = await pool.query(
      `UPDATE posts 
       SET title = $1, content = $2, author = $3, emoji = $4, updated_at = NOW() 
       WHERE id = $5 
       RETURNING *`,
      [title, content, author || 'Anonymous', emoji || '🛡️', req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// DELETE post
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ message: 'Post deleted successfully 🗑️' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

module.exports = router;
