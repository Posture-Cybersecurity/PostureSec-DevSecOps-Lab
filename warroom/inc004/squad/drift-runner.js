/**
 * INC-005 squad runner — reuses INC-004's operation lock (runner.withOp) but takes it ONLY for
 * steps that change AWS or Terraform state: start, plan, apply, inject, cleanup, override. Two of
 * those conflict, so a second one gets Busy (409) naming the holder.
 *
 * Everything read-only runs WITHOUT the lock, so it never blocks a member:
 *   evidence / inspect   the driver call, then a short atomic store.update to record who looked;
 *   readiness / checks   the platform's long observation (status checks, SSM, HTTP probe,
 *                        terraform plan) runs outside the lock; commitReadiness/commitCheck then
 *                        discard it if a mutation happened meanwhile (st.rev changed).
 * The platform tick is single-flight per control plane (one control plane per squad).
 */
const C = require('./drift-controller');
const S = require('./scenario-drift');
const { withOp, Busy, LockLost } = require('./runner');

function publicView(st, nowMs = Date.now()) {
  return {
    incident: st.incident,
    squad: st.squad,
    phase: st.phase,
    busy: st.op && st.op.until > nowMs ? { kind: st.op.kind, by: st.op.by } : null,
    ready_at: st.ready_at,
    fire_at: st.phase === 'ready' ? st.fire_at : null,
    incident_at: st.incident_at,
    paused: st.paused,
    evidence: st.evidence,
    pending_plan: st.pending_plan,
    inspections: st.inspections,
    applied: st.applied,
    checks: C.FIXABLE.concat('completed').includes(st.phase) && st.last_checks ? st.last_checks : null,
    score: ['completed', 'cleaned'].includes(st.phase) ? st.score : null,
    timeline: st.timeline,
  };
}

function driftRunner({ store, driver, clock = Date.now }) {
  const op = (kind, by, fn) => withOp(store, kind, by, clock(), (st) => fn(st, clock()));
  const record = (fn) => store.update((st) => { fn(st, clock()); return st; });
  let ticking = null;

  async function platform() {
    const st = await store.load();
    const now = clock();
    switch (C.due(st, now)) {
      case 'cap': return op('cleanup', 'platform', (s, t) => C.cleanup(s, driver, 'platform', t, 'maximum lab lifetime reached'));
      case 'failed': return op('cleanup', 'platform', (s, t) => C.cleanup(s, driver, 'platform', t, `${s.phase}; cleaning up`));
      case 'grace': return op('cleanup', 'platform', (s, t) => C.cleanup(s, driver, 'platform', t, 'completed; grace period over'));
      case 'inject': return op('inject', 'platform', (s, t) => C.inject(s, driver, t));
      case 'readiness': {
        const obs = await driver.observe();                    // outside the lock
        return (await record((s, t) => C.commitReadiness(s, obs, t, st.rev))).phase;
      }
      case 'check': {
        const obs = await driver.observe();                    // outside the lock
        return (await record((s, t) => C.commitCheck(s, obs, t, st.rev))).phase;
      }
      default: return st.phase;
    }
  }

  return {
    start: (by) => op('start', by, (st, now) => C.start(st, driver, by, now)),
    plan: (by) => op('plan', by, (st, now) => C.plan(st, driver, by, now)),
    apply: (by, name) => op('apply', by, (st, now) => C.apply(st, driver, by, name, now)),
    cleanup: (by) => op('cleanup', by, (st, now) => C.cleanup(st, driver, by, now)),
    override: (instructor, action) => op('override', `instructor:${instructor}`, (st, now) => C.override(st, driver, instructor, action, now)),

    async evidence(by, id) {
      if (!Object.prototype.hasOwnProperty.call(S.EVIDENCE, id)) return { ok: false, message: `unknown evidence; one of: ${Object.keys(S.EVIDENCE).join(', ')}` };
      const st = await store.load();
      if (!C.INVESTIGABLE.includes(st.phase)) return { ok: false, message: `no running lab to inspect (phase ${st.phase})` };
      const output = await driver.evidence(id);
      await record((s, now) => C.recordEvidence(s, by, id, now));
      return { ok: true, message: output };
    },

    async inspect(by, name) {
      const st = await store.load();
      if (!st.pending_plan || st.pending_plan.name !== name) return { ok: false, message: 'inspect the squad\'s current saved plan' };
      const text = await driver.showPlan(name);
      await record((s, now) => C.recordInspection(s, by, name, now));
      return { ok: true, message: text };
    },

    note: (by, event, detail) => record((st, now) => {
      st.timeline.push({ t: new Date(now).toISOString(), by, event: String(event).slice(0, 40), detail: String(detail || '').slice(0, 300) });
    }),

    // One platform step; overlapping calls share the running one. A Busy lock is retried next tick.
    tick() {
      if (!ticking) {
        ticking = platform().catch((e) => { if (e instanceof Busy) return 'busy'; throw e; }).finally(() => { ticking = null; });
      }
      return ticking;
    },
    view: async () => publicView(await store.load(), clock()),
    state: () => store.load(),
  };
}

module.exports = { driftRunner, publicView, Busy, LockLost };
