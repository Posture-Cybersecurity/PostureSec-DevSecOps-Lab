/**
 * Authentication — establishing WHO a caller is.
 *
 * This module answers exactly one question: which user, if any, is making this
 * request? It never answers whether that user is allowed to do the thing they
 * are asking for. That is authorization, it is a per-route decision, and it
 * lives with the route.
 *
 * Sessions are server-side and the cookie is opaque: 256 bits of randomness
 * that mean nothing on their own. Nothing about the user is encoded in it, so
 * the server stays the sole authority on identity and a session stops working
 * the instant it is revoked.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const SESSION_COOKIE = 'psec_session';
const SESSION_TTL_HOURS = 8;
// 10 is deliberately modest so the test suite stays fast. Production would use
// argon2id, or bcrypt at a cost tuned to the hardware.
const BCRYPT_ROUNDS = 10;

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** 256 bits from a CSPRNG. Never Math.random, never a counter, never a UUIDv1. */
const newSessionId = () => crypto.randomBytes(32).toString('hex');

async function createSession(userId) {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await pool.query(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
    [id, userId, expiresAt]
  );
  return { id, expiresAt };
}

/**
 * Resolve a session id to a user, or null.
 *
 * The query is the reason this design was chosen: revocation and expiry are
 * checked on every request, so logging out genuinely ends access. A stateless
 * token could not do this without a second lookup, which would defeat the point
 * of being stateless.
 */
async function resolveSession(sessionId) {
  if (!sessionId) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()`,
    [sessionId]
  );
  return rows[0] || null;
}

const revokeSession = (sessionId) =>
  pool.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
    [sessionId]
  );

const revokeAllForUser = (userId) =>
  pool.query(
    'UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );

/**
 * Cookie flags.
 *   httpOnly — script cannot read it, so an XSS cannot lift the session
 *   sameSite strict — the browser will not attach it to cross-site requests
 *   secure — HTTPS only; disabled outside production so the lab works on http
 */
const cookieOptions = (expiresAt) => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  expires: expiresAt,
  path: '/',
});

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_HOURS,
  hashPassword,
  verifyPassword,
  createSession,
  resolveSession,
  revokeSession,
  revokeAllForUser,
  cookieOptions,
};
