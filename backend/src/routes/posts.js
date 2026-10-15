const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/authenticate');

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;

// The result cap bounds each database response; this per-client limit also
// rejects bursts before they repeatedly consume query and serialization work.
// For multiple API replicas, use a shared store so every replica enforces the
// same per-client quota.
const postsReadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many post-list requests. Please try again shortly.' },
});

function parsePositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// GET a bounded page of posts (newest first)
router.get('/', postsReadRateLimit, async (req, res) => {
  const requestedPage = parsePositiveInteger(req.query.page, 1);
  const requestedLimit = parsePositiveInteger(req.query.limit, DEFAULT_PAGE_SIZE);
  if (requestedPage === null || requestedLimit === null) {
    return res.status(400).json({ error: 'page and limit must be positive integers' });
  }
  if (requestedLimit > MAX_PAGE_SIZE) {
    return res.status(400).json({ error: `limit must not exceed ${MAX_PAGE_SIZE}` });
  }

  const limit = requestedLimit;
  const offset = (requestedPage - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    return res.status(400).json({ error: 'page is too large' });
  }

  try {
    const countResult = await pool.query('SELECT COUNT(*) AS total_count FROM posts');
    const totalCount = Number(countResult.rows[0].total_count);
    const totalPages = Math.ceil(totalCount / limit);

    // Avoid asking PostgreSQL to walk a huge OFFSET for pages beyond the end.
    if (requestedPage > totalPages) {
      return res.json({
        page: requestedPage,
        limit,
        totalCount,
        totalPages,
        data: [],
      });
    }

    const postsResult = await pool.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      page: requestedPage,
      limit,
      totalCount,
      totalPages,
      data: postsResult.rows,
    });
  } catch (err) {
    console.error('Failed to fetch posts:', err);
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

  try {
    const result = await pool.query(
      `UPDATE posts 
       SET title = $1, content = $2, author = $3, emoji = $4, updated_at = NOW() 
       WHERE id = $5 AND owner_id = $6
       RETURNING *`,
      [title, content, author || 'Anonymous', emoji || '🛡️', req.params.id, req.user.id]
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
    const result = await pool.query(
      'DELETE FROM posts WHERE id = $1 AND owner_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
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
