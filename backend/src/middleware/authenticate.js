/**
 * Authentication middleware — WHO, not MAY.
 *
 * `requireAuth` establishes identity and stops anonymous callers. It makes no
 * statement about whether the authenticated user is entitled to the object they
 * are about to touch. Routes decide that for themselves.
 *
 * The distinction is the point:
 *   401 Unauthorized  — we do not know who you are
 *   403 Forbidden     — we know who you are, and you may not do this
 */
const { SESSION_COOKIE, resolveSession } = require('../auth');

/** Populates req.user when a valid session cookie is present. Never rejects. */
async function attachUser(req, _res, next) {
  try {
    req.user = await resolveSession(req.cookies?.[SESSION_COOKIE]);
  } catch (err) {
    console.error('session lookup failed:', err.message);
    req.user = null;
  }
  next();
}

/** Rejects anonymous callers with 401. Says nothing about authorization. */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/** Coarse, role-based gate. Vertical authorization only — not object-level. */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}

/** Object-level authorization: allow owner or admin, otherwise 403. */
function requireOwnership(getOwnerId) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const ownerId = await getOwnerId(req);
      if (ownerId == null) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      if (req.user.role === 'admin' || Number(ownerId) === Number(req.user.id)) {
        return next();
      }

      return res.status(403).json({ error: 'Forbidden' });
    } catch (err) {
      console.error('ownership check failed:', err.message);
      return res.status(500).json({ error: 'Authorization failed' });
    }
  };
}

module.exports = { attachUser, requireAuth, requireRole, requireOwnership };
