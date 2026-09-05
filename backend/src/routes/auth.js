const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  createSession,
  revokeSession,
  cookieOptions,
} = require('../auth');
const { requireAuth } = require('../middleware/authenticate');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 12;

// REGISTER
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!password || password.length < MIN_PASSWORD) {
    return res
      .status(400)
      .json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
  }

  try {
    const hash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, role, created_at`,
      [email.toLowerCase(), hash]
    );
    // The hash is never returned. Nothing derived from it is either.
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // Unique violation. Registration necessarily reveals that an address is
      // taken; login below deliberately does not.
      return res.status(409).json({ error: 'That email is already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, email, role, password_hash FROM users WHERE email = $1',
      [String(email).toLowerCase()]
    );
    const user = rows[0];

    // One message and one status for both "no such user" and "wrong password",
    // so the endpoint cannot be used to enumerate accounts.
    const ok = user && (await verifyPassword(password, user.password_hash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const session = await createSession(user.id);
    res.cookie(SESSION_COOKIE, session.id, cookieOptions(session.expiresAt));
    // Return the signed-in user together with when this session will expire, so
    // the client can show the user how long they stay signed in.
    res.json({ ...user, expiresAt: session.expiresAt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// LOGOUT — revokes server-side, then clears the cookie.
router.post('/logout', async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  try {
    if (sid) await revokeSession(sid);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ message: 'Signed out' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// WHOAMI
router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
});

module.exports = router;
