/**
 * INC-004 squad runner — the ONE way squad state changes.
 *
 * Every mutating call takes the squad's operation lock first (state.op, with a TTL),
 * runs the controller function on the state, then saves and releases. So:
 *   * two members cannot run Terraform at the same time: the second gets Busy (HTTP 409)
 *     with who is holding the lock and doing what;
 *   * the platform tick skips while a member's operation runs, and vice versa;
 *   * the fuse fires under the lock with `fired_at` persisted first: exactly once.
 * Terraform's own state lock is the second line of defence.
 *
 * A store is { load(): state, update(fn(state) -> state): state } where update is an atomic
 * read-modify-write (store-memory.js for tests; the War Room backend's row-locked table).
 */
const C = require('./controller');

// Seconds an operation may hold the lock before another may take it over.
const TTL = { start: 1800, plan: 900, apply: 1800, cleanup: 1800, tick: 1800, override: 1800, setConfig: 120, evidence: 180, review: 120, report: 120, note: 30, inject: 300 };

class Busy extends Error {
  constructor(op) {
    super(`another operation is running: ${op.by} is running "${op.kind}" (since ${new Date(op.since).toISOString()})`);
    this.code = 409;
    this.op = op;
  }
}

class LockLost extends Error {
  constructor(kind) { super(`the "${kind}" operation outlived its lock and was taken over; its result was not saved`); this.code = 409; }
}

async function withOp(store, kind, by, nowMs, fn) {
  let mine;
  await store.update((st) => {
    if (st.op && nowMs < st.op.until) throw new Busy(st.op);
    mine = { kind, by, since: nowMs, until: nowMs + TTL[kind] * 1000 };
    st.op = mine;
    return st;
  });
  const st = await store.load();
  let result;
  let error;
  try { result = await fn(st); } catch (e) { error = e; }
  await store.update((current) => {
    if (!current.op || current.op.since !== mine.since || current.op.by !== mine.by) {
      if (!error) error = new LockLost(kind);
      return current;                       // never overwrite whoever holds the lock now
    }
    st.op = null;
    return st;
  });
  if (error) throw error;
  return result;
}

function publicView(st) {
  return {
    squad: st.squad,
    phase: st.phase,
    busy: st.op ? { kind: st.op.kind, by: st.op.by } : null,
    ready_at: st.ready_at, fire_at: st.phase === 'armed' ? st.fire_at : null, fired_at: st.fired_at,
    paused: st.paused,
    evidence: st.evidence,
    config_history: st.config_history,
    pending_plan: st.pending_plan,
    applied: st.applied,
    checks: st.phase === 'recovering' || st.phase === 'completed' ? st.last_checks : null,
    report_filed: Boolean(st.report),
    score: st.phase === 'completed' || st.phase === 'cleaned' ? st.score : null,
    timeline: st.timeline,
  };
}

/** The squad's API: what members, the platform loop and the instructor may call. */
function squadRunner({ store, driver, clock = Date.now }) {
  const op = (kind, by, fn) => withOp(store, kind, by, clock(), (st) => fn(st, clock()));
  return {
    start: (by) => op('start', by, (st, now) => C.start(st, driver, by, now)),
    evidence: (by, id) => op('evidence', by, (st, now) => C.evidence(st, driver, by, id, now)),
    setConfig: (by, cidrs) => op('setConfig', by, (st, now) => C.setConfig(st, driver, by, cidrs, now)),
    plan: (by) => op('plan', by, (st, now) => C.plan(st, driver, by, now)),
    review: (by, name) => op('review', by, (st, now) => C.review(st, driver, by, name, now)),
    apply: (by, name) => op('apply', by, (st, now) => C.apply(st, driver, by, name, now)),
    report: (by, body) => op('report', by, (st, now) => C.report(st, driver, by, body, now)),
    cleanup: (by) => op('cleanup', by, (st, now) => C.cleanup(st, driver, by, now)),
    // Record something that happened outside a controller step (e.g. a background operation that failed).
    note: (by, event, detail) => op('note', by, (st, now) => {
      st.timeline.push({ t: new Date(now).toISOString(), by, event: String(event).slice(0, 40), detail: String(detail || '').slice(0, 300) });
      return { ok: true };
    }),
    override: (instructor, action) => op('override', `instructor:${instructor}`, (st, now) => C.override(st, driver, instructor, action, now)),
    // The platform loop: a busy squad is simply retried on the next tick.
    tick: async () => {
      try { return await op('tick', 'platform', (st, now) => C.tick(st, driver, now)); } catch (e) {
        if (e instanceof Busy) return 'busy';
        throw e;
      }
    },
    view: async () => publicView(await store.load()),
    state: () => store.load(),
  };
}

module.exports = { squadRunner, withOp, publicView, Busy, LockLost, TTL };
