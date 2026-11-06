/**
 * Per-request correlation id.
 *
 * Every incoming request is stamped with an opaque, server-generated id
 * (`req_` + 96 bits of randomness) so one HTTP transaction can be tied to its
 * access-log line. The id is returned to the caller in the `X-Request-ID`
 * response header, so a student can run a request with curl or the browser,
 * read the header, and search the local logs for exactly that request.
 *
 * SECURITY: the id is ALWAYS generated here. Any inbound `X-Request-ID` is
 * ignored, never echoed and never logged — an attacker must not be able to
 * choose a correlation id and forge or collide log entries. It is generated
 * locally with a CSPRNG and depends on no remote service.
 *
 * This is NOT the incident id. INC-001 identifies the security incident; a
 * request id identifies a single HTTP request. The two are kept separate.
 */
const crypto = require('crypto');

function assignRequestId(req, res, next) {
  const id = `req_${crypto.randomBytes(12).toString('hex')}`;
  req.requestId = id;
  // Set immediately so the header is present on every response, including
  // early rejections (401/403/404) that never reach a route handler.
  res.setHeader('X-Request-ID', id);
  next();
}

module.exports = { assignRequestId };
