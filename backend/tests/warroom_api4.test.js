/**
 * War Room (Sprint 2) — INC-002 API4 (Unrestricted Resource Consumption).
 *
 * Proves the incident is REAL and SAFE, following the Sprint 1 testing model:
 *   POSITIVE   — the injector, within tiny bounds, creates synthetic load and
 *                raises the incident; honest evidence (duration_ms) is recorded.
 *   NEGATIVE   — the vulnerability exists (GET /api/posts is unpaginated) and the
 *                student-facing brief never names API4/the endpoint/the attacker.
 *   SAFETY     — every injector bound is clamped; the injector targets only this
 *                app; reset removes ONLY synthetic data.
 *   AUTHZ      — trigger/reset are refused without the instructor token.
 *
 * DB-backed cases no-op when no database is reachable (guard at the top of each),
 * so `npm test` stays green off-box; the bound/config cases always run.
 */
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT = 'INC-002';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '86400'; // never auto-fire during tests
process.env.PORT = process.env.WARROOM_TEST_PORT || '5097';
process.env.WAR_ROOM_SELF_URL = `http://127.0.0.1:${process.env.PORT}`;
process.env.WAR_ROOM_INSTRUCTOR_TOKEN = 'test-instructor-token';
// Tiny, fast, safe bounds for the automated run.
process.env.WAR_ROOM_API4_MAX_POSTS = '5';
process.env.WAR_ROOM_API4_POST_BYTES = '1000';
process.env.WAR_ROOM_API4_CONCURRENCY = '2';
process.env.WAR_ROOM_API4_RATE_PER_SEC = '50';
process.env.WAR_ROOM_API4_MAX_RUNTIME_SECONDS = '5';   // the clamp floor (min 5s); shortest valid window
process.env.WAR_ROOM_API4_REQ_TIMEOUT_MS = '2000';     // bounded drain for tests

// The injector legitimately runs for its (short, test-tuned) window, so give
// tests that fire it more than jest's 5s default.
jest.setTimeout(30000);

const path = require('path');
const fs = require('fs');
const request = require('supertest');
const config = require('../src/warroom/config');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');

let dbUp = false;
let server;

beforeAll(async () => {
  try {
    await initDB();
    await require('../src/warroom/state').initWarRoom();
    dbUp = true;
    await new Promise((r) => { server = app.listen(process.env.PORT, '127.0.0.1', r); });
  } catch (err) {
    console.error('DATABASE UNREACHABLE: ' + err.message);
  }
});

afterAll(async () => {
  try { if (dbUp) await require('../src/warroom/injector_api4').reset(); } catch { /* best effort */ }
  if (server) await new Promise((r) => server.close(r));
  if (dbUp) await pool.end();
});

// ---------------------------------------------------------------- bounds (no DB)
describe('INC-002 safety bounds (config)', () => {
  test('out-of-range injector bounds fall back to safe defaults; in-range are honored', () => {
    jest.resetModules();
    const saved = { ...process.env };
    process.env.WAR_ROOM_INCIDENT = 'INC-002';
    process.env.WAR_ROOM_API4_MAX_POSTS = '999999';      // > max(2000) -> default 300
    process.env.WAR_ROOM_API4_CONCURRENCY = '0';          // < min(1)   -> default 8
    process.env.WAR_ROOM_API4_MAX_RUNTIME_SECONDS = '99999'; // > max    -> default 45
    process.env.WAR_ROOM_API4_RATE_PER_SEC = '20';        // in range   -> honored
    const c = require('../src/warroom/config');
    expect(c.api4.maxPosts).toBe(300);
    expect(c.api4.concurrency).toBe(8);
    expect(c.api4.maxRuntimeSec).toBe(45);
    expect(c.api4.ratePerSec).toBe(20);
    expect(c.api4.endpoint).toBe('/api/posts'); // fixed
    process.env = { ...saved };
    jest.resetModules();
  });

  test('the injector targets only this app (no arbitrary/ env-supplied URL)', () => {
    expect(config.api4.endpoint).toBe('/api/posts');
    expect(config.selfBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    const src = fs.readFileSync(path.join(__dirname, '../src/warroom/injector_api4.js'), 'utf8');
    expect(src).toMatch(/config\.selfBaseUrl/);   // base derived from config only
    expect(src).not.toMatch(/process\.env/);       // reads no env target of its own
  });
});

// ---------------------------------------------------------------- vulnerability
describe('INC-002 vulnerability (API4) is present', () => {
  test('GET /api/posts is unpaginated — it returns every row', async () => {
    if (!dbUp) return;
    const reg = 'probe.reader@warroom.local';
    await request(server).post('/api/auth/register').send({ email: reg, password: 'probe-pass-01' });
    const login = await request(server).post('/api/auth/login').send({ email: reg, password: 'probe-pass-01' });
    const cookie = (login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const before = (await request(server).get('/api/posts')).body.length;
    for (let i = 0; i < 12; i++) {
      await request(server).post('/api/posts').set('Cookie', cookie)
        .send({ title: `probe-${i}`, content: 'probe', author: 'p', emoji: '📈' });
    }
    const res = await request(server).get('/api/posts'); // unauthenticated read
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(before + 12);            // no LIMIT, no page cap
    await require('../src/warroom/injector_api4').reset();
  });
});

// ---------------------------------------------------------------- injector + reset
describe('INC-002 injector is real, bounded, and reversible', () => {
  test('runs within bounds, raises the incident, and records honest evidence', async () => {
    if (!dbUp) return;
    const injector = require('../src/warroom/injector_api4');
    await injector.reset();
    const summary = await injector.runIncident();
    expect(summary.skipped).toBeFalsy();
    expect(summary.synthetic_posts_created).toBeLessThanOrEqual(5);   // maxPosts bound
    expect(summary.requests_sent).toBeGreaterThan(0);

    const inc = await request(server).get('/api/incident/status');
    expect(inc.body.active).toBe(true);
    expect(inc.body.headline).toMatch(/availability|response times|timeouts/i);

    const { rows } = await pool.query(
      "SELECT method, path, duration_ms FROM warroom_access_log WHERE path = '/api/posts' AND method = 'GET' LIMIT 5"
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].duration_ms).not.toBeNull();
  });

  test('reset removes ONLY synthetic data and clears the alarm', async () => {
    if (!dbUp) return;
    const injector = require('../src/warroom/injector_api4');
    await injector.runIncident().catch(() => {});
    await injector.reset();
    const synth = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE email LIKE '%@warroom.local'");
    expect(synth.rows[0].n).toBe(0);
    const log = await pool.query('SELECT COUNT(*)::int AS n FROM warroom_access_log');
    expect(log.rows[0].n).toBe(0);
    const inc = await request(server).get('/api/incident/status');
    expect(inc.body.active).toBe(false);
  });
});

// ---------------------------------------------------------------- authz + non-disclosure
describe('INC-002 instructor controls and student non-disclosure', () => {
  test('trigger and reset are refused without the instructor token (fail closed)', async () => {
    if (!dbUp) return;
    expect((await request(server).post('/api/incident/trigger')).status).toBe(403);
    expect((await request(server).post('/api/incident/reset')).status).toBe(403);
    expect((await request(server).post('/api/incident/trigger').set('x-warroom-token', 'wrong')).status).toBe(403);
  });

  test('the student brief never reveals API4, the endpoint, the attacker or the injector', async () => {
    if (!dbUp) return;
    await require('../src/warroom/injector_api4').runIncident().catch(() => {});
    const res = await request(server).get('/api/incident');
    const blob = JSON.stringify(res.body).toLowerCase();
    expect(blob).not.toContain('api4');
    expect(blob).not.toContain('/api/posts');
    expect(blob).not.toContain('attacker');
    expect(blob).not.toContain('injector');
    expect(blob).not.toContain('resource consumption');
    await require('../src/warroom/injector_api4').reset();
  });
});
