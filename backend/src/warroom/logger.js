/**
 * Honest request logging — the evidence surface for the exercise.
 *
 * It records FACTS about every API request: the method and path (so the target
 * object id is visible), the response status, the acting user (resolved by the
 * normal auth middleware), a short session fingerprint to correlate a caller's
 * requests, the client address, and the time. It does not judge, classify, or
 * flag anything as malicious — the whole point is that a cross-user action is
 * discovered by comparing the acting user against the object's owner, not by
 * reading a label the platform wrote for you.
 *
 * Output goes to the warroom_access_log table and to stdout as one JSON line
 * per request (so `docker logs` is also a valid evidence source). The container
 * root filesystem is read-only, so nothing is written to a file.
 */
const { SESSION_COOKIE } = require('../auth');
const { logAccess } = require('./state');

const fingerprint = (sid) => (sid ? String(sid).slice(0, 8) : null);

function accessLogger(req, res, next) {
  // Only the application API is interesting evidence; skip the incident-status
  // polling the banner does, so it does not drown the real activity.
  const started = process.hrtime.bigint();
  const path = req.originalUrl.split('?')[0];
  const skip = !path.startsWith('/api/') || path.startsWith('/api/incident');

  res.on('finish', () => {
    if (skip) return;
    const durationMs = Number((process.hrtime.bigint() - started) / 1000000n);
    const entry = {
      method: req.method,
      path,
      status: res.statusCode,
      actorUserId: req.user ? req.user.id : null,
      actorEmail: req.user ? req.user.email : null,
      sessionFp: fingerprint(req.cookies ? req.cookies[SESSION_COOKIE] : null),
      ip: req.ip || (req.socket && req.socket.remoteAddress) || null,
      durationMs,
    };
    // Structured stdout line — a second, independent copy of the evidence.
    console.log(`[access] ${JSON.stringify({ ts: new Date().toISOString(), ...entry })}`);
    logAccess(entry);
  });

  next();
}

module.exports = { accessLogger };
