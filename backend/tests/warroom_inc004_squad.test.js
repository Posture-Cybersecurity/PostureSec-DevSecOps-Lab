/**
 * INC-004 squad-operated real-lab platform — proven locally with the FAKE driver.
 *
 * One squad = one lab, one state, one fuse, one timeline, one recovery, one score. Several
 * authenticated members collaborate on it; isolation is between squads. Callers here are only
 * squad MEMBERS (start, evidence, setConfig, plan, review, apply, report, cleanup) and the
 * PLATFORM loop (tick). The instructor override exists but the normal journey never uses it.
 *
 * These tests exercise the controller, runner and lock against a model of AWS. They are NOT an
 * AWS end-to-end test: driver-real.js against real infrastructure has not been run.
 */
const C = require('../../warroom/inc004/squad/controller');
const { squadRunner, Busy, LockLost } = require('../../warroom/inc004/squad/runner');
const { memoryStore } = require('../../warroom/inc004/squad/store-memory');
const { createFakeAccount, createFakeDriver, VPN } = require('../../warroom/inc004/squad/driver-fake');

const CLASSROOM = '203.0.113.10/32';
const REMOTE = '203.0.113.20/32';
const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);

function world() {
  let t = T0;
  const account = createFakeAccount();
  const clock = () => t;
  const squad = (id, cidrs = [CLASSROOM, REMOTE], opts = {}) => {
    const driver = createFakeDriver({ account, squad: id, squadCidrs: cidrs, clock, bootSeconds: 240 });
    const store = memoryStore(C.create(id, t, { fuseSeconds: 180, graceSeconds: 0, ...opts }));
    return { id, driver, store, r: squadRunner({ store, driver, clock }) };
  };
  const advance = (s) => { t += s * 1000; };
  const runFor = async (squads, seconds, step = 30) => {
    for (let i = 0; i < seconds; i += step) { advance(step); for (const s of squads) await s.r.tick(); }
  };
  return { account, squad, advance, runFor, now: () => t };
}

const phase = async (s) => (await s.r.view()).phase;

async function toIncident(w, s) {
  expect((await s.r.start('alice@squad.test')).ok).toBe(true);
  await w.runFor([s], 450);
  expect(await phase(s)).toBe('incident');
}

async function fixTogether(w, s) {
  w.advance(20);
  expect((await s.r.setConfig('carol@squad.test', [CLASSROOM, REMOTE, VPN])).ok).toBe(true);
  const p = await s.r.plan('bob@squad.test');
  expect(p.ok).toBe(true);
  expect((await s.r.review('alice@squad.test', p.plan)).ok).toBe(true);       // a second pair of eyes
  expect((await s.r.apply('bob@squad.test', p.plan)).ok).toBe(true);
  return p.plan;
}

describe('one squad, one shared lifecycle, several members — no instructor', () => {
  test('deploy → auto-ready → auto-armed → AUTO incident → members investigate and fix together → AUTO verified → ONE squad score → cleanup', async () => {
    const w = world();
    const s = w.squad('alpha');
    expect((await s.r.start('alice@squad.test')).ok).toBe(true);
    expect(await phase(s)).toBe('booting');
    await w.runFor([s], 210);
    expect(await phase(s)).toBe('booting');
    await w.runFor([s], 30);
    expect(await phase(s)).toBe('armed');                                     // readiness → armed automatically
    await w.runFor([s], 150);
    expect(await phase(s)).toBe('armed');
    await w.runFor([s], 30);
    expect(await phase(s)).toBe('incident');                                  // fired automatically, once
    expect(s.driver.calls.filter((c) => c === 'injectFault')).toHaveLength(1);

    const outage = await s.driver.observe();
    expect(outage).toMatchObject({ http_from_squad: 0, app_health_inside: true, plan_noop: true });

    for (const [who, e] of [['bob@squad.test', 'http_from_squad'], ['carol@squad.test', 'services'], ['bob@squad.test', 'sg_rules'],
      ['alice@squad.test', 'config'], ['carol@squad.test', 'plan_now']]) {
      w.advance(20);
      expect((await s.r.evidence(who, e)).ok).toBe(true);
    }
    await fixTogether(w, s);
    expect(await phase(s)).toBe('recovering');
    await s.r.tick();
    expect(await phase(s)).toBe('completed');
    expect((await s.r.report('carol@squad.test', { hypothesis: 'H1', summary: 'CHG-1042 replaced our ingress CIDRs with the VPN range; port 80 lost every squad address.' })).ok).toBe(true);

    const v = await s.r.view();
    expect(v.score.total).toBe(100);
    expect(v.score.four_eyes_review).toBe(true);
    expect(Object.keys(v.score.contributors).sort()).toEqual(['alice@squad.test', 'bob@squad.test', 'carol@squad.test']);
    expect(Object.values(v.checks).every(Boolean)).toBe(true);
    expect(s.driver.lab.aws.tags).toMatchObject({ WarRoomPhase: 'completed', WarRoomScore: '100' });

    // ONE lab, ONE state, ONE incident for the whole squad.
    expect(Object.keys(w.account.labs)).toEqual(['alpha']);
    expect(v.timeline.filter((e) => e.event === 'incident')).toHaveLength(1);
    expect(v.timeline.every((e) => e.by)).toBe(true);
    expect(v.timeline.some((e) => e.by.startsWith('instructor:'))).toBe(false);   // no instructor step

    expect((await s.r.cleanup('alice@squad.test')).ok).toBe(true);
    expect(await phase(s)).toBe('cleaned');
    expect(await s.driver.remaining()).toEqual([]);
    expect(v.timeline.map((e) => `${e.by.split('@')[0]}:${e.event}`)).toEqual([
      'alice:deploy_plan', 'alice:deployed', 'platform:ready', 'platform:armed', 'platform:incident',
      'bob:evidence', 'carol:evidence', 'bob:evidence', 'alice:evidence', 'carol:evidence',
      'carol:config', 'bob:plan', 'alice:review', 'bob:apply', 'platform:verified', 'platform:completed', 'carol:report']);
  });
});

describe('members acting at the same time never conflict', () => {
  test('two members applying at once: one runs, the other gets Busy (409) naming the holder; Terraform never runs twice concurrently', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    await s.r.setConfig('carol@squad.test', [CLASSROOM, REMOTE, VPN]);
    const p = await s.r.plan('bob@squad.test');
    const results = await Promise.allSettled([s.r.apply('bob@squad.test', p.plan), s.r.apply('alice@squad.test', p.plan)]);
    expect(results.filter((x) => x.status === 'fulfilled' && x.value.ok)).toHaveLength(1);
    const rejected = results.find((x) => x.status === 'rejected');
    expect(rejected.reason).toBeInstanceOf(Busy);
    expect(rejected.reason.code).toBe(409);
    expect(rejected.reason.message).toMatch(/bob@squad\.test is running "apply"/);
    expect(s.driver.lab.tf.max).toBe(1);
    expect((await s.r.state()).applied).toHaveLength(1);
  });

  test('many simultaneous platform ticks at fire time inject the fault exactly once', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 390);
    expect(await phase(s)).toBe('armed');
    w.advance(60);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => s.r.tick()));
    expect(outcomes.filter((o) => o === 'busy').length).toBe(7);
    expect(s.driver.calls.filter((c) => c === 'injectFault')).toHaveLength(1);
    for (let i = 0; i < 5; i += 1) { w.advance(30); await s.r.tick(); }
    expect(s.driver.calls.filter((c) => c === 'injectFault')).toHaveLength(1);
  });

  test('a restarted control plane (new runner, same store) never re-fires and keeps the fire time', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    const fireAt = (await s.r.state()).fire_at;
    const again = squadRunner({ store: s.store, driver: s.driver, clock: w.now });
    await again.tick();
    expect((await again.state()).fire_at).toBe(fireAt);
    for (let i = 0; i < 12; i += 1) { w.advance(60); await again.tick(); }
    expect(s.driver.calls.filter((c) => c === 'injectFault')).toHaveLength(1);
  });

  test('a member operation that outlives its lock cannot overwrite the newer holder (LockLost)', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    let release;
    const gate = new Promise((r) => { release = r; });
    const slow = { ...s.driver, evidence: async () => { await gate; return 'late'; } };
    const slowRunner = squadRunner({ store: s.store, driver: slow, clock: w.now });
    const late = slowRunner.evidence('bob@squad.test', 'sg_rules');
    await new Promise((r) => setImmediate(r));
    await expect(s.r.plan('alice@squad.test')).rejects.toBeInstanceOf(Busy);   // locked meanwhile
    w.advance(200);                                                              // past the 180 s evidence TTL
    await s.r.setConfig('carol@squad.test', [CLASSROOM, REMOTE, VPN]);         // takes over the lock
    release();
    await expect(late).rejects.toBeInstanceOf(LockLost);
    const st = await s.r.state();
    expect(st.config_history.at(-1).by).toBe('carol@squad.test');             // carol's change survived
    expect(st.evidence.some((e) => e.by === 'bob@squad.test' && e.id === 'sg_rules')).toBe(false);
  });
});

describe('cross-squad isolation', () => {
  test("squad alpha's whole journey leaves squad bravo's lab, fuse, timeline and score untouched", async () => {
    const w = world();
    const alpha = w.squad('alpha');
    const bravo = w.squad('bravo', ['198.18.0.10/32'], { fuseSeconds: 3600 });
    await alpha.r.start('alice@alpha.test');
    await bravo.r.start('zed@bravo.test');
    await w.runFor([alpha, bravo], 450);
    expect(await phase(alpha)).toBe('incident');
    expect(await phase(bravo)).toBe('armed');                                  // its own, later fuse
    const bravoLab = w.account.snapshot('bravo');
    const bravoState = JSON.stringify(await bravo.r.state());

    await fixTogether(w, alpha);
    await alpha.r.tick();
    await alpha.r.report('carol@squad.test', { hypothesis: 'H1', summary: 'x'.repeat(50) });
    await alpha.r.cleanup('alice@alpha.test');
    expect(await phase(alpha)).toBe('cleaned');

    expect(w.account.snapshot('bravo')).toBe(bravoLab);
    expect(JSON.stringify(await bravo.r.state())).toBe(bravoState);
    expect(bravo.driver.calls).not.toContain('injectFault');
    expect((await bravo.r.view()).score).toBeNull();
    expect(alpha.driver.calls.some((c) => c.includes('bravo'))).toBe(false);
  });

  test("each squad's fault, recovery and score are its own", async () => {
    const w = world();
    const alpha = w.squad('alpha');
    const bravo = w.squad('bravo', ['198.18.0.10/32']);
    await alpha.r.start('alice@alpha.test');
    await bravo.r.start('zed@bravo.test');
    await w.runFor([alpha, bravo], 450);
    expect(await phase(alpha)).toBe('incident');
    expect(await phase(bravo)).toBe('incident');
    await fixTogether(w, alpha);                                               // only alpha recovers
    await w.runFor([alpha, bravo], 60);
    expect(await phase(alpha)).toBe('completed');
    expect(await phase(bravo)).toBe('incident');
    expect(bravo.driver.lab.config).toEqual([VPN]);
    expect(alpha.driver.calls.filter((c) => c === 'injectFault')).toHaveLength(1);
    expect(bravo.driver.calls.filter((c) => c === 'injectFault')).toHaveLength(1);
  });
});

describe('remediation must be real, reviewed and through Terraform', () => {
  test('unreviewed apply recovers but scores remediation 15 and no four-eyes', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    await s.r.setConfig('carol@squad.test', [CLASSROOM, REMOTE, VPN]);
    const p = await s.r.plan('bob@squad.test');
    await s.r.apply('bob@squad.test', p.plan);
    await s.r.tick();
    const v = await s.r.view();
    expect(v.phase).toBe('completed');
    expect(v.score.breakdown.remediation).toBe(15);
    expect(v.score.four_eyes_review).toBe(false);
  });

  test('a console rule is never verified, is penalised, and collides with the Terraform fix until removed', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    s.driver.byHand.consoleAddRule(CLASSROOM);
    await s.r.tick();
    expect((await s.r.state()).last_checks).toMatchObject({ users_reach_the_app: true, fixed_in_terraform: false, no_rules_outside_terraform: false });
    await s.r.setConfig('carol@squad.test', [CLASSROOM, REMOTE, VPN]);
    const p = await s.r.plan('bob@squad.test');
    await expect(s.r.apply('bob@squad.test', p.plan)).rejects.toThrow(/InvalidPermission\.Duplicate/);
    expect((await s.r.view()).busy).toBeNull();                                // a failed apply releases the lock
    s.driver.byHand.consoleRemoveUnmanaged();
    const p2 = await s.r.plan('bob@squad.test');
    await s.r.review('alice@squad.test', p2.plan);
    await s.r.apply('bob@squad.test', p2.plan);
    await s.r.tick();
    const v = await s.r.view();
    expect(v.phase).toBe('completed');
    expect(v.score.penalties).toEqual([{ reason: 'console_rule', points: 10 }]);
  });

  test('0.0.0.0/0 and malformed CIDRs are refused before Terraform; a plan dropping the VPN range is refused by the guard', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    for (const bad of [['0.0.0.0/0'], ['203.0.113.10/16'], ['203.0.113.11/24'], ['nope'], [], [CLASSROOM, CLASSROOM], Array(11).fill(CLASSROOM), 'x']) {
      expect((await s.r.setConfig('bob@squad.test', bad)).ok).toBe(false);
    }
    expect(s.driver.calls.filter((c) => c.startsWith('writeConfig'))).toHaveLength(0);
    await s.r.setConfig('bob@squad.test', [CLASSROOM, REMOTE]);               // adds ours but drops the VPN
    const p = await s.r.plan('bob@squad.test');
    expect(p.ok).toBe(false);
    expect(p.message).toMatch(/plan-guard \[recover squad=alpha\]/);
  });

  test('only the squad\'s current plan can be reviewed or applied; a config change invalidates it', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    await s.r.setConfig('carol@squad.test', [CLASSROOM, REMOTE, VPN]);
    const p = await s.r.plan('bob@squad.test');
    expect((await s.r.apply('bob@squad.test', 'baseline-alpha-1')).ok).toBe(false);
    await s.r.setConfig('carol@squad.test', [CLASSROOM, VPN]);
    expect((await s.r.apply('bob@squad.test', p.plan)).ok).toBe(false);      // stale now
  });

  test('replacing the instance is detected and penalised; recovery cannot verify', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    s.driver.byHand.replaceInstance();
    await fixTogether(w, s);
    await w.runFor([s], 300);
    const st = await s.r.state();
    expect(st.phase).toBe('recovering');
    expect(st.last_checks.same_instance).toBe(false);
    expect(st.penalties.map((p) => p.reason)).toContain('instance_replaced');
  });

  test('evidence ids and report inputs are allow-listed; the squad files one report', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    for (const bad of ['constructor', '__proto__', 'rm -rf /', '']) expect((await s.r.evidence('bob@squad.test', bad)).ok).toBe(false);
    expect((await s.r.report('bob@squad.test', { hypothesis: 'constructor' })).ok).toBe(false);
    expect((await s.r.report('bob@squad.test', { hypothesis: 'H1', summary: 'ok' })).ok).toBe(true);
    expect((await s.r.report('carol@squad.test', { hypothesis: 'H2', summary: 'again' })).ok).toBe(false);
  });
});

describe('readiness, cost controls and the instructor override', () => {
  test('a deployment that never becomes healthy fails clearly and never arms', async () => {
    const w = world();
    const s = w.squad('alpha', [CLASSROOM], { bootTimeoutSeconds: 600 });
    s.driver.lab.config = ['198.51.100.7/32'];                                 // the squad\'s own address left out
    await s.r.start('alice@squad.test');
    await w.runFor([s], 660);
    const st = await s.r.state();
    expect(st.phase).toBe('deploy_failed');
    expect(st.timeline.at(-1).detail).toMatch(/the squad gets no response/);
    expect(s.driver.calls).not.toContain('injectFault');
  });

  test('the lifetime cap destroys an abandoned lab mid-incident, with nobody present', async () => {
    const w = world();
    const s = w.squad('alpha', [CLASSROOM], { maxLifetimeSeconds: 3600 });
    await s.r.start('alice@squad.test');
    await w.runFor([s], 3600, 60);
    const st = await s.r.state();
    expect(st.phase).toBe('cleaned');
    expect(st.timeline.at(-1)).toMatchObject({ by: 'platform', event: 'cleanup' });
    expect(await s.driver.remaining()).toEqual([]);
  });

  test('a refused fault never strands a lab: the lifetime cap still destroys it; trigger_now retries through the guard', async () => {
    const w = world();
    const s = w.squad('alpha', [CLASSROOM], { maxLifetimeSeconds: 3600 });
    const real = s.driver.injectFault;
    s.driver.injectFault = async () => ({ allowed: false, summary: 'module.lab.aws_instance.app: update' });
    await s.r.start('alice@squad.test');
    await w.runFor([s], 450);
    expect(await phase(s)).toBe('fault_refused');
    s.driver.injectFault = real;
    expect((await s.r.override('ines', 'trigger_now')).ok).toBe(true);
    await s.r.tick();
    expect(await phase(s)).toBe('incident');                                  // fired once, through the guard

    const w2 = world();
    const t = w2.squad('bravo', [CLASSROOM], { maxLifetimeSeconds: 3600 });
    t.driver.injectFault = async () => ({ allowed: false, summary: 'refused' });
    await t.r.start('alice@squad.test');
    await w2.runFor([t], 3600, 60);
    expect(await phase(t)).toBe('cleaned');
    expect(await t.driver.remaining()).toEqual([]);
  });

  test('completed labs are destroyed after the grace period', async () => {
    const w = world();
    const s = w.squad('alpha', [CLASSROOM, REMOTE], { graceSeconds: 600 });
    await toIncident(w, s);
    await fixTogether(w, s);
    await s.r.tick();
    expect(await phase(s)).toBe('completed');
    await w.runFor([s], 600);
    expect(await phase(s)).toBe('cleaned');
  });

  test('instructor emergency override: pause holds the fuse, trigger_now fires it, destroy cleans up — all attributed', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 240);
    expect(await phase(s)).toBe('armed');
    expect((await s.r.override('ines', 'pause')).ok).toBe(true);
    await w.runFor([s], 600);
    expect(await phase(s)).toBe('armed');                                     // paused: no fire
    await s.r.override('ines', 'resume');
    await s.r.override('ines', 'trigger_now');
    await s.r.tick();
    expect(await phase(s)).toBe('incident');
    expect((await s.r.override('ines', 'trigger_now')).ok).toBe(false);       // only while armed
    expect((await s.r.override('ines', 'destroy')).ok).toBe(true);
    const st = await s.r.state();
    expect(st.phase).toBe('cleaned');
    expect(st.timeline.filter((e) => e.by === 'instructor:ines').map((e) => e.event)).toEqual(['override', 'override', 'override', 'cleanup']);
    expect((await s.r.override('ines', 'rm')).ok).toBe(false);
  });

  test('squad ids are validated (they become resource names)', () => {
    for (const bad of ['', 'A', 'x', 'has space', 'way-too-long-squad-id', '../etc']) expect(() => C.create(bad, T0)).toThrow();
    expect(C.create('alpha-2', T0).squad).toBe('alpha-2');
  });
});
