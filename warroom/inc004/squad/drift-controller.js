/**
 * INC-005 "Console Hotfix Drift" — the squad controller. Same platform as INC-004 (one lab, one
 * state, one timeline, one score per squad; members attributed), a different incident:
 *
 *   new → booting → ready ─(fuse)→ incident → recovering → completed → cleaned
 *            │                │                  │ checks fail: stays recovering; plan again
 *            └ deploy_failed  └ fault_failed     (both cleaned up automatically)
 *
 *   start    a member deploys (guarded baseline: create-only, tagged INC-005 + squad)
 *   readiness/inject/check   the PLATFORM: ready = healthy AND the desired configuration plans clean;
 *            then the squad's real port-80 rule is deleted ONCE through the AWS API (drift)
 *   evidence / inspect       read-only; never take the squad lock
 *   plan     saved plan of the UNCHANGED configuration (guard: drift — exactly one create)
 *   apply    that saved plan; the platform then verifies independently and scores
 *   cleanup  guarded destroy; automatic after completion + grace, after a failure + grace, and at
 *            the lifetime cap whatever the phase
 *
 * Locking: only Terraform/AWS-mutating steps (start, plan, apply, inject, cleanup, override) run
 * under the squad's operation lock (runner.withOp). Long read-only observations (readiness,
 * verification) run OUTSIDE it and are committed with commitReadiness/commitCheck, which discard
 * a result if a mutation happened meanwhile (st.rev changed) — so a stale check can never pass.
 * Nothing here tags AWS resources: progress lives in this document only.
 */
const S = require('./scenario-drift');

const DEFAULTS = {
  fuseSeconds: 180,            // healthy lab visible to the squad this long before the drift
  bootTimeoutSeconds: 1200,
  checkEverySeconds: 60,       // verification cadence during the incident (immediately after an apply)
  graceSeconds: 900,           // cleanup this long after completion (0 = only on request)
  failedGraceSeconds: 600,     // cleanup this long after deploy_failed / fault_failed
  maxLifetimeSeconds: 10800,   // hard cap from deploy, any phase
  maxInjectAttempts: 3,        // the drift script is idempotent; attempts only retry an undecided result
};

const SQUAD = /^[a-z0-9][a-z0-9-]{1,14}$/;
const sec = (ms) => Math.round(ms / 1000);
const iso = (ms) => new Date(ms).toISOString();
const fail = (message) => ({ ok: false, message });
const MASK = (s) => String(s);

function create(squadId, nowMs, opts = {}) {
  if (!SQUAD.test(squadId || '')) throw new Error('squad id: 2-15 lowercase letters, digits, hyphens');
  return {
    incident: 'INC-005',
    squad: squadId,
    phase: 'new',
    opts: { ...DEFAULTS, ...opts },
    rev: 0,                    // bumped by every AWS/Terraform mutation; read-only results carry it
    created_at: nowMs, deployed_at: null, ready_at: null, fire_at: null, fired_at: null,
    inject_attempts: 0, injection: null,   // { rule_id, cidr, at }
    incident_at: null, detected_at: null, failed_at: null,
    paused: false, recovered_at: null, completed_at: null, cleaned_at: null,
    instance_id: null,
    check_due: null,
    evidence: [],              // [{ id, by }] first examination of each view
    pending_plan: null,        // { name, by, summary }
    inspections: [],           // [{ plan, by }]
    applied: [],               // [{ plan, by, inspected }]
    refused: 0,
    penalties: [],
    last_checks: null,         // { at, results }
    score: null,
    timeline: [],
  };
}

function log(st, nowMs, by, event, detail) {
  st.timeline.push({ t: iso(nowMs), by, event, detail: String(detail || '').slice(0, 300) });
}

function penalize(st, reason) {
  if (st.penalties.some((p) => p.reason === reason)) return;
  st.penalties.push({ reason, points: S.PENALTIES[reason] || 0 });
}

const INVESTIGABLE = ['ready', 'incident', 'recovering', 'completed'];
const FIXABLE = ['incident', 'recovering'];

// ---------------------------------------------------------------------------
// Member steps
// ---------------------------------------------------------------------------
async function start(st, driver, by, nowMs) {
  if (st.phase !== 'new') return { ok: true, message: `already started (phase ${st.phase})` };
  const plan = await driver.plan('baseline');
  if (!plan.allowed) { log(st, nowMs, by, 'deploy_refused', plan.summary); return fail(`baseline plan refused: ${plan.summary}`); }
  log(st, nowMs, by, 'deploy_plan', plan.summary);
  st.rev += 1;
  st.deployed_at = nowMs;                     // from here on the lifetime cap applies, even if the apply fails
  try {
    await driver.apply(plan.name);
  } catch (e) {
    st.phase = 'deploy_failed';
    st.failed_at = nowMs;
    log(st, nowMs, by, 'deploy_failed', `baseline apply failed: ${e.message}`);
    return fail('the deployment failed; the platform will clean up what was created');
  }
  st.phase = 'booting';
  log(st, nowMs, by, 'deployed', 'baseline applied; the platform is waiting for the application to become healthy');
  return { ok: true, message: 'deployed; the platform takes it from here' };
}

/** Guarded saved plan of the unchanged desired configuration. */
async function plan(st, driver, by, nowMs) {
  if (!FIXABLE.includes(st.phase)) return fail(`nothing to restore (phase ${st.phase})`);
  const p = await driver.plan('restore');
  st.pending_plan = null;
  if (!p.allowed) {
    st.refused += 1;
    log(st, nowMs, by, 'plan_refused', p.summary);
    return fail(`the guard refused this plan: ${p.summary}`);
  }
  st.pending_plan = { name: p.name, by, summary: p.summary };
  log(st, nowMs, by, 'plan', `${p.name}: ${p.summary}`);
  return { ok: true, message: `saved plan ${p.name} (${p.summary}). Inspect it, then apply it.`, plan: p.name };
}

async function apply(st, driver, by, name, nowMs) {
  if (!FIXABLE.includes(st.phase)) return fail(`nothing to restore (phase ${st.phase})`);
  if (!st.pending_plan || name !== st.pending_plan.name) return fail('apply only the squad\'s current saved plan');
  const inspected = st.inspections.some((i) => i.plan === name);
  st.pending_plan = null;                     // a saved plan applies once, success or not
  st.rev += 1;
  try {
    await driver.apply(name);
  } catch (e) {
    log(st, nowMs, by, 'apply_failed', `${name}: ${e.message}`);
    throw e;
  }
  st.applied.push({ plan: name, by, inspected });
  st.phase = 'recovering';
  st.check_due = nowMs;                       // verify on the next platform tick
  log(st, nowMs, by, 'apply', `${name}${inspected ? '' : ' (NOT inspected first)'}`);
  return { ok: true, message: 'applied; the platform is verifying the recovery independently' };
}

async function cleanup(st, driver, by, nowMs, reason = 'requested by a squad member') {
  if (st.phase === 'cleaned' || st.phase === 'new') return { ok: true, message: `nothing to clean (phase ${st.phase})` };
  let p;
  try { p = await driver.plan('destroy'); } catch (e) { p = { allowed: false, summary: e.message }; }
  if (!p.allowed) {
    // e.g. a deployment that failed before creating anything: nothing in state to destroy.
    const left = await driver.remaining();
    st.cleaned_at = nowMs;
    st.pending_plan = null;
    // Never retried in a loop: resources that the guarded destroy will not remove need a person.
    st.phase = left.length ? 'cleanup_incomplete' : 'cleaned';
    log(st, nowMs, by, left.length ? 'cleanup_refused' : 'cleanup', `${reason}; destroy plan: ${p.summary}; ${left.length ? `LEFT: ${left.join(', ')}` : 'nothing left'}`);
    return left.length ? fail(`destroy plan refused: ${p.summary}`) : { ok: true, message: 'nothing was left to destroy' };
  }
  st.rev += 1;
  await driver.apply(p.name);
  const left = await driver.remaining();
  st.phase = left.length ? 'cleanup_incomplete' : 'cleaned';
  st.cleaned_at = nowMs;
  st.pending_plan = null;
  log(st, nowMs, by, 'cleanup', `${reason}; ${left.length ? `LEFT: ${left.join(', ')}` : 'nothing left'}`);
  return { ok: left.length === 0, message: left.length ? `resources remain: ${left.join(', ')}` : 'all lab resources destroyed' };
}

// Recorded by the runner after a read-only call made outside the lock.
function recordEvidence(st, by, id, nowMs) {
  if (!st.evidence.some((e) => e.id === id)) st.evidence.push({ id, by });
  log(st, nowMs, by, 'evidence', id);
}
function recordInspection(st, by, name, nowMs) {
  if (!st.pending_plan || st.pending_plan.name !== name) return;
  if (!st.inspections.some((i) => i.plan === name && i.by === by)) st.inspections.push({ plan: name, by });
  log(st, nowMs, by, 'inspect', name);
}

// ---------------------------------------------------------------------------
// Instructor emergency override — never needed in the normal journey.
// ---------------------------------------------------------------------------
async function override(st, driver, instructor, action, nowMs) {
  const by = `instructor:${instructor}`;
  switch (action) {
    case 'trigger_now':
      if (st.phase === 'fault_failed') { st.phase = 'ready'; st.inject_attempts = 0; st.failed_at = null; }
      if (st.phase !== 'ready') return fail(`can only trigger a ready lab (phase ${st.phase})`);
      st.fire_at = nowMs;
      log(st, nowMs, by, 'override', 'fuse shortened: the drift happens on the next tick');
      return { ok: true, message: 'the drift will happen on the next platform tick' };
    case 'pause':
      st.paused = true; log(st, nowMs, by, 'override', 'fuse and automatic cleanup paused (the lifetime cap still applies)');
      return { ok: true, message: 'paused' };
    case 'resume':
      st.paused = false; log(st, nowMs, by, 'override', 'resumed');
      return { ok: true, message: 'resumed' };
    case 'destroy':
      return cleanup(st, driver, by, nowMs, 'instructor emergency override');
    default:
      return fail('override: trigger_now | pause | resume | destroy');
  }
}

// ---------------------------------------------------------------------------
// The platform. due() decides; the runner performs the work with or without the lock.
// ---------------------------------------------------------------------------
function due(st, nowMs) {
  const o = st.opts;
  if (['new', 'cleaned', 'cleanup_incomplete'].includes(st.phase)) return null;
  if (st.deployed_at && sec(nowMs - st.deployed_at) >= o.maxLifetimeSeconds) return 'cap';
  if (st.op && nowMs < st.op.until) return null;             // a member's Terraform step is running
  if (['deploy_failed', 'fault_failed'].includes(st.phase)) {
    return !st.paused && st.failed_at && sec(nowMs - st.failed_at) >= o.failedGraceSeconds ? 'failed' : null;
  }
  if (st.phase === 'booting') return 'readiness';
  if (st.phase === 'ready') return !st.paused && nowMs >= st.fire_at ? 'inject' : null;
  if (FIXABLE.includes(st.phase)) return nowMs >= (st.check_due || 0) ? 'check' : null;
  if (st.phase === 'completed' && !st.paused && o.graceSeconds > 0 && sec(nowMs - st.completed_at) >= o.graceSeconds) return 'grace';
  return null;
}

/** Commit a readiness observation (taken outside the lock). */
function commitReadiness(st, obs, nowMs, rev) {
  if (st.phase !== 'booting' || st.rev !== rev) return st.phase;
  if (S.ready(obs)) {
    st.phase = 'ready';
    st.ready_at = nowMs;
    st.instance_id = obs.instance.id;
    st.fire_at = nowMs + st.opts.fuseSeconds * 1000;
    log(st, nowMs, 'platform', 'ready', 'instance running, both status checks ok, SSM online, app healthy inside AND from the squad\'s network; terraform plan: no changes');
  } else if (sec(nowMs - st.deployed_at) >= st.opts.bootTimeoutSeconds) {
    st.phase = 'deploy_failed';
    st.failed_at = nowMs;
    log(st, nowMs, 'platform', 'deploy_failed', `not ready after ${st.opts.bootTimeoutSeconds}s: ${S.why(obs)}`);
  }
  return st.phase;
}

/** Inject the drift (under the lock). Never before readiness, at most once. */
async function inject(st, driver, nowMs) {
  if (st.phase !== 'ready' || st.injection || st.paused || nowMs < st.fire_at) return st.phase;
  const mask = driver.mask || MASK;
  st.fired_at = st.fired_at || nowMs;
  st.inject_attempts += 1;
  st.rev += 1;
  let r;
  try { r = await driver.injectDrift(); } catch (e) { r = { deleted: false, summary: e.message }; }
  if (r.deleted) {
    st.injection = { rule_id: r.ruleId, cidr: r.cidr, at: iso(nowMs), retried: Boolean(r.already) };
    st.phase = 'incident';
    st.incident_at = nowMs;
    st.check_due = nowMs;                     // record the outage evidence on the next tick
    log(st, nowMs, 'platform', 'incident', `HOTFIX-311: an engineer deleted security group rule ${r.ruleId} (tcp/80 from ${mask(r.cidr)}) directly in AWS, outside Terraform`);
    return st.phase;
  }
  if (st.inject_attempts >= st.opts.maxInjectAttempts) {
    st.phase = 'fault_failed';
    st.failed_at = nowMs;
    log(st, nowMs, 'platform', 'fault_failed', mask(r.summary));
  } else {
    log(st, nowMs, 'platform', 'fault_retry', mask(r.summary));
  }
  return st.phase;
}

/** Commit a verification observation (taken outside the lock). A stale one is discarded. */
function commitCheck(st, obs, nowMs, rev) {
  if (!FIXABLE.includes(st.phase) || st.rev !== rev) return st.phase;
  st.check_due = nowMs + st.opts.checkEverySeconds * 1000;
  for (const p of S.penaltiesFrom(obs, st)) penalize(st, p);
  const results = S.checks(obs, st);
  const changed = !st.last_checks || JSON.stringify(st.last_checks.results) !== JSON.stringify(results);
  st.last_checks = { at: iso(nowMs), results };
  if (!st.detected_at && !results.app_reachable_from_squad && results.same_instance_healthy) {
    st.detected_at = nowMs;
    log(st, nowMs, 'platform', 'detected', `the squad gets ${obs.http_from_squad || 'no response'} from the app, while the instance and the application are healthy`);
  }
  const passed = Object.values(results).filter(Boolean).length;
  if (st.phase === 'recovering' && passed === Object.keys(results).length) {
    st.phase = 'completed';
    st.recovered_at = nowMs;
    st.completed_at = nowMs;
    st.score = score(st);
    log(st, nowMs, 'platform', 'verified', `all ${passed} recovery checks passed: ${Object.keys(results).join(', ')}`);
    log(st, nowMs, 'platform', 'completed', `squad score ${st.score.total}/100`);
  } else if (changed) {
    log(st, nowMs, 'platform', 'checks', `${passed}/${Object.keys(results).length} pass; failing: ${Object.keys(results).filter((k) => !results[k]).join(', ') || 'none'}`);
  }
  return st.phase;
}

function score(st) {
  const R = S.RUBRIC;
  const seen = st.evidence.map((e) => e.id);
  const evidence = Object.values(R.evidenceGroups).reduce((n, ids) => n + (ids.some((id) => seen.includes(id)) ? R.pointsPerGroup : 0), 0);
  const last = st.applied[st.applied.length - 1];
  const done = Boolean(st.recovered_at);
  const ttr = done && st.incident_at ? sec(st.recovered_at - st.incident_at) : null;
  const speed = ttr === null ? 0 : ((R.speed.find(([limit]) => ttr <= limit) || [0, 0])[1]);
  const breakdown = {
    restored: done ? R.restored : 0,
    inspected_before_apply: done && last && last.inspected ? R.inspected : 0,
    evidence,
    speed,
  };
  const deduct = st.penalties.reduce((n, p) => n + p.points, 0);
  const contributors = {};
  for (const e of st.timeline) if (!e.by.startsWith('platform') && !e.by.startsWith('instructor:')) contributors[e.by] = (contributors[e.by] || 0) + 1;
  return {
    total: Math.max(0, Object.values(breakdown).reduce((a, b) => a + b, 0) - deduct),
    breakdown,
    penalties: st.penalties,
    time_to_recover_s: ttr,
    contributors,
  };
}

module.exports = {
  create, start, plan, apply, cleanup, override, recordEvidence, recordInspection,
  due, commitReadiness, inject, commitCheck, score, DEFAULTS, INVESTIGABLE, FIXABLE,
};
