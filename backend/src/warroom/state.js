/**
 * War Room state + honest evidence storage.
 *
 * Two tables, created only when the exercise is enabled, so the plain lab
 * database is never touched:
 *
 *   warroom_incident     one row (INC-001): the alarm state the homepage reads.
 *                        It carries a GENERIC headline and timestamps only — no
 *                        root cause, no vulnerability name, no fingers pointed.
 *   warroom_access_log   an honest record of requests: who (session/user), what
 *                        (method + path, so the object id is visible), the
 *                        result, and when. It labels nothing as an "attack" and
 *                        draws no conclusion — what happened is pieced together
 *                        from these facts during the investigation, which is the
 *                        exercise, not read from a label written into the log.
 */
const { pool } = require('../db');
const { incidentId } = require('./config');

async function initWarRoom() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS warroom_incident (
      id           VARCHAR(20) PRIMARY KEY,
      status       VARCHAR(20) NOT NULL DEFAULT 'idle',
      headline     TEXT,
      triggered_at TIMESTAMPTZ,
      contained_at TIMESTAMPTZ,
      resolved_at  TIMESTAMPTZ,
      evidence     JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS warroom_access_log (
      id            BIGSERIAL PRIMARY KEY,
      ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      method        VARCHAR(10) NOT NULL,
      path          TEXT NOT NULL,
      status        INTEGER,
      actor_user_id INTEGER,
      actor_email   VARCHAR(255),
      session_fp    VARCHAR(16),
      ip            VARCHAR(64),
      duration_ms   INTEGER
    );
  `);
  await pool.query(
    `INSERT INTO warroom_incident (id, status) VALUES ($1, 'idle')
       ON CONFLICT (id) DO NOTHING`,
    [incidentId]
  );
}

async function getIncident() {
  const { rows } = await pool.query('SELECT * FROM warroom_incident WHERE id = $1', [incidentId]);
  return rows[0] || null;
}

/** Public, learner-facing view of the alarm. Symptoms only. */
function publicIncident(row) {
  if (!row) return { id: incidentId, active: false, status: 'idle' };
  const active = row.status === 'active';
  return {
    id: row.id,
    active,
    status: row.status,
    headline: active ? (row.headline || 'Suspicious activity detected on your blogging platform.') : null,
    triggered_at: row.triggered_at,
    contained_at: row.contained_at,
    resolved_at: row.resolved_at,
  };
}

async function raiseIncident(headline, evidence) {
  const { rows } = await pool.query(
    `UPDATE warroom_incident
        SET status = 'active', headline = $2, triggered_at = COALESCE(triggered_at, NOW()),
            evidence = $3::jsonb, updated_at = NOW()
      WHERE id = $1 AND status <> 'active'
      RETURNING *`,
    [incidentId, headline, JSON.stringify(evidence || {})]
  );
  return rows[0] || (await getIncident());
}

async function setStatus(status) {
  const stamp = status === 'contained' ? 'contained_at'
    : status === 'resolved' ? 'resolved_at' : null;
  const set = stamp ? `status = $2, ${stamp} = NOW(), updated_at = NOW()` : 'status = $2, updated_at = NOW()';
  const { rows } = await pool.query(
    `UPDATE warroom_incident SET ${set} WHERE id = $1 RETURNING *`,
    [incidentId, status]
  );
  return rows[0] || null;
}

async function logAccess(entry) {
  try {
    await pool.query(
      `INSERT INTO warroom_access_log
         (method, path, status, actor_user_id, actor_email, session_fp, ip, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [entry.method, entry.path, entry.status, entry.actorUserId || null,
       entry.actorEmail || null, entry.sessionFp || null, entry.ip || null, entry.durationMs || null]
    );
  } catch (err) {
    // Evidence logging must never break the request it is observing.
    console.error('warroom access-log write failed:', err.message);
  }
}

module.exports = {
  initWarRoom, getIncident, publicIncident, raiseIncident, setStatus, logAccess,
};
