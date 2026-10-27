/**
 * War Room INC-004 — "The Terraform Apply That Broke Production — EC2 Edition".
 *
 *   Pure, always-run: the deterministic engine over the deploy/aws-ec2 model
 *   (every path, every penalty, idempotency, input hardening), the
 *   captured-evidence loader, and the automatic fuse. No DB.
 *   DB-backed: the HTTP surface — auto/instructor trigger, the signed-in squad
 *   workspace, actions, report, scoring, audit, reset and a clean re-run, attempt
 *   isolation, concurrency, and "touches nothing else". With WARROOM_REQUIRE_DB=1
 *   (set by scripts/warroom-test-local.sh) a missing database FAILS these tests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT = 'INC-004';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '300';
process.env.WAR_ROOM_INSTRUCTOR_TOKEN = 'inc004-test-token';
const CAPTURED = fs.mkdtempSync(path.join(os.tmpdir(), 'inc004-captured-'));
process.env.WAR_ROOM_INC004_CAPTURED_DIR = CAPTURED;

const config = require('../src/warroom/config');
const incidents = require('../src/warroom/incidents');
const engine = require('../src/warroom/tf_ec2/engine');
const evidence = require('../src/warroom/tf_ec2/evidence');
const S = require('../src/warroom/tf_ec2/scenario');

const T0 = 1_800_000_000_000;
const run = (actions, start = engine.newAttempt('a1', T0)) => actions.reduce(
  (acc, a, i) => engine.act(acc.state, a, T0 + (i + 1) * 10_000), { state: start, result: null }
);
const out = (id, st) => engine.renderEvidence(id, st).output.join('\n');
const GOLDEN = ['view_alert', 'curl_public', 'curl_localhost', 'my_ip', 'sg_rules', 'git_log', 'tfvars_diff',
  'show_last_plan', 'plan_now', 'propose_C1', 'review_plan', 'apply_plan', 'verify'];
const REPORT = { hypothesis: 'H1', summary: 'CHG-1042 replaced our /32 with the VPN range in http_ingress_cidrs; port 80 lost our address. Fixed in Terraform.' };

afterAll(() => { fs.rmSync(CAPTURED, { recursive: true, force: true }); });

describe('INC-004 registration', () => {
  test('INC-004 is a registered, selectable incident using the shared engine contract', () => {
    expect(config.incidentId).toBe('INC-004');
    const inj = incidents.active();
    expect(inj).toBe(require('../src/warroom/injector_tf_ec2'));
    expect(typeof inj.runIncident).toBe('function');
    expect(typeof inj.reset).toBe('function');
  });
});

describe('INC-004 engine — the outage and its evidence (pure)', () => {
  test('the same actions at the same times produce byte-identical state', () => {
    expect(JSON.stringify(run(GOLDEN).state)).toBe(JSON.stringify(run(GOLDEN).state));
  });

  test('down from outside, healthy inside: a timeout, not a refusal', () => {
    const { state } = run(['curl_public', 'curl_localhost', 'docker_ps', 'ec2_status', 'listening']);
    expect(engine.serviceStatus(state)).toBe('down');
    expect(out('curl_public', state)).toMatch(/timed out/);
    expect(out('curl_public', state)).not.toMatch(/refused/i);
    expect(out('curl_localhost', state)).toMatch(/"status":"ok"/);
    expect(out('docker_ps', state)).toMatch(/healthy/);
    expect(out('ec2_status', state)).toMatch(/"running", "ok", "ok"/);
    expect(state.penalized).toEqual([]);
  });

  test('config, state and AWS agree — no drift — and our address is not in the only rule', () => {
    const { state } = run(['plan_now', 'state_list', 'sg_rules', 'my_ip']);
    expect(out('plan_now', state)).toMatch(/No changes/);
    expect(out('state_list', state)).toBe(`aws_vpc_security_group_ingress_rule.http["${S.VPN}"]`);
    expect(out('sg_rules', state)).toContain(S.VPN);
    expect(out('sg_rules', state)).not.toContain('203.0.113.10');
    expect(out('my_ip', state)).toBe('203.0.113.10');
  });
});

describe('INC-004 engine — recovery paths (pure)', () => {
  test('golden path: reviewed Terraform fix, verification, correct report → completed, 100', () => {
    let { state } = run(GOLDEN);
    expect(engine.serviceStatus(state)).toBe('up');
    expect(state.verified).toBe(true);
    expect(out('plan_C1', state)).toMatch(/1 to add, 0 to change, 0 to destroy/);
    expect(out('state_list', state)).toContain('203.0.113.10/32');
    ({ state } = engine.submitReport(state, REPORT, T0 + 999_000));
    expect(state.phase).toBe('completed');
    const sc = engine.score(state);
    expect(sc.total).toBe(100);
    expect(sc.breakdown).toEqual({ evidence: 30, diagnosis: 30, remediation: 20, verification: 10, report: 10 });
    expect(sc.time_to_verified_s).toBe(130);
  });

  test('applying without reviewing the plan still recovers but scores 15, not 20', () => {
    const { state } = run(['propose_C1', 'apply_plan', 'verify']);
    expect(state.verified).toBe(true);
    expect(engine.score(state).breakdown.remediation).toBe(15);
  });

  test('UNSAFE: a console rule for our /32 restores traffic, is INVISIBLE to terraform plan, and blocks the Terraform fix', () => {
    let { state, result } = run(['console_add_our_ip']);
    expect(result.service).toBe('up');
    ({ state } = run(['plan_now', 'state_list', 'verify'], state));
    expect(out('plan_now', state)).toMatch(/No changes/);               // drift Terraform cannot see
    expect(out('state_list', state)).not.toContain('203.0.113.10');
    expect(state.timeline.at(-1).outcome).toMatch(/no_rules_outside_terraform/);
    ({ state, result } = run(['propose_C1', 'review_plan', 'apply_plan'], state));
    expect(result.message).toMatch(/InvalidPermission\.Duplicate/);
    expect(state.tf_users_rule).toBe(false);
    expect(state.proposed).toBe('C1');                                   // still pending
    ({ state, result } = engine.act(state, 'remove_console_rules', T0 + 200_000));
    expect(result.service).toBe('down');
    ({ state } = run(['apply_plan', 'verify'], state));
    expect(state.verified).toBe(true);
    expect(engine.score(state).penalties).toEqual([{ reason: 'console_add_our_ip', points: 10 }]);
  });

  test('UNSAFE: 0.0.0.0/0 in the console works for users but fails verification on exposure', () => {
    let { state, result } = run(['console_open_world']);
    expect(result.service).toBe('up');
    ({ state } = engine.act(state, 'verify', T0 + 50_000));
    expect(state.timeline.at(-1).outcome).toMatch(/fixed_in_terraform, no_internet_wide_exposure, no_rules_outside_terraform/);
    expect(out('sg_rules', state)).toContain('0.0.0.0/0');
    expect(out('cloudtrail', state)).toMatch(/root \(AWS console\)/);
  });

  test('UNSAFE through Terraform: C3 opens the world; C5 closes it; then C1 is the real fix', () => {
    let { state } = run(['propose_C3', 'review_plan', 'apply_plan', 'verify']);
    expect(engine.serviceStatus(state)).toBe('up');
    expect(state.verified).toBe(false);
    ({ state } = run(['propose_C5', 'review_plan', 'apply_plan', 'propose_C1', 'review_plan', 'apply_plan', 'verify'], state));
    expect(state.verified).toBe(true);
    expect(engine.score(state).penalties).toEqual([{ reason: 'apply_world_open', points: 15 }]);
  });

  test('UNSAFE: replacing the instance wipes the data, changes the address, and fixes nothing', () => {
    let { state, result } = run(['replace_instance']);
    expect(engine.serviceStatus(state)).toBe('down (instance being replaced)');
    expect(out('docker_ps', state)).toMatch(/not connected/);
    ({ state, result } = engine.act(state, 'restart_containers', T0 + 30_000));
    expect(result.message).toMatch(/just as unreachable/);
    expect(out('app_logs', state)).toMatch(/posts table is empty/);
    ({ state } = run(['propose_C1', 'review_plan', 'apply_plan', 'curl_public', 'verify'], state));
    expect(out('curl_public', state)).toMatch(/NEW public address/);
    expect(state.verified).toBe(false);                                  // users' address is gone
    expect(state.timeline.at(-1).outcome).toMatch(/reachable_from_users/);
    expect(engine.score(state).penalties).toEqual([{ reason: 'replace_instance', points: 25 }]);
  });

  test('C4 (a "harmless" redeploy) plans a replacement; applying it is the same data-losing rebuild', () => {
    let { state } = run(['propose_C4', 'review_plan']);
    expect(out('plan_C4', state)).toMatch(/must be replaced[\s\S]*1 to destroy/);
    ({ state } = engine.act(state, 'apply_plan', T0 + 40_000));
    expect(state.rebuilding).toBe(true);
    expect(state.replaced).toBe(true);
  });

  test('state surgery is refused and changes nothing; restart, reboot and the wrong port are no-ops', () => {
    const { state } = run(['edit_state', 'restart_containers', 'reboot_instance', 'propose_C2', 'review_plan', 'apply_plan']);
    expect(engine.serviceStatus(state)).toBe('down');
    expect(state.timeline[0].outcome).toMatch(/Refused by change control/);
    expect(state.penalized).toEqual(['edit_state', 'apply_wrong_change']);
  });
});

describe('INC-004 engine — idempotency and hardening (pure)', () => {
  test('re-applying and repeating a penalised action never double-count', () => {
    const { state } = run(['propose_C1', 'apply_plan', 'propose_C1', 'console_open_world', 'console_open_world', 'remove_console_rules', 'verify']);
    expect(state.applied).toEqual(['C1']);
    expect(state.timeline[2].outcome).toMatch(/already applied/);
    expect(state.penalized).toEqual(['console_open_world']);
    expect(state.verified).toBe(true);
  });

  test('unknown, inherited and prototype keys are refused without changing state', () => {
    const s0 = engine.newAttempt('a1', T0);
    for (const bad of ['nope', 'constructor', '__proto__', 'toString', '', null, 42, { x: 1 }]) {
      const { state, result } = engine.act(s0, bad, T0 + 1);
      expect(result.code).toBe(400);
      expect(state).toBe(s0);
    }
    for (const hypothesis of ['constructor', '__proto__', 'H9', '', undefined]) {
      expect(engine.submitReport(s0, { hypothesis, summary: 'x' }, T0 + 1).result.code).toBe(400);
    }
    expect(engine.submitReport(s0, { hypothesis: 'H1', summary: 'x'.repeat(engine.MAX_SUMMARY + 1) }, T0).result.code).toBe(400);
  });

  test('a second report is refused; a completed attempt only allows investigation; wrong diagnosis scores 0', () => {
    let { state } = run(['propose_C1', 'review_plan', 'apply_plan', 'verify']);
    ({ state } = engine.submitReport(state, { hypothesis: 'H2', summary: 'short' }, T0 + 1));
    expect(state.phase).toBe('completed');
    expect(engine.submitReport(state, REPORT, T0 + 2).result.code).toBe(409);
    expect(engine.act(state, 'replace_instance', T0 + 3).result.code).toBe(409);
    expect(engine.act(state, 'sg_rules', T0 + 3).result.code).toBe(200);
    expect(engine.score(state).breakdown.diagnosis).toBe(0);
  });

  test('the per-attempt action cap answers 429', () => {
    let st = engine.newAttempt('a1', T0);
    for (let i = 0; i < engine.MAX_ACTIONS; i += 1) st = engine.act(st, 'sg_rules', T0 + i).state;
    expect(engine.act(st, 'sg_rules', T0 + 1e6).result.code).toBe(429);
  });

  test('the squad view never carries the answer, the internal flags, or a score before completion', () => {
    const { state } = run(['console_add_our_ip', 'replace_instance', 'propose_C1']);
    const blob = JSON.stringify(engine.publicView(state));
    for (const bad of ['"H1"', 'expected_hypothesis', '"tf_users_rule"', '"console_users_rule"', '"penalized"', '"replaced":', '"rebuilding":']) {
      expect(blob).not.toContain(bad);
    }
    expect(engine.publicView(state).score).toBeNull();
  });
});

describe('INC-004 captured evidence loader (pure)', () => {
  test('a capture replaces the simulated output only in its clean phase, labelled captured; bad files ignored', () => {
    fs.mkdirSync(path.join(CAPTURED, 'outage'), { recursive: true });
    fs.writeFileSync(path.join(CAPTURED, 'outage', 'sg_rules.txt'), '[ "tcp", 80, "198.51.100.0/24", "real capture" ]\n');
    fs.writeFileSync(path.join(CAPTURED, 'outage', 'curl_public.txt'), 'x'.repeat(21 * 1024));     // oversize
    fs.writeFileSync(path.join(CAPTURED, 'outage', 'constructor.txt'), 'not in the catalogue');
    fs.writeFileSync(path.join(CAPTURED, 'CAPTURED_AT'), '2026-10-27T00:00:00Z');
    evidence._reset();
    const down = run(['sg_rules', 'curl_public']).state;
    const sg = engine.renderEvidence('sg_rules', down);
    expect(sg.source).toBe('captured');
    expect(sg.captured_at).toBe('2026-10-27T00:00:00Z');
    expect(sg.output[0]).toMatch(/real capture/);
    expect(engine.renderEvidence('curl_public', down).source).toBe('simulated');
    const dirty = run(['console_add_our_ip', 'remove_console_rules', 'sg_rules']).state;   // not the clean outage any more
    expect(engine.renderEvidence('sg_rules', dirty).source).toBe('simulated');
    evidence._reset();
  });
});

describe('INC-004 automatic fuse (pure, fake timers)', () => {
  const timer = require('../src/warroom/timer');
  afterEach(() => { timer.cancelIncidentTimer(); jest.useRealTimers(); jest.restoreAllMocks(); });

  test('fires INC-004 exactly once after the delay, re-arming never doubles it, cancel stops it', () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(incidents, 'runIncident').mockResolvedValue({ incident: 'INC-004' });
    timer.armIncidentTimer();
    timer.armIncidentTimer();
    jest.advanceTimersByTime(299_000);
    expect(spy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(spy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3_600_000);
    expect(spy).toHaveBeenCalledTimes(1);
    timer.armIncidentTimer();
    expect(timer.cancelIncidentTimer()).toBe(true);
    jest.advanceTimersByTime(600_000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// DB-backed HTTP surface
// ---------------------------------------------------------------------------
const request = require('supertest');
let dbUp = false;
let server;
let pool;

beforeAll(async () => {
  try {
    const db = require('../src/db');
    pool = db.pool;
    await db.initDB();
    await require('../src/warroom/state').initWarRoom();
    server = require('../src/index').listen(0);
    dbUp = true;
  } catch (_e) { dbUp = false; }
});
afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (pool && dbUp) await pool.end();
});

const dbTest = (name, fn) => test(name, async () => {
  if (!dbUp) {
    if (process.env.WARROOM_REQUIRE_DB === '1') throw new Error('Postgres required (WARROOM_REQUIRE_DB=1) but unreachable');
    console.warn(`[skip:no-db] ${name}`);
    return;
  }
  await fn();
});

const TOK = { 'x-warroom-token': 'inc004-test-token' };
const PW = 'inc004-squad-passphrase';
async function signIn(email) {
  await request(server).post('/api/auth/register').send({ email, password: PW });
  const res = await request(server).post('/api/auth/login').send({ email, password: PW });
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('psec_session=')) || null;
}
const counts = async () => (await pool.query(
  'SELECT (SELECT count(*) FROM posts)::int AS posts, (SELECT count(*) FROM comments)::int AS comments, (SELECT count(*) FROM users)::int AS users'
)).rows[0];

describe('INC-004 HTTP surface (DB-backed)', () => {
  let cookie;
  beforeAll(async () => { if (dbUp) cookie = await signIn('squad-lead@inc004.test'); });
  beforeEach(async () => { if (dbUp) await request(server).post('/api/incident/reset').set(TOK); });

  dbTest('before the trigger: no alarm, and the workspace answers 409', async () => {
    expect((await request(server).get('/api/incident/status')).body.active).toBe(false);
    expect((await request(server).get('/api/incident/workspace').set('Cookie', cookie)).status).toBe(409);
  });

  dbTest('the automatic path: the fuse calls the injector, which raises a symptom-only alarm', async () => {
    const summary = await incidents.runIncident();          // exactly what timer.js calls
    expect(summary.alarm).toBe('raised');
    const status = (await request(server).get('/api/incident/status')).body;
    expect(status.active).toBe(true);
    const brief = (await request(server).get('/api/incident')).body;
    expect(brief.severity).toBe('SEV-1');
    const blob = JSON.stringify({ status, brief });
    for (const bad of ['http_ingress_cidrs', '198.51.100', '203.0.113', 'security group', 'H1', 'c19d4a7', 'CHG-1042', 'ingress']) {
      expect(blob).not.toContain(bad);
    }
    expect((await incidents.runIncident()).already_active).toBe(true);   // never double-fires
  });

  dbTest('squad endpoints: 401 without a session; instructor endpoints: 403 without the token', async () => {
    await incidents.runIncident();
    expect((await request(server).get('/api/incident/workspace')).status).toBe(401);
    expect((await request(server).post('/api/incident/actions').send({ action: 'sg_rules' })).status).toBe(401);
    expect((await request(server).post('/api/incident/report').send({ hypothesis: 'H1' })).status).toBe(401);
    expect((await request(server).get('/api/incident/debrief')).status).toBe(403);
    expect((await request(server).get('/api/incident/debrief').set('x-warroom-token', 'wrong')).status).toBe(403);
    expect((await request(server).get('/api/incident/debrief').set('Cookie', cookie)).status).toBe(403);
  });

  dbTest('input hardening over HTTP: unknown, prototype and non-string actions → 400; no 500s', async () => {
    await incidents.runIncident();
    for (const action of ['nope', 'constructor', '__proto__', 7, ['sg_rules'], { a: 1 }]) {
      expect((await request(server).post('/api/incident/actions').set('Cookie', cookie).send({ action })).status).toBe(400);
    }
    const r = await request(server).post('/api/incident/report').set('Cookie', cookie).send({ hypothesis: 'constructor', summary: 'x' });
    expect(r.status).toBe(400);
  });

  dbTest('full run over HTTP: investigate, fix through Terraform, verify, report → resolved, 100, audited', async () => {
    const before = await counts();
    await incidents.runIncident();
    for (const action of GOLDEN) {
      expect((await request(server).post('/api/incident/actions').set('Cookie', cookie).send({ action })).status).toBe(200);
    }
    const ws = (await request(server).get('/api/incident/workspace').set('Cookie', cookie)).body;
    expect(ws.service).toBe('up');
    expect(ws.service_name).toBe(S.SERVICE);
    expect(ws.actions.length).toBe(Object.keys(S.ACTIONS).length);
    expect(ws.evidence.every((e) => ['simulated', 'captured'].includes(e.source))).toBe(true);
    const rep = await request(server).post('/api/incident/report').set('Cookie', cookie).send(REPORT);
    expect(rep.status).toBe(200);
    expect(rep.body.view.completed).toBe(true);
    expect(rep.body.view.score.total).toBe(100);
    expect((await request(server).get('/api/incident/status')).body.status).toBe('resolved');
    expect((await request(server).post('/api/incident/report').set('Cookie', cookie).send(REPORT)).status).toBe(409);

    const d = (await request(server).get('/api/incident/debrief').set(TOK)).body;
    expect(d.expected_hypothesis).toBe('H1');
    expect(d.flags).toMatchObject({ fixed_in_terraform: true, plan_reviewed_before_apply: true, console_changes_made: false, instance_replaced: false });
    const actions = d.audit.map((a) => a.action);
    expect(actions[0]).toBe('trigger');
    expect(actions).toEqual(expect.arrayContaining([...GOLDEN, 'submit_report']));
    expect(d.audit.filter((a) => a.action !== 'trigger').every((a) => a.actor_email === 'squad-lead@inc004.test')).toBe(true);
    expect(await counts()).toEqual(before);                 // the application's own data is untouched
  });

  dbTest('reset closes the attempt; a re-run starts from a clean, isolated state', async () => {
    await incidents.runIncident();
    await request(server).post('/api/incident/actions').set('Cookie', cookie).send({ action: 'console_open_world' });
    const first = (await request(server).get('/api/incident/workspace').set('Cookie', cookie)).body;
    expect(first.service).toBe('up');
    const r = await request(server).post('/api/incident/reset').set(TOK);
    expect(r.body.closed_attempts).toBe(1);
    expect((await request(server).get('/api/incident/status')).body.active).toBe(false);
    expect((await request(server).post('/api/incident/actions').set('Cookie', cookie).send({ action: 'sg_rules' })).status).toBe(409);

    await request(server).post('/api/incident/trigger').set(TOK);          // instructor override
    const second = (await request(server).get('/api/incident/workspace').set('Cookie', cookie)).body;
    expect(second.attempt_id).not.toBe(first.attempt_id);
    expect(second.service).toBe('down');
    expect(second.timeline).toEqual([]);
    expect(second.evidence).toEqual([]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM warroom_inc004_attempt WHERE active');
    expect(rows[0].n).toBe(1);
  });

  dbTest('concurrent identical actions are serialised: one apply, one penalty', async () => {
    await incidents.runIncident();
    await request(server).post('/api/incident/actions').set('Cookie', cookie).send({ action: 'propose_C1' });
    const send = (action) => request(server).post('/api/incident/actions').set('Cookie', cookie).send({ action });
    const res = await Promise.all([send('apply_plan'), send('apply_plan'), send('console_open_world'), send('console_open_world')]);
    expect(res.every((r) => r.status === 200)).toBe(true);
    const d = (await request(server).get('/api/incident/debrief').set(TOK)).body;
    expect(d.score.penalties).toEqual([{ reason: 'console_open_world', points: 15 }]);
    const { rows } = await pool.query("SELECT state->'applied' AS applied FROM warroom_inc004_attempt WHERE active");
    expect(rows[0].applied).toEqual(['C1']);
  });

  dbTest('instructor status override works and is token-gated', async () => {
    await incidents.runIncident();
    expect((await request(server).post('/api/incident/status/contained')).status).toBe(403);
    expect((await request(server).post('/api/incident/status/contained').set(TOK)).body.incident.status).toBe('contained');
  });
});
