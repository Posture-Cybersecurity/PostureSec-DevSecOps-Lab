/**
 * INC-005 "Console Hotfix Drift" — the squad platform (drift controller + runner) proven with the
 * FAKE drift driver, which models configuration, Terraform state and AWS separately. Callers are
 * squad members and the platform loop only; nobody operates the exercise for the squad.
 * These are NOT an AWS end-to-end test: driver-real.js against AWS is a separate, live step.
 */
const C = require('../../warroom/inc004/squad/drift-controller');
const { driftRunner, Busy } = require('../../warroom/inc004/squad/drift-runner');
const { memoryStore } = require('../../warroom/inc004/squad/store-memory');
const { createFakeAccount, createFakeDriftDriver } = require('../../warroom/inc004/squad/driver-fake-drift');

const SQUAD_NET = '203.0.113.10/32';
const T0 = Date.UTC(2026, 9, 28, 9, 0, 0);

function world() {
  let t = T0;
  const account = createFakeAccount();
  const clock = () => t;
  const squad = (id, cidrs = [SQUAD_NET], opts = {}) => {
    const driver = createFakeDriftDriver({ account, squad: id, squadCidrs: cidrs, clock, bootSeconds: 240 });
    const store = memoryStore(C.create(id, t, { fuseSeconds: 180, graceSeconds: 0, ...opts }));
    return { id, driver, store, r: driftRunner({ store, driver, clock }) };
  };
  const advance = (s) => { t += s * 1000; };
  const runFor = async (squads, seconds, step = 30) => {
    for (let i = 0; i < seconds; i += step) { advance(step); for (const s of squads) await s.r.tick(); }
  };
  return { account, squad, advance, runFor, now: () => t };
}

const phase = async (s) => (await s.r.view()).phase;
const count = (s, name) => s.driver.calls.filter((c) => c === name || c.startsWith(`${name}:`)).length;

async function toIncident(w, s) {
  expect((await s.r.start('alice@squad.test')).ok).toBe(true);
  await w.runFor([s], 270);                      // boot (240 s) → ready
  expect(await phase(s)).toBe('ready');
  await w.runFor([s], 180);                      // the fuse
  expect(await phase(s)).toBe('incident');
}

async function restore(s, { inspect = true } = {}) {
  const p = await s.r.plan('bob@squad.test');
  expect(p).toMatchObject({ ok: true });
  if (inspect) expect((await s.r.inspect('carol@squad.test', p.plan)).ok).toBe(true);
  expect((await s.r.apply('bob@squad.test', p.plan)).ok).toBe(true);
  return p.plan;
}

describe('the squad journey: automatic drift, Terraform restore, automatic verification — no instructor', () => {
  test('deploy → ready → drift ONCE → investigate → saved plan (exactly 1 to add) → inspect → apply → verified → scored → cleaned', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { graceSeconds: 600 });
    await toIncident(w, s);
    expect(count(s, 'injectDrift')).toBe(1);

    // Real drift: configuration and state untouched, AWS changed.
    const L = s.driver.lab;
    const deletedId = (await s.r.state()).injection.rule_id;
    expect(L.config).toEqual({ cidrs: [SQUAD_NET], intact: true });
    expect(L.state.rules[SQUAD_NET]).toBe(deletedId);
    expect(L.aws.rules.some((r) => r.id === deletedId)).toBe(false);
    await s.r.tick();                                  // the platform records the outage
    const st = await s.r.state();
    expect(st.timeline.map((e) => e.event)).toEqual(expect.arrayContaining(['incident', 'detected']));
    expect(st.last_checks.results).toMatchObject({ same_instance_healthy: true, app_reachable_from_squad: false, rule_exists_in_aws: false, plan_clean: false });

    for (const [m, id] of [['bob', 'http_from_squad'], ['carol', 'sg_rules'], ['alice', 'plan_now'], ['carol', 'state_rules']]) {
      expect((await s.r.evidence(`${m}@squad.test`, id)).ok).toBe(true);
    }
    expect((await s.r.evidence('bob@squad.test', 'cat /etc/passwd')).ok).toBe(false);

    const p = await s.r.plan('bob@squad.test');
    expect(p.message).toMatch(/Plan: 1 to add, 0 to change, 0 to destroy\./);
    expect((await s.r.inspect('carol@squad.test', p.plan)).message).toMatch(/1 to add/);
    expect((await s.r.apply('bob@squad.test', p.plan)).ok).toBe(true);
    expect(await phase(s)).toBe('recovering');
    expect((await s.r.apply('bob@squad.test', p.plan)).ok).toBe(false);      // a saved plan applies once

    w.advance(5); await s.r.tick();
    const v = await s.r.view();
    expect(v.phase).toBe('completed');
    expect(v.checks.results).toEqual({
      same_instance_healthy: true, app_reachable_from_squad: true, rule_exists_in_aws: true,
      rule_managed_by_terraform: true, no_world_open_http: true, plan_clean: true,
    });
    expect(v.score).toMatchObject({ total: 100, breakdown: { restored: 40, inspected_before_apply: 15, evidence: 30, speed: 15 }, penalties: [] });
    expect(Object.keys(v.score.contributors).sort()).toEqual(['alice@squad.test', 'bob@squad.test', 'carol@squad.test']);
    expect(L.config.intact).toBe(true);                                       // the fix never changed the configuration
    expect(L.state.rules[SQUAD_NET]).not.toBe(deletedId);                     // a NEW rule, recorded in state
    expect(v.timeline.some((e) => e.by.startsWith('instructor:'))).toBe(false);
    expect(v.timeline.find((e) => e.event === 'verified').detail).toMatch(/all 6 recovery checks passed/);
    expect(v.timeline.every((e) => /^\d{4}-\d\d-\d\dT/.test(e.t))).toBe(true);

    await w.runFor([s], 600);
    expect(await phase(s)).toBe('cleaned');
    expect(await s.driver.remaining()).toEqual([]);
  });

  test('the timeline never shows a raw squad address', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    await restore(s);
    await s.r.tick();
    expect(JSON.stringify((await s.r.view()).timeline)).not.toContain('203.0.113.10');
    expect((await s.r.view()).timeline.find((e) => e.event === 'incident').detail).toMatch(/tcp\/80 from <squad-network-1>/);
  });
});

describe('injection: only after readiness, exactly once', () => {
  test('never before the instance, SSM, the app and the squad\'s HTTP access are all healthy', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { bootTimeoutSeconds: 600 });
    s.driver.lab.config.cidrs = ['198.18.0.7/32'];       // deployed without the squad's own address: never reachable
    await s.r.start('alice@squad.test');
    await w.runFor([s], 660);
    expect(await phase(s)).toBe('deploy_failed');
    expect((await s.r.state()).timeline.at(-1).detail).toMatch(/the squad gets no response/);
    expect(count(s, 'injectDrift')).toBe(0);
  });

  test('never while the desired configuration does not plan clean (an unrelated drift at boot)', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { bootTimeoutSeconds: 600 });
    await s.r.start('alice@squad.test');
    s.driver.byHand.driftSomethingElse('module.lab.aws_instance.app update');
    await w.runFor([s], 660);
    expect(await phase(s)).toBe('deploy_failed');
    expect((await s.r.state()).timeline.at(-1).detail).toMatch(/plan of the desired configuration is not clean/);
    expect(count(s, 'injectDrift')).toBe(0);
  });

  test('ready waits for the fuse: the squad sees a healthy lab first', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    expect(await phase(s)).toBe('ready');
    await w.runFor([s], 120);
    expect(count(s, 'injectDrift')).toBe(0);
    await w.runFor([s], 60);
    expect(count(s, 'injectDrift')).toBe(1);
  });

  test('many simultaneous ticks at fire time, and a restarted control plane, inject once', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    w.advance(180);
    const others = [1, 2, 3].map(() => driftRunner({ store: s.store, driver: s.driver, clock: w.now }));
    await Promise.all([s.r.tick(), s.r.tick(), ...others.map((r) => r.tick()), ...others.map((r) => r.tick())]);
    expect(await phase(s)).toBe('incident');
    const restarted = driftRunner({ store: s.store, driver: s.driver, clock: w.now });
    for (let i = 0; i < 10; i += 1) { w.advance(60); await restarted.tick(); }
    expect(count(s, 'injectDrift')).toBe(1);
  });

  test('a failed attempt is retried; the rule is deleted once; repeated failure ends in fault_failed and cleanup', async () => {
    const w = world();
    const once = w.squad('alpha');
    once.driver.failInject = 1;
    await once.r.start('alice@squad.test');
    await w.runFor([once], 480);
    expect(await phase(once)).toBe('incident');
    expect(count(once, 'injectDrift')).toBe(2);
    expect((await once.r.state()).timeline.map((e) => e.event)).toEqual(expect.arrayContaining(['fault_retry', 'incident']));

    const w2 = world();
    const never = w2.squad('bravo', [SQUAD_NET], { failedGraceSeconds: 600 });
    never.driver.failInject = 99;
    await never.r.start('alice@squad.test');
    await w2.runFor([never], 540);
    expect(await phase(never)).toBe('fault_failed');
    expect(count(never, 'injectDrift')).toBe(3);
    await w2.runFor([never], 600);
    expect(await phase(never)).toBe('cleaned');
    expect(await never.driver.remaining()).toEqual([]);
  });
});

describe('the guarded Terraform restore', () => {
  test('a plan with any change besides the one rule is refused and cannot be applied', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    s.driver.byHand.driftSomethingElse('module.lab.aws_instance.app update');
    const p = await s.r.plan('bob@squad.test');
    expect(p.ok).toBe(false);
    expect(p.message).toMatch(/exactly 1 create and nothing else \(found 2 change\(s\)/);
    expect((await s.r.view()).pending_plan).toBeNull();
    expect((await s.r.apply('bob@squad.test', 'restore-alpha-0001')).ok).toBe(false);
    expect(count(s, 'apply')).toBe(1);                                       // only the baseline was ever applied
  });

  test('a replaced instance makes the restore plan refused and is penalised', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    s.driver.byHand.replaceInstance();
    expect((await s.r.plan('bob@squad.test')).ok).toBe(false);
    w.advance(60); await s.r.tick();
    const st = await s.r.state();
    expect(st.penalties.map((p) => p.reason)).toContain('instance_replaced');
    expect(st.last_checks.results.same_instance_healthy).toBe(false);
  });

  test('a console "fix" is detected and penalised, collides with the Terraform restore, and never verifies', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    s.driver.byHand.consoleAddRule(SQUAD_NET);
    w.advance(60); await s.r.tick();
    let st = await s.r.state();
    expect(st.last_checks.results).toMatchObject({ app_reachable_from_squad: true, rule_exists_in_aws: true, rule_managed_by_terraform: false, plan_clean: false });
    expect(st.penalties.map((p) => p.reason)).toContain('console_rule');
    expect(st.phase).toBe('incident');                                        // reachable is not recovered
    const p = await s.r.plan('bob@squad.test');
    await expect(s.r.apply('bob@squad.test', p.plan)).rejects.toThrow(/InvalidPermission\.Duplicate/);
    st = await s.r.state();
    expect(st.timeline.at(-1).event).toBe('apply_failed');
    expect(st.pending_plan).toBeNull();
  });

  test('a changed desired configuration is refused before Terraform plans', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    s.driver.byHand.tamperConfig();
    await expect(s.r.plan('bob@squad.test')).rejects.toThrow(/desired configuration changed/);
    w.advance(60); await s.r.tick();
    expect((await s.r.state()).last_checks.results.rule_managed_by_terraform).toBe(false);
  });

  test('plan and apply exist only during the incident', async () => {
    const w = world();
    const s = w.squad('alpha');
    expect((await s.r.plan('bob@squad.test')).ok).toBe(false);
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    expect((await s.r.plan('bob@squad.test')).message).toMatch(/nothing to restore \(phase ready\)/);
  });
});

describe('scoring is objective', () => {
  test('an uninspected, slower restore scores less; evidence counts once per group', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    await s.r.evidence('bob@squad.test', 'http_from_squad');
    await s.r.evidence('carol@squad.test', 'services');                       // same group: counted once
    w.advance(20 * 60);
    await restore(s, { inspect: false });
    await s.r.tick();
    const v = await s.r.view();
    expect(v.phase).toBe('completed');
    expect(v.score.breakdown).toEqual({ restored: 40, inspected_before_apply: 0, evidence: 10, speed: 10 });
    expect(v.score.total).toBe(60);
    expect(v.timeline.find((e) => e.event === 'apply').detail).toMatch(/NOT inspected first/);
  });
});

describe('cost controls: failed and abandoned sessions are cleaned up', () => {
  test('a deployment whose apply fails is cleaned up after the failure grace period', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { failedGraceSeconds: 300 });
    const real = s.driver.apply;
    s.driver.apply = async () => { throw new Error('Error: creating EC2 Instance: InsufficientInstanceCapacity'); };
    expect((await s.r.start('alice@squad.test')).ok).toBe(false);
    expect(await phase(s)).toBe('deploy_failed');
    s.driver.apply = real;
    await w.runFor([s], 300);
    expect(await phase(s)).toBe('cleaned');
  });

  test('the lifetime cap destroys an abandoned lab mid-incident, even when paused', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { maxLifetimeSeconds: 3600 });
    await toIncident(w, s);
    await s.r.override('ines', 'pause');
    await w.runFor([s], 3600, 60);
    const st = await s.r.state();
    expect(st.phase).toBe('cleaned');
    expect(st.timeline.at(-1)).toMatchObject({ by: 'platform', event: 'cleanup' });
    expect(st.timeline.at(-1).detail).toMatch(/maximum lab lifetime reached; nothing left/);
  });
});

describe('concurrency: read-only work never blocks the squad', () => {
  test('while the platform\'s long check is running, members investigate, plan and inspect — no 409, no lock held', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    let release;
    s.driver.gate = new Promise((r) => { release = r; });
    w.advance(60);
    const check = s.r.tick();                                                  // blocks inside observe()
    await new Promise((r) => setImmediate(r));
    expect((await s.r.view()).busy).toBeNull();                                // not holding the squad lock
    s.driver.gate = null;                                                      // the members' own reads are not held
    expect((await s.r.evidence('bob@squad.test', 'sg_rules')).ok).toBe(true);
    const p = await s.r.plan('bob@squad.test');
    expect(p.ok).toBe(true);
    expect((await s.r.inspect('carol@squad.test', p.plan)).ok).toBe(true);
    release();
    await check;
  });

  test('a check that overlapped an apply is discarded, never counted; the next one verifies', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    let release;
    s.driver.gate = new Promise((r) => { release = r; });
    w.advance(60);
    const stale = s.r.tick();                                                  // observes the broken lab, held
    await new Promise((r) => setImmediate(r));
    s.driver.gate = null;
    await restore(s);                                                          // the fix lands meanwhile
    release();
    await stale;
    expect(await phase(s)).toBe('recovering');                                 // the stale result did not decide anything
    await s.r.tick();
    expect(await phase(s)).toBe('completed');
  });

  test('during a member\'s apply, reads and the platform tick proceed; only a conflicting Terraform step gets one 409', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    const p = await s.r.plan('bob@squad.test');
    const slow = s.driver.apply;
    let release;
    s.driver.apply = async (n) => { await new Promise((r) => { release = r; }); return slow(n); };
    const applying = s.r.apply('bob@squad.test', p.plan);
    await new Promise((r) => setImmediate(r));
    expect((await s.r.view()).busy).toMatchObject({ kind: 'apply', by: 'bob@squad.test' });
    expect((await s.r.evidence('carol@squad.test', 'sg_rules')).ok).toBe(true);
    expect(await s.r.tick()).toBe('incident');                                 // the platform skips; it does not wait
    await expect(s.r.plan('alice@squad.test')).rejects.toBeInstanceOf(Busy);   // a second Terraform step: one clear 409
    release();
    await applying;
    expect(s.driver.lab.tf.max).toBe(1);
  });
});

describe('squad isolation', () => {
  test("alpha's drift, restore and cleanup never touch bravo's lab, state, timeline or score", async () => {
    const w = world();
    const alpha = w.squad('alpha', [SQUAD_NET]);
    const bravo = w.squad('bravo', ['198.18.0.20/32']);
    await alpha.r.start('alice@alpha.test');
    await bravo.r.start('zed@bravo.test');
    await w.runFor([alpha, bravo], 270);
    const bravoBefore = JSON.stringify(w.account.labs.bravo.aws);
    await bravo.r.override('ines', 'pause');                                   // bravo's fuse held: only alpha drifts
    await w.runFor([alpha, bravo], 180);
    expect(await phase(alpha)).toBe('incident');
    expect(await phase(bravo)).toBe('ready');
    expect(JSON.stringify(w.account.labs.bravo.aws)).toBe(bravoBefore);
    await restore(alpha);
    await alpha.r.tick();
    expect((await alpha.r.cleanup('alice@alpha.test')).ok).toBe(true);
    expect(w.account.labs.alpha.state).toBeNull();
    expect(JSON.stringify(w.account.labs.bravo.aws)).toBe(bravoBefore);
    expect((await bravo.r.state()).timeline.every((e) => !e.by.includes('alpha'))).toBe(true);
    expect((await bravo.r.view()).score).toBeNull();
  });

  test('squad ids are validated (they become resource names)', () => {
    for (const bad of ['', 'A', 'x', 'has space', 'way-too-long-squad-id', '../etc']) expect(() => C.create(bad, T0)).toThrow();
  });
});

describe('cleanup never loops and never leaves resources silently', () => {
  test('a destroy plan the guard refuses, with resources left, ends in cleanup_incomplete (a person must look), once', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { maxLifetimeSeconds: 3600 });
    await toIncident(w, s);
    const realPlan = s.driver.plan;
    s.driver.plan = async (kind) => (kind === 'destroy' ? { name: 'destroy-alpha-x', allowed: false, summary: 'REFUSED: not tagged WarRoom=INC-005' } : realPlan(kind));
    await w.runFor([s], 3600, 60);
    const st = await s.r.state();
    expect(st.phase).toBe('cleanup_incomplete');
    expect(st.timeline.filter((e) => e.event === 'cleanup_refused')).toHaveLength(1);
    expect(st.timeline.at(-1).detail).toMatch(/LEFT: instance/);
    await w.runFor([s], 600, 60);
    expect((await s.r.state()).timeline.filter((e) => e.event === 'cleanup_refused')).toHaveLength(1);   // not retried in a loop
  });
});
