const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  validateRegistrationInput,
  validateLoginInput,
  authenticateUser,
  registerUser,
  revokeSession,
  cookieOptions,
} = require('../auth');
const { requireAuth } = require('../middleware/authenticate');

// REGISTER
router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};

  try {
    const result = await registerUser(email, password);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    // The hash is never returned. Nothing derived from it is either.
    res.status(201).json(result.user);
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
  const validation = validateLoginInput(email, password);

  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }

  try {
    const result = await authenticateUser(email, password);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const { user, session } = result;
    res.cookie(SESSION_COOKIE, session.id, cookieOptions(session.expiresAt));
    res.json({ id: user.id, email: user.email, role: user.role });
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
