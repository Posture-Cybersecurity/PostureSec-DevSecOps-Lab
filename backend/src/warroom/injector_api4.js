/**
 * INC-002 injector — OWASP API4 (Unrestricted Resource Consumption).
 *
 * A CONTROLLED, BOUNDED, synthetic-but-real workload against the application's
 * OWN api. It does not fabricate evidence: it registers one obviously-synthetic
 * account, creates a bounded number of synthetic posts, then makes GENUINE,
 * rate- and concurrency-limited GET requests to the unpaginated, unauthenticated
 * `GET /api/posts` — the app's real weakness — over the real HTTP stack, captured
 * by the real logging middleware. Rising `duration_ms` in warroom_access_log is
 * the honest evidence; the injector writes no conclusion a learner can read.
 *
 * SAFETY (this is a training aid, never a DoS tool):
 *   * it targets ONLY config.selfBaseUrl (this app) and ONLY config.api4.endpoint.
 *     It accepts no URL and cannot be pointed at another host.
 *   * every phase is hard-bounded: max synthetic posts, request concurrency,
 *     request rate, an absolute request ceiling, AND a wall-clock deadline
 *     (maxRuntimeSec) after which it stops no matter what. Each request has its
 *     own timeout. There is no open-ended loop.
 *   * it refuses to double-fire while an incident is already active.
 *   * reset() removes ONLY the synthetic account and its content.
 */
const { pool } = require('../db');
const config = require('./config');
const { getIncident, raiseIncident } = require('./state');

const base = config.selfBaseUrl.replace(/\/$/, '');
const A = config.api4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The single synthetic actor for INC-002. Tagged @warroom.local so reset can
// find and remove exactly this account and its posts, and nothing a learner made.
const ACTOR = {
  email: 'trevor.loadtest@warroom.local',
  password: 'warroom-api4-passphrase-01',
};

function cookiesOf(res) {
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return list.map((c) => c.split(';')[0]).join('; ');
}

/** One request to THIS app, with a hard per-request timeout. Never throws. */
async function call(method, path, { cookie, body } = {}) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), A.perRequestTimeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Drain the body: the API4 cost is in building and transferring the full,
    // unpaginated payload, so we must actually read it to exert the pressure.
    const buf = await res.arrayBuffer().catch(() => null);
    return { ok: true, status: res.status, cookie: cookiesOf(res),
             bytes: buf ? buf.byteLength : 0, ms: Date.now() - t0 };
  } catch (err) {
    // Aborted/timed-out/connection-refused — all expected under degradation.
    return { ok: false, status: 0, error: err.name || 'error', ms: Date.now() - t0 };
  } finally {
    clearTimeout(to);
  }
}

async function ensureRegistered() {
  const res = await call('POST', '/api/auth/register', { body: ACTOR });
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`register synthetic actor: unexpected status ${res.status}`);
  }
}

async function login() {
  const res = await call('POST', '/api/auth/login', { body: ACTOR });
  if (res.status !== 200 || !res.cookie) throw new Error(`login synthetic actor failed (${res.status})`);
  return res.cookie;
}

/** Seed up to maxPosts bounded synthetic posts. Rate/concurrency limited. */
async function seed(cookie, deadline) {
  const content = 'x'.repeat(A.postSizeBytes);   // bounded body, < the 100kb cap
  let created = 0, attempted = 0, inFlight = 0;
  const spacing = 1000 / A.ratePerSec;
  async function one(i) {
    inFlight++; attempted++;
    const res = await call('POST', '/api/posts', {
      cookie,
      body: { title: `loadtest-synthetic-${i}`, content, author: 'loadtest', emoji: '📈' },
    });
    if (res.status === 201) created++;
    inFlight--;
  }
  let i = 0;
  while (created + inFlight < A.maxPosts && attempted < A.maxPosts && Date.now() < deadline) {
    if (inFlight < A.concurrency) one(i++);
    await sleep(spacing);
  }
  const drainBy = Date.now() + A.perRequestTimeoutMs + 1000;
  while (inFlight > 0 && Date.now() < drainBy) await sleep(50);
  return { created };
}

/** Drive bounded concurrent GETs against the vulnerable endpoint. */
async function pressure(deadline) {
  let sent = 0, ok = 0, failed = 0, inFlight = 0, maxMs = 0, minMs = Infinity, peakBytes = 0;
  const spacing = 1000 / A.ratePerSec;
  async function one() {
    inFlight++; sent++;
    const res = await call('GET', A.endpoint, {});
    if (res.ok && res.status === 200) { ok++; maxMs = Math.max(maxMs, res.ms); minMs = Math.min(minMs, res.ms); peakBytes = Math.max(peakBytes, res.bytes || 0); }
    else failed++;
    inFlight--;
  }
  while (Date.now() < deadline && sent < A.maxRequests) {
    if (inFlight < A.concurrency) one();
    await sleep(spacing);
  }
  const drainBy = Date.now() + A.perRequestTimeoutMs + 1000;
  while (inFlight > 0 && Date.now() < drainBy) await sleep(50);
  return { sent, ok, failed, minMs: minMs === Infinity ? null : minMs, maxMs, peakBytes };
}

/**
 * Run INC-002. Returns an INSTRUCTOR-only summary — never exposed through a
 * learner-facing endpoint. Hard-stops at config.api4.maxRuntimeSec.
 */
async function runIncident() {
  if (config.incident !== 'INC-002') {
    throw new Error('INC-002 injector invoked while a different incident is selected');
  }
  const existing = await getIncident();
  if (existing && existing.status === 'active') return { skipped: true, reason: 'already-active' };

  const deadline = Date.now() + A.maxRuntimeSec * 1000;
  await ensureRegistered();
  const cookie = await login();

  // Baseline latency on the (still healthy) endpoint, for the evidence contrast.
  const baseline = await call('GET', A.endpoint, {});

  // Raise the alarm BEFORE applying pressure. On a host where the pressure
  // actually restarts the process (PM2 max_memory_restart / container OOM), the
  // alarm is already persisted, so the incident is observable after recovery.
  // The instructor's trigger response (below) carries the peak/degradation facts.
  await raiseIncident(
    'POSTURESec is experiencing intermittent availability issues. '
    + 'API response times are increasing and users are reporting timeouts.',
    {
      observed_at: new Date().toISOString(),
      symptom: 'rising API latency and intermittent timeouts',
      affected_resource: 'api',
      // instructor-only verification facts — NOT served to learners:
      _instructor: {
        endpoint: A.endpoint,
        baseline_ms: baseline.ms || null,
        bounds: A,
      },
    }
  );

  const seeded = await seed(cookie, deadline);
  const load = await pressure(deadline);
  const degraded = load.maxMs > Math.max(50, (baseline.ms || 0) * 3) || load.failed > 0;

  return {
    skipped: false,
    synthetic_posts_created: seeded.created,
    requests_sent: load.sent,
    requests_ok: load.ok,
    requests_failed: load.failed,
    baseline_ms: baseline.ms || null,
    peak_ms: load.maxMs,
    peak_response_bytes: load.peakBytes,
    degradation_observed: degraded,
  };
}

/** Remove ONLY the synthetic actor and its content, and clear the alarm. */
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
