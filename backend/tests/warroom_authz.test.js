/**
 * War Room (Sprint 1) — the exercise scaffolding must work, deterministically.
 *
 * These assertions are true whether or not the object-level authorization
 * weakness has been fixed, so this suite stays green through the whole exercise:
 *   - the two synthetic accounts and the one cross-user REQUEST really happen;
 *   - the alarm is raised, and reset restores the initial state;
 *   - the instructor controls fail closed without the token.
 *
 * The squad's success criterion — that cross-user writes are REFUSED — lives in
 * warroom_remediation.test.js, which is red until the fix is applied.
 */
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INSTRUCTOR_TOKEN = 'test-instructor-token';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '86400'; // never auto-fire during tests
process.env.PORT = process.env.WARROOM_TEST_PORT || '5099';
process.env.WAR_ROOM_SELF_URL = `http://127.0.0.1:${process.env.PORT}`;

const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');
const { initWarRoom } = require('../src/warroom/state');
const config = require('../src/warroom/config');

let dbUp = false;
let server;

beforeAll(async () => {
  try {
    await initDB();
    await initWarRoom();
    dbUp = true;
    await new Promise((resolve) => { server = app.listen(process.env.PORT, '127.0.0.1', resolve); });
  } catch (err) {
    console.error('\n  DATABASE UNREACHABLE — start it first: docker compose up -d db\n  ' + err.message + '\n');
  }
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dbUp) await pool.end();
});

beforeEach(async () => {
  if (!dbUp) return;
  await pool.query('TRUNCATE warroom_access_log RESTART IDENTITY');
  await pool.query('TRUNCATE comments, posts, sessions, users RESTART IDENTITY CASCADE');
  await pool.query(
    `UPDATE warroom_incident SET status='idle', headline=NULL, triggered_at=NULL,
       contained_at=NULL, resolved_at=NULL, evidence='{}'::jsonb`
  );
});

const need = () => { if (!dbUp) throw new Error('Postgres is not running'); };
const TOKEN = { 'x-warroom-token': 'test-instructor-token' };

describe('the incident injector performs a real, synthetic cross-user action', () => {
  test('two distinct accounts, and the attacker acts on the victim\'s post', async () => {
    need();
    const summary = await require('../src/warroom/injector').runIncident();
    expect(summary.skipped).toBe(false);
    // The two actors are genuinely different users.
    expect(summary.cross_user).toBe(true);
    expect(summary.victim_user_id).not.toBe(summary.attacker_user_id);
    // A real authenticated request was made against the victim's post.
    expect(typeof summary.tamper_status).toBe('number');
    // The post is owned by the victim, not the attacker — the ownership fact
    // the squad must uncover from the evidence.
    const { rows } = await pool.query('SELECT owner_id FROM posts WHERE id = $1', [summary.post_id]);
    expect(rows[0].owner_id).toBe(summary.victim_user_id);
  });

  test('the alarm is raised and reset restores the initial state', async () => {
    need();
    await require('../src/warroom/injector').runIncident();
    let status = (await request(server).get('/api/incident/status')).body;
    expect(status.active).toBe(true);
    expect(status.id).toBe('INC-001');
    expect(status.headline).toMatch(/suspicious activity/i);

    // Reset removes ONLY the synthetic accounts and clears the alarm.
    await require('../src/warroom/injector').reset();
    status = (await request(server).get('/api/incident/status')).body;
    expect(status.active).toBe(false);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE email LIKE $1', [`%${config.syntheticEmailDomain}`]
    );
    expect(rows[0].n).toBe(0);
  });

  test('re-running after reset is deterministic', async () => {
    need();
    const a = await require('../src/warroom/injector').runIncident();
    await require('../src/warroom/injector').reset();
    const b = await require('../src/warroom/injector').runIncident();
    expect(b.skipped).toBe(false);
    expect(b.cross_user).toBe(true);
    expect(b.tamper_status).toBe(a.tamper_status);
  });

  test('the injector refuses to double-fire while an incident is active', async () => {
    need();
    await require('../src/warroom/injector').runIncident();
    const again = await require('../src/warroom/injector').runIncident();
    expect(again.skipped).toBe(true);
  });
});

describe('the incident is discoverable in honest evidence, not a spoiler label', () => {
  test('the access log records the acting user and target, and names no cause', async () => {
    need();
    const summary = await require('../src/warroom/injector').runIncident();
    const { rows } = await pool.query(
      `SELECT method, path, status, actor_user_id FROM warroom_access_log
        WHERE method = 'PUT' AND path = $1 ORDER BY id DESC LIMIT 1`,
      [`/api/posts/${summary.post_id}`]
    );
    expect(rows.length).toBe(1);
    // The PUT was made by the attacker's account against the victim's post.
    expect(rows[0].actor_user_id).toBe(summary.attacker_user_id);
    // The evidence surface contains no verdict words — the squad concludes.
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/bola|idor|broken|authoriz|vulnerab|attacker|victim/i);
  });

  test('the public incident brief states symptoms only, never the cause', async () => {
    need();
    await require('../src/warroom/injector').runIncident();
    const res = await request(server).get('/api/incident');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ['bola', 'idor', 'broken access', 'authoriz', 'vulnerab', 'owner_id', 'mallory', 'alice', 'attacker', 'victim']) {
      expect(text).not.toContain(forbidden);
    }
    // But it does pose the seven questions.
    expect(res.body.investigate).toEqual(expect.arrayContaining(['What happened?', 'How do we fix it?']));
  });
});

describe('instructor controls fail closed', () => {
  test('trigger and reset are refused without the token', async () => {
    need();
    expect((await request(server).post('/api/incident/trigger')).status).toBe(403);
    expect((await request(server).post('/api/incident/reset')).status).toBe(403);
    expect((await request(server).post('/api/incident/trigger').set('x-warroom-token', 'wrong')).status).toBe(403);
  });

  test('trigger and reset work with the token', async () => {
    need();
    const t = await request(server).post('/api/incident/trigger').set(TOKEN);
    expect(t.status).toBe(200);
    expect(t.body.ok).toBe(true);
    expect(t.body.cross_user).toBe(true);
    const r = await request(server).post('/api/incident/reset').set(TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.reset).toBe(true);
  });
});

describe('normal blogging still works (regression)', () => {
  const PW = 'correct-horse-battery-staple';
  const cookieFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('psec_session=')) || null;
  async function registerAndLogin(email) {
    await request(server).post('/api/auth/register').send({ email, password: PW });
    const res = await request(server).post('/api/auth/login').send({ email, password: PW });
    return cookieFrom(res);
  }

  test('public can read posts; an owner can create, edit and delete their own', async () => {
    need();
    const cookie = await registerAndLogin('owner@warroom-regression.test');
    const created = await request(server).post('/api/posts').set('Cookie', cookie)
      .send({ title: 'T', content: 'C' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    expect((await request(server).get('/api/posts')).status).toBe(200); // public
    const edit = await request(server).put(`/api/posts/${id}`).set('Cookie', cookie)
      .send({ title: 'T2', content: 'C2' });
    expect(edit.status).toBe(200);
    const del = await request(server).delete(`/api/posts/${id}`).set('Cookie', cookie);
    expect(del.status).toBe(200);
  });

  test('anonymous writes are refused with 401', async () => {
    need();
    expect((await request(server).put('/api/posts/1').send({ title: 'x', content: 'y' })).status).toBe(401);
    expect((await request(server).delete('/api/posts/1')).status).toBe(401);
    expect((await request(server).post('/api/posts').send({ title: 'x', content: 'y' })).status).toBe(401);
  });
});

describe('request correlation id (observability)', () => {
  const RID = /^req_[0-9a-f]{24}$/;
  const PW = 'correct-horse-battery-staple';
  const cookieFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('psec_session=')) || null;

  async function logRowFor(requestId) {
    // The access-log write happens on response finish, slightly after the
    // client sees the header — poll briefly for the row.
    for (let i = 0; i < 60; i++) {
      const { rows } = await pool.query(
        'SELECT * FROM warroom_access_log WHERE request_id = $1 ORDER BY id DESC LIMIT 1', [requestId]);
      if (rows.length) return rows[0];
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  }

  test('every response returns an opaque, server-generated X-Request-ID (not the incident id)', async () => {
    need();
    const a = await request(server).get('/api/posts');
    const b = await request(server).get('/api/health');
    expect(a.headers['x-request-id']).toMatch(RID);
    expect(b.headers['x-request-id']).toMatch(RID);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']); // unique per request
    expect(a.headers['x-request-id']).not.toMatch(/INC-001/i);             // distinct from the incident id
  });

  test('the header id ties directly to one access-log line (curl -> X-Request-ID -> logs)', async () => {
    need();
    const res = await request(server).get('/api/posts');
    const id = res.headers['x-request-id'];
    const row = await logRowFor(id);
    expect(row).not.toBeNull();
    expect(row.method).toBe('GET');
    expect(row.path).toBe('/api/posts');
    expect(row.status).toBe(200);
    expect(row.request_id).toMatch(RID);
  });

  test('the log line carries actor, action, resource, time, result and the correlation id', async () => {
    need();
    await request(server).post('/api/auth/register').send({ email: 'obs@warroom-obs.test', password: PW });
    const login = await request(server).post('/api/auth/login').send({ email: 'obs@warroom-obs.test', password: PW });
    const cookie = cookieFrom(login);
    const created = await request(server).post('/api/posts').set('Cookie', cookie).send({ title: 'T', content: 'C' });
    const row = await logRowFor(created.headers['x-request-id']);
    expect(row).not.toBeNull();
    expect(row.actor_email).toBe('obs@warroom-obs.test'); // which authenticated actor
    expect(row.actor_user_id).toBeTruthy();
    expect(row.method).toBe('POST');                      // what action
    expect(row.path).toBe('/api/posts');                  // which resource surface
    expect(row.status).toBe(201);                         // what result
    expect(row.ts).toBeTruthy();                          // when
    expect(row.request_id).toMatch(RID);                  // correlation id
  });

  test('an inbound X-Request-ID is ignored, so correlation cannot be forged', async () => {
    need();
    const forged = 'req_deadbeefdeadbeefdeadbeef';
    const res = await request(server).get('/api/posts').set('X-Request-ID', forged);
    const id = res.headers['x-request-id'];
    expect(id).toMatch(RID);
    expect(id).not.toBe(forged);                          // the server did not trust the inbound value
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM warroom_access_log WHERE request_id = $1', [forged]);
    expect(rows[0].n).toBe(0);                            // nothing logged under the attacker-chosen id
    expect(await logRowFor(id)).not.toBeNull();           // the server id is what was logged
  });

  test('the suspicious cross-user PUT is correlatable and the log leaks no secret or cause', async () => {
    need();
    const summary = await require('../src/warroom/injector').runIncident();
    const { rows } = await pool.query(
      "SELECT * FROM warroom_access_log WHERE method='PUT' AND path=$1 ORDER BY id DESC LIMIT 1",
      [`/api/posts/${summary.post_id}`]);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.request_id).toMatch(RID);                  // the suspicious write has a request id
    expect(row.actor_user_id).toBe(summary.attacker_user_id);
    const dump = JSON.stringify(row);
    // No root-cause labels in the evidence.
    expect(dump).not.toMatch(/bola|idor|broken access|authoriz|vulnerab/i);
    // No credentials/secrets: no cookie, no password, no bcrypt hash, no auth header.
    expect(dump).not.toMatch(/psec_session|password|\$2[aby]\$|authorization|bearer/i);
    // The session fingerprint is a short prefix, never the whole cookie/secret.
    if (row.session_fp) expect(row.session_fp.length).toBeLessThanOrEqual(8);
    // The injector's internal verdict fields are NOT in the learner-visible log.
    expect(dump).not.toMatch(/victim_user_id|attacker_user_id|cross_user|succeeded|content_changed/);
  });

  test('the request-id column stores only the opaque id, and no row holds a raw cookie/secret', async () => {
    need();
    await request(server).post('/api/auth/register').send({ email: 'sec@warroom-obs.test', password: PW });
    const login = await request(server).post('/api/auth/login').send({ email: 'sec@warroom-obs.test', password: PW });
    await request(server).get('/api/posts').set('Cookie', cookieFrom(login));
    const { rows } = await pool.query('SELECT * FROM warroom_access_log');
    for (const row of rows) {
      if (row.request_id !== null) expect(row.request_id).toMatch(RID);
      const dump = JSON.stringify(row);
      expect(dump).not.toMatch(/password|\$2[aby]\$/i);           // no password / hash
      expect(dump).not.toMatch(/psec_session=/);                    // no full session cookie
      expect(Object.keys(row).sort()).toEqual([
        'actor_email', 'actor_user_id', 'duration_ms', 'id', 'ip',
        'method', 'path', 'request_id', 'session_fp', 'status', 'ts',
      ]);                                                           // only the safe columns exist
    }
  });
});

