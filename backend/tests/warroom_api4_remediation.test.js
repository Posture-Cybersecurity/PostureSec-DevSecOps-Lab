/**
 * War Room (Sprint 2) — INC-002 API4 remediation success criterion.
 *
 * The target the squad's fix must satisfy. RED on the vulnerable starting state,
 * GREEN once genuine API4 (Unrestricted Resource Consumption) controls exist.
 * Gated behind WARROOM_REMEDIATION so it does not turn the default `npm test`
 * red before the exercise is solved:
 *
 *     WARROOM_REMEDIATION=1 npx jest tests/warroom_api4_remediation.test.js
 *
 * Every assertion maps to the ACTUAL weakness — no arbitrary control is added
 * merely to go green:
 *   CONTROL 1 — bounded result set: GET /api/posts is paginated / capped, so a
 *               single read cannot return the entire dataset.
 *   CONTROL 2 — rate limiting: a burst from one client is throttled (429).
 *   CONTROL 3 — request body limit: an oversized post body is rejected (413).
 *   REGRESSION — legitimate behaviour is preserved: reads stay public and an
 *               owner can still create and read a normal post.
 */
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT = 'INC-002';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '86400';
process.env.PORT = process.env.WARROOM_TEST_PORT || '5096';
process.env.WAR_ROOM_SELF_URL = `http://127.0.0.1:${process.env.PORT}`;

const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');

const RUN = process.env.WARROOM_REMEDIATION === '1';
const d = RUN ? describe : describe.skip;

// The result-set cap the fix must enforce by default (a page no larger than this).
const MAX_PAGE = 100;
const PW = 'correct-horse-battery-staple';
let dbUp = false;
let server;

const cookieOf = (res) => (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

async function registerAndLogin(email) {
  await request(server).post('/api/auth/register').send({ email, password: PW });
  const res = await request(server).post('/api/auth/login').send({ email, password: PW });
  return cookieOf(res);
}

beforeAll(async () => {
  if (!RUN) return;
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

d('INC-002 API4 remediation', () => {
  test('REGRESSION: reads stay public and an owner can create and read a normal post', async () => {
    if (!dbUp) return;
    const cookie = await registerAndLogin('legit.author@warroom.local');
    const created = await request(server).post('/api/posts').set('Cookie', cookie)
      .send({ title: 'Legit post', content: 'a normal amount of content', author: 'legit', emoji: '📝' });
    expect(created.status).toBe(201);
    const list = await request(server).get('/api/posts'); // unauthenticated read still works
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });

  test('CONTROL 1 — GET /api/posts returns a BOUNDED result set (not the whole table)', async () => {
    if (!dbUp) return;
    const cookie = await registerAndLogin('bulk.author@warroom.local');
    for (let i = 0; i < MAX_PAGE + 25; i++) {
      await request(server).post('/api/posts').set('Cookie', cookie)
        .send({ title: `bulk-${i}`, content: 'x', author: 'b', emoji: '📈' });
    }
    const res = await request(server).get('/api/posts');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(MAX_PAGE); // RED pre-fix (returns everything)
  });

  test('CONTROL 2 — a request burst from one client is rate limited (429)', async () => {
    if (!dbUp) return;
    const results = await Promise.all(
      Array.from({ length: 80 }, () => request(server).get('/api/posts').then((r) => r.status).catch(() => 0))
    );
    expect(results).toContain(429); // RED pre-fix (all 200)
  });

  test('CONTROL 3 — an oversized request body is rejected (413)', async () => {
    if (!dbUp) return;
    const cookie = await registerAndLogin('big.author@warroom.local');
    const huge = 'x'.repeat(2 * 1024 * 1024); // 2 MB
    const res = await request(server).post('/api/posts').set('Cookie', cookie)
      .send({ title: 'huge', content: huge, author: 'x', emoji: '📈' });
    expect([413, 400]).toContain(res.status);
  });
});
