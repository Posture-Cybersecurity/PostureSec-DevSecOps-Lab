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
 *
 * The drift FUSE: a timer armed from the stored, verified ready event (fire_at = ready_at +
 * 300 s) — never from container start, login or the deploy request. It is re-derived from the
 * state after every step (armFuse), so it survives a restart, is cancelled as soon as the lab is
 * no longer `ready` (cleanup, failure) or is paused (instructor reset), and fires inject() under
 * the squad lock, whose guards make a late or duplicate callback a no-op: injected at most once.
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
    // Checks name the answer, so the squad sees them only once its own fix is applied.
    checks: ['recovering', 'completed'].includes(st.phase) && st.last_checks ? st.last_checks : null,
    score: ['completed', 'cleaned'].includes(st.phase) ? st.score : null,
    timeline: st.timeline.filter((e) => !e.internal),
  };
}

const RETRY_MS = 30000;   // a failed or blocked injection attempt is retried this much later

function driftRunner({ store, driver, clock = Date.now, schedule = setTimeout, cancel = clearTimeout, onEvent = () => {} }) {
  const op = (kind, by, fn) => withOp(store, kind, by, clock(), (st) => fn(st, clock()));
  const record = (fn) => store.update((st) => { fn(st, clock()); return st; });
  let ticking = null;
  let fuse = null;          // { fireAt, handle }

  /** (Re)arm or cancel the drift fuse from the current state. Returns the fire time or null. */
  async function armFuse(minDelayMs = 0) {
    const st = await store.load();
    // An injection is running right now: its own completion re-arms (or cancels); don't add a second fuse.
    if (st.op && st.op.kind === 'inject' && st.op.until > clock()) return fuse ? fuse.fireAt : null;
    const want = st.phase === 'ready' && !st.paused && !st.injection && st.fire_at ? st.fire_at : null;
    if (fuse && fuse.fireAt === want && !minDelayMs) return want;
    if (fuse) {
      cancel(fuse.handle);
      if (want === null) onEvent('fuse_cancelled', { fire_at: new Date(fuse.fireAt).toISOString(), phase: st.phase, paused: st.paused });
      fuse = null;
    }
    if (want === null) return null;
    // +5 ms: a timer may wake a hair early; inject() refuses before fire_at.
    const delay = Math.max(minDelayMs, want - clock() + 5);
    const handle = schedule(() => { fuse = null; return fire().catch(() => {}); }, delay);
    if (handle && typeof handle.unref === 'function') handle.unref();
    fuse = { fireAt: want, handle };
    onEvent('fuse_armed', { fire_at: new Date(want).toISOString(), in_ms: delay });
    return want;
  }

  async function fire() {
    const before = (await store.load()).inject_attempts;
    let blocked = false;
    try {
      await op('inject', 'platform', (s, t) => C.inject(s, driver, t));
    } catch (e) {
      blocked = true;
      onEvent(e instanceof Busy ? 'inject_deferred' : 'inject_error', { reason: e.message });
    }
    const st = await store.load();
    const attempted = st.inject_attempts > before;
    const last = st.timeline.filter((e) => e.internal && /^inject_(result|failed)$/.test(e.event)).pop();
    if (st.injection) onEvent('inject_ok', { rule: st.injection.rule_id, path: st.injection.path, scheduled_for: st.injection.scheduled_for, at: st.injection.at, timing_ms: st.injection.timing_ms });
    else if (attempted && last) onEvent('inject_failed', { attempt: st.inject_attempts, reason: last.detail, phase: st.phase });
    // Still due after a failed or blocked attempt: retry later. Woke early (no attempt): re-arm on time.
    await armFuse(attempted || blocked ? RETRY_MS : 0);
  }

  const thenArm = async (p) => { try { return await p; } finally { await armFuse().catch(() => {}); } };

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
      case 'prepare': {
        // Read-only (outside the lock); ahead of the fuse, so its deadline has only the final check + revoke.
        const r = await driver.prepareDrift().catch((e) => ({ ok: false, summary: e.message }));
        const next = await record((s, t) => C.commitPrepared(s, r, t, st.rev, driver.mask));
        onEvent(next.drift_target ? 'inject_prepared' : 'prepare_failed', next.drift_target ? { rule: next.drift_target.rule_id } : { reason: r.summary });
        return next.phase;
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
    cleanup: (by) => thenArm(op('cleanup', by, (st, now) => C.cleanup(st, driver, by, now))),
    override: (instructor, action) => thenArm(op('override', `instructor:${instructor}`, (st, now) => C.override(st, driver, instructor, action, now))),

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
    // Every step re-derives the fuse, so it is armed the moment the lab becomes ready.
    tick() {
      if (!ticking) {
        ticking = thenArm(platform().catch((e) => { if (e instanceof Busy) return 'busy'; throw e; })).finally(() => { ticking = null; });
      }
      return ticking;
    },
    armFuse: () => armFuse(),
    stop() { if (fuse) { cancel(fuse.handle); fuse = null; } },
    view: async () => publicView(await store.load(), clock()),
    state: () => store.load(),
  };
}

module.exports = { driftRunner, publicView, Busy, LockLost };
