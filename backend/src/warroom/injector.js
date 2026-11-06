/**
 * Incident injector — a controlled, synthetic, real sequence of requests.
 *
 * This does not fabricate evidence. It signs in as two obviously-synthetic
 * accounts and makes GENUINE http calls to the application's own api, over the
 * real network stack, captured by the real logging middleware. One of those
 * calls is a legitimate authenticated user acting on an object that belongs to
 * a different user. Whether that call SHOULD succeed is exactly what the squad
 * investigates — the injector expresses no opinion about it and writes no
 * conclusion anywhere a learner can read.
 *
 * Deterministic and reversible: run it, and the same two accounts and the same
 * one cross-user action appear every time; reset() removes them so it can run
 * again cleanly. It refuses to double-fire while an incident is already active.
 */
const { pool } = require('../db');
const config = require('./config');
const { getIncident, raiseIncident } = require('./state');

const base = config.selfBaseUrl.replace(/\/$/, '');

function cookiesOf(res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function call(method, path, { cookie, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not all responses have a body */ }
  return { status: res.status, cookie: cookiesOf(res), body: json };
}

async function ensureRegistered(actor) {
  const res = await call('POST', '/api/auth/register', { body: actor });
  // 201 created, or 409 already there from an earlier run — both are fine.
  if (![201, 409].includes(res.status)) {
    throw new Error(`register ${actor.email} unexpected status ${res.status}`);
  }
}

async function loginAs(actor) {
  const res = await call('POST', '/api/auth/login', { body: actor });
  if (res.status !== 200 || !res.cookie) throw new Error(`login ${actor.email} failed (${res.status})`);
  return { cookie: res.cookie, user: res.body };
}

/**
 * Run the incident. Returns a summary for INSTRUCTOR verification only — it is
 * never exposed through a learner-facing endpoint.
 */
async function runIncident() {
  const existing = await getIncident();
  if (existing && existing.status === 'active') {
    return { skipped: true, reason: 'already-active' };
  }

  const { victim, attacker } = config.actors;
  await ensureRegistered(victim);
  await ensureRegistered(attacker);

  // 1) The victim publishes a post they own.
  const victimSession = await loginAs(victim);
  const created = await call('POST', '/api/posts', {
    cookie: victimSession.cookie,
    body: {
      title: 'Q3 Threat Intelligence Briefing',
      content: 'Internal draft — indicators of compromise for the Q3 review. Owned by the author.',
      author: 'A. Victim',
      emoji: '🛡️',
    },
  });
  if (created.status !== 201) throw new Error(`victim post create failed (${created.status})`);
  const post = created.body;

  // 2) The attacker authenticates as themselves — a legitimate session.
  const attackerSession = await loginAs(attacker);

  // 3) The attacker acts on the victim's post. A real, authenticated request.
  const tamper = await call('PUT', `/api/posts/${post.id}`, {
    cookie: attackerSession.cookie,
    body: {
      title: 'Q3 Threat Intelligence Briefing [EDITED]',
      content: 'This content was replaced by an account that did not author the post.',
      author: 'A. Victim',
      emoji: '🛡️',
    },
  });

  // Read back the stored row directly, so the summary reflects reality, not the
  // response body the endpoint chose to return.
  const { rows } = await pool.query(
    'SELECT id, owner_id, title, content, updated_at, created_at FROM posts WHERE id = $1',
    [post.id]
  );
  const stored = rows[0] || null;

  const crossUser = victimSession.user.id !== attackerSession.user.id;
  const succeeded = tamper.status === 200;
  const contentChanged = stored && !stored.content.startsWith('Internal draft');

  // The alarm: generic symptom, a timestamp, nothing about how or why. Richer
  // detail is kept in evidence for the instructor and is NOT served to learners.
  await raiseIncident(
    'Suspicious activity detected on your blogging platform.',
    {
      observed_at: new Date().toISOString(),
      affected_resource: 'posts',
      affected_object_id: post.id,
      symptom: 'published content was modified unexpectedly',
      // instructor-only verification facts:
      _instructor: {
        victim_user_id: victimSession.user.id,
        attacker_user_id: attackerSession.user.id,
        tamper_status: tamper.status,
        cross_user: crossUser,
        content_changed: contentChanged,
      },
    }
  );

  return {
    skipped: false,
    post_id: post.id,
    victim_user_id: victimSession.user.id,
    attacker_user_id: attackerSession.user.id,
    tamper_status: tamper.status,
    cross_user: crossUser,
    succeeded,
    content_changed: contentChanged,
  };
}

/** Remove ONLY the synthetic accounts and their content, and clear the alarm. */
async function reset() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id FROM users WHERE email LIKE $1',
      [`%${config.syntheticEmailDomain}`]
    );
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await client.query('DELETE FROM comments WHERE owner_id = ANY($1::int[])', [ids]);
      await client.query('DELETE FROM posts WHERE owner_id = ANY($1::int[])', [ids]);
      // sessions cascade on user delete; deleting the users is enough.
      await client.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
    }
    await client.query('DELETE FROM warroom_access_log');
    await client.query(
      `UPDATE warroom_incident
          SET status = 'idle', headline = NULL, triggered_at = NULL,
              contained_at = NULL, resolved_at = NULL, evidence = '{}'::jsonb, updated_at = NOW()
        WHERE id = $1`,
      [config.incidentId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { reset: true };
}

module.exports = { runIncident, reset };
