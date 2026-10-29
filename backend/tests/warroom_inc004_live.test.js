/**
 * INC-004 LIVE control plane over HTTP — the War Room backend as ONE squad's platform.
 * Real backend, real Postgres (disposable, via scripts/warroom-test-local.sh), and the FAKE
 * driver injected explicitly with useDriverForTests(): nothing reaches AWS. This proves the
 * squad's shared journey through the actual API and database; it is not an AWS end-to-end test.
 */
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT = 'INC-004';
process.env.WAR_ROOM_INC004_MODE = 'live';
process.env.WAR_ROOM_SQUAD = 'alpha';
process.env.WAR_ROOM_INC004_SQUAD_CIDRS = '203.0.113.10/32,203.0.113.20/32';
process.env.WAR_ROOM_INC004_FUSE_SECONDS = '180';
process.env.WAR_ROOM_INC004_GRACE_SECONDS = '0';
process.env.WAR_ROOM_INSTRUCTOR_TOKEN = 'inc004-live-token';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '86400';

const request = require('supertest');
const { createFakeAccount, createFakeDriver, VPN } = require('../../warroom/inc004/squad/driver-fake');
const live = require('../src/warroom/injector_tf_ec2_live');
const config = require('../src/warroom/config');

const CLASSROOM = '203.0.113.10/32';
const REMOTE = '203.0.113.20/32';
let t = Date.UTC(2026, 9, 27, 9, 0, 0);
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
    await require('../src/warroom/state').setStatus('idle');   // the alarm row is shared by every suite in this database
    await live.ensureTables();
    await pool.query('DELETE FROM warroom_inc004_live');
    server = require('../src/index').listen(0);
    dbUp = true;
  } catch (_e) { dbUp = false; }
});
afterAll(async () => {
  live.stopLoop();
  if (server) await new Promise((r) => server.close(r));
  if (pool && dbUp) await pool.end();
});

// No silent skip: without a database these FAIL. WARROOM_ALLOW_NO_DB=1 marks them skipped (as skipped, never as passed).
const dbTest = process.env.WARROOM_ALLOW_NO_DB === '1' ? test.skip : (name, fn, timeout) => test(name, async () => {
  if (!dbUp) throw new Error('Postgres is required: run via scripts/warroom-test-local.sh (or set WARROOM_ALLOW_NO_DB=1 to mark these skipped)');
  await fn();
}, timeout);

const PW = 'inc004-live-passphrase';
async function signIn(email) {
  await request(server).post('/api/auth/register').send({ email, password: PW });
  const res = await request(server).post('/api/auth/login').send({ email, password: PW });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('psec_session='));
}
const TOK = { 'x-warroom-token': 'inc004-live-token' };
const as = (cookie) => ({
  get: (p) => request(server).get(`/api/incident${p}`).set('Cookie', cookie),
  post: (p, body = {}) => request(server).post(`/api/incident${p}`).set('Cookie', cookie).send(body),
});
async function settle() {          // background (202) operations: wait until the lock is free
  for (let i = 0; i < 200; i += 1) {
    if (!(await live.squad().view()).busy) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('operation never finished');
}

describe('INC-004 live: one squad, its members, through the real API', () => {
  let alice; let bob; let carol;
  beforeAll(async () => {
    if (!dbUp) return;
    driver = createFakeDriver({ account: createFakeAccount(), squad: 'alpha', squadCidrs: [CLASSROOM, REMOTE], clock, bootSeconds: 240 });
    const slowApply = driver.apply;
    driver.apply = async (name) => { await new Promise((r) => setTimeout(r, 150)); return slowApply(name); };   // real applies take time
    live.useDriverForTests(driver, clock);
    alice = as(await signIn('alice@alpha.test'));
    bob = as(await signIn('bob@alpha.test'));
    carol = as(await signIn('carol@alpha.test'));
  });

  dbTest('live mode is selected and configured from the environment; the simulation routes are not mounted', async () => {
    expect(config.inc004).toMatchObject({ mode: 'live', squad: 'alpha', squadCidrs: [CLASSROOM, REMOTE], fuseSeconds: 180 });
    expect((await request(server).get('/api/incident')).body.live).toBe(true);
    expect((await alice.post('/actions', { action: 'sg_rules' })).status).toBe(404);
    expect((await request(server).get('/api/incident/workspace')).status).toBe(401);
    expect((await alice.get('/workspace')).body.phase).toBe('new');
  });

  dbTest('the full squad journey: deploy, AUTO arm, AUTO incident (alarm raised), investigate, fix, AUTO verify, score, cleanup', async () => {
    const started = await alice.post('/live/start');
    expect(started.status).toBe(202);
    await settle();
    expect((await alice.get('/workspace')).body.phase).toBe('booting');

    advance(240); await live.tickOnce();
    expect((await bob.get('/workspace')).body.phase).toBe('armed');
    expect((await request(server).get('/api/incident/status')).body.active).toBe(false);   // nothing has happened yet

    advance(180); await live.tickOnce();
    expect((await bob.get('/workspace')).body.phase).toBe('incident');
    const status = (await request(server).get('/api/incident/status')).body;
    expect(status).toMatchObject({ active: true, headline: 'SEV-1: PostureBlogging is unreachable for every user.' });
    expect(driver.calls.filter((c) => c === 'injectFault')).toHaveLength(1);

    for (const [m, id] of [[bob, 'http_from_squad'], [carol, 'services'], [bob, 'sg_rules'], [alice, 'config'], [carol, 'plan_now']]) {
      const e = await m.post('/live/evidence', { id });
      expect(e.status).toBe(200);
    }
    expect((await bob.post('/live/evidence', { id: 'cat /etc/passwd' })).status).toBe(400);
    expect((await carol.post('/live/config', { cidrs: ['0.0.0.0/0'] })).status).toBe(400);
    expect((await carol.post('/live/config', { cidrs: 'x' })).status).toBe(400);
    expect((await carol.post('/live/config', { cidrs: [CLASSROOM, REMOTE, VPN] })).status).toBe(200);

    expect((await bob.post('/live/plan')).status).toBe(202);
    await settle();
    const plan = (await bob.get('/workspace')).body.pending_plan;
    expect(plan).toMatchObject({ by: 'bob@alpha.test' });
    expect((await alice.post('/live/review', { plan: plan.name })).status).toBe(200);

    // Two members press "apply" at the same moment: one runs, the other is told who is running it.
    const [a, b] = await Promise.all([bob.post('/live/apply', { plan: plan.name }), alice.post('/live/apply', { plan: plan.name })]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect((a.status === 409 ? a : b).body.error).toMatch(/is running "apply"/);
    await settle();
    expect(driver.lab.tf.max).toBe(1);

    await live.tickOnce();
    const done = (await carol.get('/workspace')).body;
    expect(done.phase).toBe('completed');
    expect((await request(server).get('/api/incident/status')).body.status).toBe('resolved');
    expect((await carol.post('/live/report', { hypothesis: 'H1', summary: 'CHG-1042 replaced our ingress CIDRs with the VPN range; nobody in the squad could reach port 80.' })).status).toBe(200);
    expect((await bob.post('/live/report', { hypothesis: 'H1', summary: 'again' })).status).toBe(409);
    const scored = (await alice.get('/workspace')).body.score;
    expect(scored.total).toBe(100);
    expect(scored.four_eyes_review).toBe(true);
    expect(Object.keys(scored.contributors).sort()).toEqual(['alice@alpha.test', 'bob@alpha.test', 'carol@alpha.test']);

    const d = await request(server).get('/api/incident/debrief').set(TOK);
    expect(d.status).toBe(200);
    expect(d.body.timeline.some((e) => e.by.startsWith('instructor:'))).toBe(false);   // no instructor step

    expect((await alice.post('/live/cleanup')).status).toBe(202);
    await settle();
    expect((await alice.get('/workspace')).body.phase).toBe('cleaned');
    expect(await driver.remaining()).toEqual([]);
  }, 30000);

  dbTest('instructor controls are token-gated; members cannot use them', async () => {
    expect((await request(server).get('/api/incident/debrief')).status).toBe(403);
    expect((await alice.get('/debrief')).status).toBe(403);
    expect((await alice.post('/live/override', { action: 'destroy' })).status).toBe(403);
    expect((await request(server).post('/api/incident/live/override').set(TOK).send({ action: 'rm' })).status).toBe(400);
    expect((await request(server).post('/api/incident/trigger')).status).toBe(403);
  });
});

describe('INC-004 live: persistence and squad separation in the database', () => {
  dbTest('a restarted control plane keeps the fuse and never re-fires', async () => {
    await pool.query('DELETE FROM warroom_inc004_live');
    const d2 = createFakeDriver({ account: createFakeAccount(), squad: 'alpha', squadCidrs: [CLASSROOM], clock, bootSeconds: 60 });
    live.useDriverForTests(d2, clock);
    await live.squad().start('alice@alpha.test');
    advance(60); await live.tickOnce();
    const fireAt = (await live.squad().state()).fire_at;
    live.useDriverForTests(d2, clock);                                                  // "restart": new runner, same DB row
    await live.tickOnce();
    expect((await live.squad().state()).fire_at).toBe(fireAt);
    for (let i = 0; i < 8; i += 1) { advance(60); await live.tickOnce(); }
    expect(d2.calls.filter((c) => c === 'injectFault')).toHaveLength(1);
  });

  dbTest('two squads in the same table never see or change each other', async () => {
    const C = require('../../warroom/inc004/squad/controller');
    const alpha = live.dbStore('alpha', () => C.create('alpha', t));
    const bravo = live.dbStore('bravo', () => C.create('bravo', t));
    await alpha.update((st) => { st.phase = 'incident'; return st; });
    await bravo.update((st) => st);
    expect((await bravo.load()).phase).toBe('new');
    await bravo.update((st) => { st.phase = 'armed'; return st; });
    expect((await alpha.load()).phase).toBe('incident');
    const { rows } = await pool.query("SELECT squad FROM warroom_inc004_live WHERE squad IN ('alpha','bravo') ORDER BY squad");
    expect(rows.map((r) => r.squad)).toEqual(['alpha', 'bravo']);
  });
});
