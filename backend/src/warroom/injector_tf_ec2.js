/**
 * INC-004 injector — "The Terraform Apply That Broke Production — EC2 Edition".
 *
 * Same contract as every other injector: { runIncident, reset }, so the
 * automatic fuse (timer.js) and the instructor routes drive it unchanged.
 * Plus the squad-facing operations the router exposes for this incident only:
 * view(), perform(user, action), report(user, body), and debrief() for the
 * instructor.
 *
 * What it touches, and ONLY this: its own two tables and the shared
 * warroom_incident alarm row. The squad works against a deterministic
 * simulation (tf_ec2/engine.js) whose evidence is either representative or
 * captured from the dedicated War Room EC2 lab (warroom/inc004/) — no student
 * action reaches AWS or Terraform, so no student can damage real infrastructure.
 *
 * Attempts: each trigger opens ONE attempt (a fresh, isolated state); reset
 * closes it. Every state change runs in a transaction holding a row lock on the
 * attempt, so concurrent clicks are serialised and cannot double-apply.
 */
const crypto = require('crypto');
const { pool } = require('../db');
const { getIncident, raiseIncident, setStatus } = require('./state');
const engine = require('./tf_ec2/engine');
const S = require('./tf_ec2/scenario');

const INCIDENT = 'INC-004';
let ready = null;

function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS warroom_inc004_attempt (
          attempt_id VARCHAR(40) PRIMARY KEY,
          state      JSONB NOT NULL,
          active     BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      // At most one active attempt per instance, enforced by the database.
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS warroom_inc004_one_active
                          ON warroom_inc004_attempt ((active)) WHERE active`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS warroom_inc004_audit (
          id            BIGSERIAL PRIMARY KEY,
          ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          attempt_id    VARCHAR(40),
          actor_user_id INTEGER,
          actor_email   VARCHAR(255),
          action        VARCHAR(40) NOT NULL,
          result_code   INTEGER NOT NULL,
          outcome       TEXT
        )`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function audit(client, attemptId, user, action, code, outcome) {
  await client.query(
    `INSERT INTO warroom_inc004_audit (attempt_id, actor_user_id, actor_email, action, result_code, outcome)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [attemptId, user ? user.id : null, user ? user.email : null, action, code, (outcome || '').slice(0, 500)]
  );
}

async function activeAttempt(client, lock) {
  const { rows } = await client.query(
    `SELECT attempt_id, state FROM warroom_inc004_attempt WHERE active ${lock ? 'FOR UPDATE' : ''}`
  );
  return rows[0] || null;
}

async function runIncident() {
  await ensureTables();
  const current = await getIncident();
  if (current && current.status === 'active') return { incident: INCIDENT, already_active: true };

  const attemptId = `inc004-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE warroom_inc004_attempt SET active = FALSE, updated_at = NOW() WHERE active');
    await client.query('INSERT INTO warroom_inc004_attempt (attempt_id, state) VALUES ($1, $2::jsonb)',
      [attemptId, JSON.stringify(engine.newAttempt(attemptId, Date.now()))]);
    await audit(client, attemptId, null, 'trigger', 200, 'Attempt opened; alarm raised.');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Symptom-level headline only. The debrief evidence names the attempt, nothing more.
  await raiseIncident('SEV-1: PostureBlogging is unreachable for every user.', { incident: INCIDENT, attempt_id: attemptId });
  return { incident: INCIDENT, attempt_id: attemptId, alarm: 'raised' };
}

async function reset() {
  await ensureTables();
  const client = await pool.connect();
  let closed = [];
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE warroom_inc004_attempt
          SET active = FALSE, state = jsonb_set(state, '{phase}', '"closed"'), updated_at = NOW()
        WHERE active RETURNING attempt_id`);
    closed = rows.map((r) => r.attempt_id);
    await audit(client, closed[0] || null, null, 'reset', 200, `Closed ${closed.length} attempt(s).`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await setStatus('idle');
  return { incident: INCIDENT, reset: true, closed_attempts: closed.length };
}

/** Run `fn(state) -> {state, result}` on the active attempt under a row lock. */
async function mutate(user, action, fn) {
  await ensureTables();
  const client = await pool.connect();
  let out;
  try {
    await client.query('BEGIN');
    const row = await activeAttempt(client, true);
    if (!row) {
      await client.query('ROLLBACK');
      return { result: { ok: false, code: 409, message: 'No active incident' }, view: null };
    }
    const { state, result } = fn(row.state);
    if (result.ok) {
      await client.query('UPDATE warroom_inc004_attempt SET state = $2::jsonb, updated_at = NOW() WHERE attempt_id = $1',
        [row.attempt_id, JSON.stringify(state)]);
    }
    await audit(client, row.attempt_id, user, action, result.code, result.message);
    await client.query('COMMIT');
    out = { result, view: engine.publicView(state), completed: state.phase === 'completed' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (out.completed) await setStatus('resolved');
  return out;
}

const perform = (user, action) => mutate(user, String(action).slice(0, 40), (st) => engine.act(st, action, Date.now()));
const report = (user, body) => mutate(user, 'submit_report', (st) => engine.submitReport(st, body || {}, Date.now()));

async function view() {
  await ensureTables();
  const row = await activeAttempt(pool, false);
  return row ? engine.publicView(row.state) : null;
}

/** Instructor-only: the full record, including the scoring key and the audit trail. */
async function debrief() {
  await ensureTables();
  const row = await activeAttempt(pool, false)
    || (await pool.query('SELECT attempt_id, state FROM warroom_inc004_attempt ORDER BY updated_at DESC LIMIT 1')).rows[0];
  if (!row) return null;
  const { rows: trail } = await pool.query(
    `SELECT ts, actor_email, action, result_code, outcome FROM warroom_inc004_audit
      WHERE attempt_id = $1 ORDER BY id`, [row.attempt_id]);
  return {
    attempt_id: row.attempt_id,
    phase: row.state.phase,
    score: engine.score(row.state),
    expected_hypothesis: S.RUBRIC.diagnosis.correct,
    report: row.state.report,
    flags: {
      fixed_in_terraform: row.state.tf_users_rule,
      plan_reviewed_before_apply: row.state.fixed_reviewed,
      console_changes_made: Boolean(row.state.console_was_used),
      console_rules_still_present: row.state.console_users_rule || row.state.console_world_rule,
      open_to_internet: row.state.tf_world_rule || row.state.console_world_rule,
      instance_replaced: row.state.replaced,
      verified: row.state.verified,
    },
    audit: trail,
  };
}

module.exports = { runIncident, reset, view, perform, report, debrief, ensureTables };
