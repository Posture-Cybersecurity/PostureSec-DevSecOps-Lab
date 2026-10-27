/**
 * INC-005 control plane over HTTP — the real War Room backend, real Postgres (disposable, via
 * scripts/warroom-test-local.sh), and the FAKE drift driver injected explicitly: nothing reaches
 * AWS. Proves the squad's journey through the actual API and database; NOT an AWS end-to-end test.
 *
 * No silent skip: without a database these tests FAIL. WARROOM_ALLOW_NO_DB=1 marks them skipped
 * (reported as skipped by jest, never as passed).
 */
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT = 'INC-005';
process.env.WAR_ROOM_SQUAD = 'alpha';
process.env.WAR_ROOM_INC004_SQUAD_CIDRS = '203.0.113.10/32';
process.env.WAR_ROOM_INC004_FUSE_SECONDS = '180';
process.env.WAR_ROOM_INC004_GRACE_SECONDS = '0';
process.env.WAR_ROOM_INSTRUCTOR_TOKEN = 'inc005-token';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '86400';

const request = require('supertest');
const { createFakeAccount, createFakeDriftDriver } = require('../../warroom/inc004/squad/driver-fake-drift');
const drift = require('../src/warroom/injector_tf_drift');
const config = require('../src/warroom/config');

const NET = '203.0.113.10/32';
let t = Date.UTC(2026, 9, 28, 9, 0, 0);
const clock = () => t;
const advance = (s) => { t += s * 1000; };
let driver;

let dbUp = false;
let server;
let pool;
beforeAll(async () => {
  try {
    const db = require('../src/db');
    pool = db.pool;
    await db.initDB();
    await require('../src/warroom/state').initWarRoom();
    await drift.ensureTables();
    await pool.query('DELETE FROM warroom_inc005_drift');
    server = require('../src/index').listen(0);
    dbUp = true;
  } catch (e) { dbUp = false; console.error(`[inc005-live] database unavailable: ${e.message}`); }
});
afterAll(async () => {
  drift.stopLoop();
  if (server) await new Promise((r) => server.close(r));
  if (pool && dbUp) await pool.end();
});

const dbTest = process.env.WARROOM_ALLOW_NO_DB === '1' ? test.skip : (name, fn, timeout) => test(name, async () => {
  if (!dbUp) throw new Error('Postgres is required: run via scripts/warroom-test-local.sh (or set WARROOM_ALLOW_NO_DB=1 to mark these skipped)');
  await fn();
}, timeout);

const PW = 'inc005-live-passphrase';
async function signIn(email) {
  await request(server).post('/api/auth/register').send({ email, password: PW });
  const res = await request(server).post('/api/auth/login').send({ email, password: PW });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('psec_session='));
}
const TOK = { 'x-warroom-token': 'inc005-token' };
const as = (cookie) => ({
  get: (p) => request(server).get(`/api/incident${p}`).set('Cookie', cookie),
  post: (p, body = {}) => request(server).post(`/api/incident${p}`).set('Cookie', cookie).send(body),
});
async function settle() {
  for (let i = 0; i < 300; i += 1) {
    if (!(await drift.squad().view()).busy) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('operation never finished');
}

describe('INC-005 live: one squad, its members, through the real API and database', () => {
  let alice; let bob; let carol;
  beforeAll(async () => {
    if (!dbUp) return;
    driver = createFakeDriftDriver({ account: createFakeAccount(), squad: 'alpha', squadCidrs: [NET], clock, bootSeconds: 240 });
    const slowApply = driver.apply;
    driver.apply = async (name) => { await new Promise((r) => setTimeout(r, 150)); return slowApply(name); };
    drift.useDriverForTests(driver, clock);
    alice = as(await signIn('alice@alpha5.test'));
    bob = as(await signIn('bob@alpha5.test'));
    carol = as(await signIn('carol@alpha5.test'));
  });

  dbTest('INC-005 is selected; its workspace needs a session; INC-004-only routes are not mounted', async () => {
    expect(config.incident).toBe('INC-005');
    expect((await request(server).get('/api/incident')).body.live).toBe(true);
    expect((await request(server).get('/api/incident/workspace')).status).toBe(401);
    const ws = (await alice.get('/workspace')).body;
    expect(ws).toMatchObject({ incident: 'INC-005', phase: 'new' });
    expect(ws.evidence_views.map((e) => e.id)).toEqual(['http_from_squad', 'services', 'sg_rules', 'state_rules', 'plan_now', 'change_history']);
    for (const p of ['/live/config', '/live/review', '/live/report', '/actions']) expect((await alice.post(p, {})).status).toBe(404);
  });

  dbTest('the journey: deploy, AUTO ready, AUTO drift (alarm), investigate, plan, inspect, apply, AUTO verify + score, cleanup — no instructor', async () => {
    expect((await alice.post('/live/start')).status).toBe(202);
    await settle();
    expect((await alice.get('/workspace')).body.phase).toBe('booting');

    advance(240); await drift.tickOnce();
    expect((await bob.get('/workspace')).body.phase).toBe('ready');
    expect((await request(server).get('/api/incident/status')).body.active).toBe(false);

    advance(180); await drift.tickOnce();
    expect((await bob.get('/workspace')).body.phase).toBe('incident');
    expect((await request(server).get('/api/incident/status')).body).toMatchObject({ active: true, headline: 'SEV-2: PostureBlogging is unreachable from the squad\'s network.' });
    await drift.tickOnce();                                                   // outage recorded
    expect((await carol.get('/workspace')).body.timeline.map((e) => e.event)).toContain('detected');

    for (const [m, id] of [[bob, 'http_from_squad'], [carol, 'sg_rules'], [alice, 'plan_now']]) {
      expect((await m.post('/live/evidence', { id })).status).toBe(200);
    }
    expect((await bob.post('/live/evidence', { id: 'cat /etc/passwd' })).status).toBe(400);

    expect((await bob.post('/live/plan')).status).toBe(202);
    await settle();
    const plan = (await bob.get('/workspace')).body.pending_plan;
    expect(plan).toMatchObject({ by: 'bob@alpha5.test', summary: 'Plan: 1 to add, 0 to change, 0 to destroy.' });
    expect((await carol.post('/live/inspect', { plan: plan.name })).body.message).toMatch(/1 to add/);
    expect((await carol.post('/live/inspect', { plan: 'restore-alpha-forged' })).status).toBe(409);

    // While the apply runs: reads are served; a second Terraform step gets ONE clear 409.
    const first = await bob.post('/live/apply', { plan: plan.name });
    expect(first.status).toBe(202);
    expect((await carol.post('/live/evidence', { id: 'state_rules' })).status).toBe(200);
    expect((await carol.get('/workspace')).body.busy).toMatchObject({ kind: 'apply', by: 'bob@alpha5.test' });
    const second = await alice.post('/live/apply', { plan: plan.name });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/bob@alpha5.test is running "apply"/);
    await settle();
    expect(driver.lab.tf.max).toBe(1);

    await drift.tickOnce();
    const done = (await carol.get('/workspace')).body;
    expect(done.phase).toBe('completed');
    expect(Object.values(done.checks.results).every(Boolean)).toBe(true);
    expect(done.score).toMatchObject({ total: 100, penalties: [] });
    expect((await request(server).get('/api/incident/status')).body.status).toBe('resolved');

    const d = await request(server).get('/api/incident/debrief').set(TOK);
    expect(d.status).toBe(200);
    expect(d.body.timeline.some((e) => e.by.startsWith('instructor:'))).toBe(false);
    expect(JSON.stringify(d.body.timeline)).not.toContain('203.0.113.10');

    expect((await alice.post('/live/cleanup')).status).toBe(202);
    await settle();
    expect((await alice.get('/workspace')).body.phase).toBe('cleaned');
    expect(await driver.remaining()).toEqual([]);
  }, 30000);

  dbTest('instructor controls are token-gated; members cannot use them', async () => {
    expect((await request(server).get('/api/incident/debrief')).status).toBe(403);
    expect((await alice.post('/live/override', { action: 'destroy' })).status).toBe(403);
    expect((await request(server).post('/api/incident/live/override').set(TOK).send({ action: 'rm' })).status).toBe(400);
    expect((await request(server).post('/api/incident/trigger')).status).toBe(403);
  });
});

describe('INC-005 live: no lock contention, persistence, separation', () => {
  dbTest('during a long platform check, members get answers, not 409s', async () => {
    await pool.query('DELETE FROM warroom_inc005_drift');
    const d = createFakeDriftDriver({ account: createFakeAccount(), squad: 'alpha', squadCidrs: [NET], clock, bootSeconds: 60 });
    drift.useDriverForTests(d, clock);
    const bob = as(await signIn('bob@alpha5.test'));
    await drift.squad().start('alice@alpha5.test');
    advance(60); await drift.tickOnce();
    advance(180); await drift.tickOnce();
    expect((await drift.squad().view()).phase).toBe('incident');
    let release;
    d.gate = new Promise((r) => { release = r; });
    advance(60);
    const check = drift.tickOnce();
    await new Promise((r) => setTimeout(r, 20));
    d.gate = null;
    const answers = [];
    answers.push((await bob.post('/live/evidence', { id: 'sg_rules' })).status);
    answers.push((await bob.get('/workspace')).status);
    answers.push((await bob.post('/live/plan')).status);
    await settle();
    const plan = (await bob.get('/workspace')).body.pending_plan;
    answers.push((await bob.post('/live/inspect', { plan: plan.name })).status);
    expect(answers).toEqual([200, 200, 202, 200]);
    release();
    await check;
  });

  dbTest('a restarted control plane keeps the fuse and never injects twice', async () => {
    await pool.query('DELETE FROM warroom_inc005_drift');
    const d2 = createFakeDriftDriver({ account: createFakeAccount(), squad: 'alpha', squadCidrs: [NET], clock, bootSeconds: 60 });
    drift.useDriverForTests(d2, clock);
    await drift.squad().start('alice@alpha5.test');
    advance(60); await drift.tickOnce();
    const fireAt = (await drift.squad().state()).fire_at;
    drift.useDriverForTests(d2, clock);                                       // "restart": new runner, same row
    await drift.tickOnce();
    expect((await drift.squad().state()).fire_at).toBe(fireAt);
    for (let i = 0; i < 8; i += 1) { advance(60); await drift.tickOnce(); }
    expect(d2.calls.filter((c) => c === 'injectDrift')).toHaveLength(1);
  });

  dbTest('two squads in the same table never see or change each other', async () => {
    const { dbStore } = require('../src/warroom/injector_tf_ec2_live');
    const C = require('../../warroom/inc004/squad/drift-controller');
    const alpha = dbStore('alpha', () => C.create('alpha', t), drift.TABLE);
    const bravo = dbStore('bravo', () => C.create('bravo', t), drift.TABLE);
    await alpha.update((st) => { st.phase = 'incident'; return st; });
    await bravo.update((st) => st);
    expect((await bravo.load()).phase).toBe('new');
    expect(() => dbStore('alpha', () => ({}), 'users')).toThrow(/unknown squad table/);
  });
});
