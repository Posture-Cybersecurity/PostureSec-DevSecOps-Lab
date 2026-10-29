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

// A fake clock with fake timers: a scheduled callback runs at EXACTLY its due time as the clock advances.
function world() {
  let t = T0;
  const account = createFakeAccount();
  const clock = () => t;
  const handles = [];
  const timers = {
    schedule: (fn, ms) => { const h = { at: t + ms, fn, cancelled: false }; handles.push(h); return h; },
    cancel: (h) => { if (h) h.cancelled = true; },
  };
  const pending = () => handles.filter((h) => !h.cancelled);
  const advanceTo = async (target) => {
    for (;;) {
      const next = pending().filter((h) => h.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      next.cancelled = true;
      t = Math.max(t, next.at);
      await next.fn();
    }
    t = Math.max(t, target);
  };
  const squad = (id, cidrs = [SQUAD_NET], opts = {}) => {
    const driver = createFakeDriftDriver({ account, squad: id, squadCidrs: cidrs, clock, bootSeconds: 240 });
    const store = memoryStore(C.create(id, t, { graceSeconds: 0, ...opts }));
    return { id, driver, store, r: driftRunner({ store, driver, clock, ...timers }) };
  };
  const advance = (sec) => advanceTo(t + sec * 1000);
  const runFor = async (squads, seconds, step = 30) => {
    for (let i = 0; i < seconds; i += step) { await advance(step); for (const s of squads) await s.r.tick(); }
  };
  return { account, squad, advance, runFor, now: () => t, timers, pending };
}

const phase = async (s) => (await s.r.view()).phase;
const count = (s, name) => s.driver.calls.filter((c) => c === name || c.startsWith(`${name}:`)).length;

async function toIncident(w, s) {
  expect((await s.r.start('alice@squad.test')).ok).toBe(true);
  await w.runFor([s], 270);                      // boot (240 s) → ready
  expect(await phase(s)).toBe('ready');
  await w.runFor([s], 300);                      // the fuse: exactly 5 min after ready
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
    expect(st.timeline.map((e) => e.event)).toEqual(expect.arrayContaining(['inject_attempt', 'inject_result', 'alert', 'detected']));
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

    await w.advance(5); await s.r.tick();
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
    expect(JSON.stringify((await s.r.state()).timeline)).not.toContain('203.0.113.10');
    expect((await s.r.state()).timeline.find((e) => e.event === 'inject_result').detail).toMatch(/tcp\/80 from <squad-network-1>/);
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
    await w.runFor([s], 240);
    expect(count(s, 'injectDrift')).toBe(0);
    await w.runFor([s], 90);
    expect(count(s, 'injectDrift')).toBe(1);
  });

  test('many simultaneous ticks at fire time, and a restarted control plane, inject once', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    const others = [1, 2, 3].map(() => driftRunner({ store: s.store, driver: s.driver, clock: w.now, ...w.timers }));
    await Promise.all(others.map((r) => r.armFuse()));                       // four fuses armed on one lab
    await w.advance(300);
    await Promise.all([s.r.tick(), s.r.tick(), ...others.map((r) => r.tick()), ...others.map((r) => r.tick())]);
    expect(await phase(s)).toBe('incident');
    const restarted = driftRunner({ store: s.store, driver: s.driver, clock: w.now, ...w.timers });
    for (let i = 0; i < 10; i += 1) { await w.advance(60); await restarted.tick(); }
    expect(count(s, 'injectDrift')).toBe(1);
  });

  test('a failed attempt is retried; the rule is deleted once; repeated failure ends in fault_failed and cleanup', async () => {
    const w = world();
    const once = w.squad('alpha');
    once.driver.failInject = 1;
    await once.r.start('alice@squad.test');
    await w.runFor([once], 600);
    expect(await phase(once)).toBe('incident');
    expect(count(once, 'injectDrift')).toBe(2);
    expect((await once.r.state()).timeline.map((e) => e.event)).toEqual(expect.arrayContaining(['inject_failed', 'inject_result']));

    const w2 = world();
    const never = w2.squad('bravo', [SQUAD_NET], { failedGraceSeconds: 600 });
    never.driver.failInject = 99;
    await never.r.start('alice@squad.test');
    await w2.runFor([never], 660);
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
    await w.advance(60); await s.r.tick();
    const st = await s.r.state();
    expect(st.penalties.map((p) => p.reason)).toContain('instance_replaced');
    expect(st.last_checks.results.same_instance_healthy).toBe(false);
  });

  test('a console "fix" is detected and penalised, collides with the Terraform restore, and never verifies', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    s.driver.byHand.consoleAddRule(SQUAD_NET);
    await w.advance(60); await s.r.tick();
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
    await w.advance(60); await s.r.tick();
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
    await w.advance(20 * 60);
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
    await w.advance(60);
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
    await w.advance(60);
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
    await w.runFor([alpha, bravo], 300);
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

describe('the drift fuse: exactly 5 minutes after VERIFIED readiness, cancellable, once', () => {
  test('no fuse exists before readiness; it is armed from the ready event and fires at exactly ready + 300 s', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    expect(w.pending()).toHaveLength(0);                                      // not at deploy
    await w.runFor([s], 210);                                                 // still booting (bootSeconds 240)
    expect(await phase(s)).toBe('booting');
    expect(w.pending()).toHaveLength(0);                                      // not while booting
    await w.runFor([s], 30);                                                  // ready
    const ready = await s.r.state();
    expect(ready.phase).toBe('ready');
    expect(ready.fire_at).toBe(ready.ready_at + 300 * 1000);
    expect(w.pending().map((h) => h.at)).toEqual([ready.fire_at + 5]);        // one fuse, from the ready event
    await w.advance(299);
    expect(count(s, 'injectDrift')).toBe(0);
    await w.advance(1.01);                                                    // past ready + 300 s + 5 ms
    const st = await s.r.state();
    expect(count(s, 'injectDrift')).toBe(1);
    expect(st.phase).toBe('incident');
    expect(Date.parse(st.injection.at) - st.ready_at).toBe(300 * 1000 + 5);  // the fuse's own wake-up, not a tick
    expect(st.injection.scheduled_for).toBe(new Date(ready.ready_at + 300 * 1000).toISOString());
    expect(w.pending()).toHaveLength(0);                                      // nothing left to fire
  });

  test('member cleanup cancels the pending fuse, and a stale callback that still runs cannot inject', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    const [fuse] = w.pending();
    expect(fuse).toBeDefined();
    expect((await s.r.cleanup('alice@squad.test')).ok).toBe(true);
    expect(fuse.cancelled).toBe(true);
    expect(w.pending()).toHaveLength(0);
    await fuse.fn();                                                          // a race: the callback runs anyway
    await w.advance(600);
    expect(count(s, 'injectDrift')).toBe(0);
    expect(await phase(s)).toBe('cleaned');
  });

  test('an instructor reset (pause) cancels the fuse; nothing fires while paused', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    await s.r.override('ines', 'pause');
    expect(w.pending()).toHaveLength(0);
    await w.runFor([s], 900);
    expect(count(s, 'injectDrift')).toBe(0);
    expect(await phase(s)).toBe('ready');
  });

  test('an AWS failure is recorded with its reason, never reported as success, and retried 30 s later', async () => {
    const w = world();
    const s = w.squad('alpha');
    s.driver.failInject = 1;
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    const fireAt = (await s.r.state()).fire_at;
    await w.advance(300);
    let st = await s.r.state();
    expect(st.phase).toBe('ready');
    expect(st.injection).toBeNull();
    expect(st.timeline.filter((e) => e.internal).map((e) => e.event)).toEqual(['inject_prepared', 'inject_attempt', 'inject_failed', 'target_discarded']);
    expect(st.drift_target).toBeNull();                                       // the retry re-resolves everything
    expect(st.timeline.find((e) => e.event === 'inject_failed').detail).toMatch(/simulated AWS error/);
    expect((await s.r.view()).timeline.some((e) => /inject|fault/.test(e.event))).toBe(false);   // not shown to the squad
    expect(w.pending().map((h) => h.at)).toEqual([fireAt + 5 + 30000]);
    await w.advance(30);
    st = await s.r.state();
    expect(st.phase).toBe('incident');
    expect(count(s, 'injectDrift')).toBe(2);
  });

  test('a fuse blocked by a running Terraform step is deferred, not lost and not doubled', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    await s.store.update((st) => { st.op = { kind: 'override', by: 'instructor:ines', since: w.now(), until: w.now() + 3600e3 }; return st; });
    await w.advance(300);
    expect(count(s, 'injectDrift')).toBe(0);
    expect(w.pending()).toHaveLength(1);                                      // re-armed for a retry
    await s.store.update((st) => { st.op = null; return st; });
    await w.advance(30);
    expect(count(s, 'injectDrift')).toBe(1);
  });

  test('the overdue safety net: a control plane that missed the fuse (restart) still injects exactly once', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 270);
    for (const h of w.pending()) w.timers.cancel(h);                          // the process died with its timer
    const restarted = driftRunner({ store: s.store, driver: s.driver, clock: w.now, schedule: () => null, cancel: () => {} });   // its timer never fires
    for (let i = 0; i < 20; i += 1) { await w.advance(30); await restarted.tick(); }
    expect(count(s, 'injectDrift')).toBe(1);
    restarted.stop();
  });
});

describe('what the squad sees: the symptom, never the mechanism or the answer', () => {
  test('during the incident the view shows an alert and no injection records, no checks, no rule id', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    await s.r.tick();                                                         // the platform's first check
    const v = await s.r.view();
    const st = await s.r.state();
    expect(v.timeline.map((e) => e.event)).toEqual(['deploy_plan', 'deployed', 'ready', 'alert', 'detected']);
    expect(v.timeline.find((e) => e.event === 'alert').detail).toBe('SEV-2: PostureBlogging is unreachable from the squad\'s network');
    expect(JSON.stringify(v)).not.toContain(st.injection.rule_id);
    expect(JSON.stringify(v.timeline)).not.toMatch(/inject|script|automat|platform deleted/i);
    expect(v.checks).toBeNull();                                              // they would name the answer
    expect(st.timeline.some((e) => e.internal && e.event === 'checks')).toBe(true);   // instructor record keeps them
  });

  test('after the squad applies its fix, the checks become visible', async () => {
    const w = world();
    const s = w.squad('alpha');
    await toIncident(w, s);
    await restore(s);
    await s.r.tick();
    const v = await s.r.view();
    expect(v.phase).toBe('completed');
    expect(Object.values(v.checks.results).every(Boolean)).toBe(true);
  });
});

describe("the timeline records a check result only when it changes", () => {
  test("unchanged results stored with reordered keys (as Postgres JSONB does) add no new entry", async () => {
    const w = world();
    const s = w.squad("alpha");
    await toIncident(w, s);
    const count0 = (await s.r.state()).timeline.filter((e) => e.event === "checks").length;
    expect(count0).toBe(1);
    await s.store.update((st) => {                                            // JSONB-style key order
      const r = st.last_checks.results;
      st.last_checks.results = Object.fromEntries(Object.keys(r).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map((k) => [k, r[k]]));
      return st;
    });
    await w.runFor([s], 180);
    expect((await s.r.state()).timeline.filter((e) => e.event === "checks").length).toBe(1);
  });
});

describe("no second fuse while an injection is in flight (seen in the 2026-10-28 live run)", () => {
  test("a tick during a slow injection neither arms another fuse nor injects again", async () => {
    const w = world();
    const s = w.squad("alpha");
    await s.r.start("alice@squad.test");
    await w.runFor([s], 270);
    const slow = s.driver.injectDrift;
    let release;
    s.driver.injectDrift = async () => { await new Promise((r) => { release = r; }); return slow(); };
    const firing = w.advance(300);                                            // the fuse fires; injection blocks
    for (let i = 0; i < 20 && !release; i += 1) await new Promise((r) => setImmediate(r));
    expect((await s.r.state()).op).toMatchObject({ kind: "inject" });
    await s.r.tick();                                                         // the platform tick meanwhile
    expect(w.pending()).toHaveLength(0);                                      // no duplicate fuse
    release();
    await firing;
    expect(await phase(s)).toBe("incident");
    expect(count(s, "injectDrift")).toBe(1);
    expect(w.pending()).toHaveLength(0);
  });
});

describe('the drift target is prepared while healthy; the deadline only re-checks and revokes', () => {
  const readyLab = async (w, s) => { await s.r.start('alice@squad.test'); await w.runFor([s], 270); expect(await phase(s)).toBe('ready'); };

  test('prepared once, right after readiness, recorded for the instructor only; the fuse uses it (fast path)', async () => {
    const w = world();
    const s = w.squad('alpha');
    await readyLab(w, s);
    await w.runFor([s], 60);
    let st = await s.r.state();
    expect(st.drift_target).toMatchObject({ sg: 'sg-alpha', rule_id: expect.stringMatching(/^sgr-/), cidr: SQUAD_NET });
    expect(count(s, 'prepareDrift')).toBe(1);
    expect(st.timeline.find((e) => e.event === 'inject_prepared').internal).toBe(true);
    expect((await s.r.view()).timeline.some((e) => /prepar|inject/.test(e.event))).toBe(false);
    const target = st.drift_target.rule_id;
    await w.runFor([s], 240);                                                  // past the fuse
    st = await s.r.state();
    expect(st.phase).toBe('incident');
    expect(s.driver.calls).toContain('injectDrift:target');
    expect(st.injection).toMatchObject({ path: 'fast', rule_id: target });
    expect(s.driver.deleted).toEqual([target]);                               // exactly that rule, once
    expect(count(s, 'prepareDrift')).toBe(1);
  });

  test('never prepared within the cutoff before the fuse: a lab whose fuse is that close uses the full path', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { fuseSeconds: 50 });              // fires < 60 s after ready
    await readyLab(w, s);
    await w.runFor([s], 60);
    expect(count(s, 'prepareDrift')).toBe(0);
    expect(s.driver.calls).toContain('injectDrift:full');
    expect((await s.r.state()).injection.path).toBe('full');
  });

  test('a prepared rule that changed in AWS is refused (nothing deleted), discarded, and the full path refuses too', async () => {
    const w = world();
    const s = w.squad('alpha', [SQUAD_NET], { failedGraceSeconds: 600 });
    await readyLab(w, s);
    await w.runFor([s], 60);
    s.driver.byHand.tamperRule();
    await w.runFor([s], 330);
    const st = await s.r.state();
    expect(s.driver.deleted).toEqual([]);
    expect(st.phase).toBe('fault_failed');
    expect(st.timeline.filter((e) => e.event === 'inject_failed')[0].detail).toMatch(/no longer matches this squad's tcp\/80 rule; nothing deleted/);
    expect(s.driver.calls.filter((c) => c === 'injectDrift:target')).toHaveLength(1);   // the cached target is used once
  });

  test('a prepared rule already gone (an earlier attempt, then a crash): the full path reports it, nothing else is deleted', async () => {
    const w = world();
    const s = w.squad('alpha');
    await readyLab(w, s);
    await w.runFor([s], 60);
    s.driver.byHand.vanishRule();
    await w.runFor([s], 240);
    const st = await s.r.state();
    expect(st.phase).toBe('incident');
    expect(st.injection).toMatchObject({ path: 'full', retried: true });
    expect(s.driver.deleted).toEqual([]);
  });

  test('an AWS error on the fast path: recorded, target discarded, the 30 s retry re-resolves and succeeds', async () => {
    const w = world();
    const s = w.squad('alpha');
    await readyLab(w, s);
    await w.runFor([s], 60);
    s.driver.failInject = 1;
    await w.runFor([s], 270);
    const st = await s.r.state();
    expect(st.phase).toBe('incident');
    expect(s.driver.calls.filter((c) => c.startsWith('injectDrift'))).toEqual(['injectDrift:target', 'injectDrift:full']);
    expect(st.injection.path).toBe('full');
    expect(s.driver.deleted).toHaveLength(1);
  });

  test('a failing preparation is retried while time allows (logged at most 3 times); the fuse still injects (full path)', async () => {
    const w = world();
    const s = w.squad('alpha');
    s.driver.failPrepare = 99;
    await readyLab(w, s);
    await w.runFor([s], 300);
    const st = await s.r.state();
    expect(st.phase).toBe('incident');
    expect(st.injection.path).toBe('full');
    expect(st.timeline.filter((e) => e.event === 'prepare_failed').length).toBe(3);
    expect(count(s, 'prepareDrift')).toBeGreaterThan(3);
  });

  test('a preparation that finishes after a cleanup is discarded; no injection follows', async () => {
    const w = world();
    const s = w.squad('alpha');
    await s.r.start('alice@squad.test');
    await w.runFor([s], 240);                                                  // ready on this tick; not yet prepared
    expect(await phase(s)).toBe('ready');
    expect(count(s, 'prepareDrift')).toBe(0);
    let release;
    s.driver.prepareGate = new Promise((r) => { release = r; });
    await w.advance(30);
    const t = s.r.tick();                                                      // preparing, held
    for (let i = 0; i < 20 && count(s, 'prepareDrift') === 0; i += 1) await new Promise((r) => setImmediate(r));
    expect(count(s, 'prepareDrift')).toBe(1);
    expect((await s.r.cleanup('alice@squad.test')).ok).toBe(true);
    release();
    await t;
    await w.advance(600);
    const st = await s.r.state();
    expect(st.phase).toBe('cleaned');
    expect(st.drift_target).toBeNull();
    expect(count(s, 'injectDrift')).toBe(0);
  });

  test('a restarted control plane keeps the prepared target and the exact fuse; injects once, fast', async () => {
    const w = world();
    const s = w.squad('alpha');
    await readyLab(w, s);
    await w.runFor([s], 60);
    s.r.stop();                                                                // the old process dies
    for (const h of w.pending()) w.timers.cancel(h);
    const restarted = driftRunner({ store: s.store, driver: s.driver, clock: w.now, ...w.timers });
    await restarted.armFuse();
    const fireAt = (await s.store.load()).fire_at;
    expect(w.pending().map((h) => h.at)).toEqual([fireAt + 5]);
    await w.advance(240);
    const st = await s.store.load();
    expect(st.injection).toMatchObject({ path: 'fast' });
    expect(Date.parse(st.injection.at)).toBe(fireAt + 5);
    expect(s.driver.deleted).toHaveLength(1);
  });
});

describe('injection latency record (instructor-only)', () => {
  test('the driver\'s timing marks become an internal breakdown relative to the scheduled fire time', async () => {
    const w = world();
    const s = w.squad('alpha');
    const real = s.driver.injectDrift;
    s.driver.injectDrift = async (t) => {
      const r = await real(t);
      const f = (await s.store.load()).fire_at;
      return { ...r, timing: { spawned: f + 30, script_start: f + 60, checked: f + 2500, revoke_start: f + 2510, revoke_done: f + 4000, returned: f + 6500 } };
    };
    await s.r.start('alice@squad.test');
    await w.runFor([s], 570);
    const st = await s.r.state();
    expect(st.phase).toBe('incident');
    expect(st.injection.timing_ms).toEqual({ op_start: 5, spawned: 30, script_start: 60, checked: 2500, revoke_start: 2510, revoke_done: 4000, returned: 6500 });
    const e = st.timeline.find((x) => x.event === 'inject_timing');
    expect(e.internal).toBe(true);
    expect(e.detail).toMatch(/revoke_start \+2510ms, revoke_done \+4000ms/);
    expect(JSON.stringify(await s.r.view())).not.toMatch(/timing|revoke_start/);
  });
});
