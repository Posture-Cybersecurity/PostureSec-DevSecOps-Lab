/**
 * INC-004 squad controller — the platform for ONE squad's shared real lab.
 *
 * One squad = one incident, one EC2 lab, one Terraform state, one fuse, one timeline,
 * one recovery lifecycle, one score. Members act under their own authenticated identity
 * (every timeline entry records `by`); nobody operates the exercise for them:
 *
 *   new → booting → armed ─(fuse)→ incident → recovering → completed → cleaned
 *                                     ▲            │ (checks fail: stays recovering)
 *
 *   start      any member deploys the squad lab (guarded baseline plan + apply)
 *   tick       the platform: readiness → arm → fire ONCE → verify → score → auto-cleanup
 *   evidence   any member examines a real, read-only view (recorded for the squad score)
 *   setConfig  any member edits the squad's Terraform ingress configuration (history kept)
 *   plan / review / apply   guarded remediation; any member may review another's plan
 *   report     the squad's incident report (once)
 *   cleanup    guarded destroy; also automatic after completion + grace, or at the lifetime cap
 *   override   INSTRUCTOR emergency only: trigger now, pause/resume the fuse, destroy
 *
 * Every function mutates the state document it is given; the caller (runner.js) holds the
 * squad's operation lock around it, so two members can never run Terraform at once and the
 * fuse can never fire twice. Side effects go through a driver (driver-real.js / driver-fake.js).
 */
const S = require('./scenario-live');

const DEFAULTS = {
  fuseSeconds: 180,          // after readiness
  bootTimeoutSeconds: 1200,  // first boot builds three images
  graceSeconds: 900,         // auto-cleanup this long after completion (0 = only on request)
  maxLifetimeSeconds: 10800, // hard cap: 3 h after deploy, destroyed whatever the phase
};

const SQUAD = /^[a-z0-9][a-z0-9-]{1,14}$/;
const sec = (ms) => Math.round(ms / 1000);
const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

function create(squadId, nowMs, opts = {}) {
  if (!SQUAD.test(squadId || '')) throw new Error('squad id: 2-15 lowercase letters, digits, hyphens');
  return {
    squad: squadId,
    phase: 'new',
    opts: { ...DEFAULTS, ...opts },
    created_at: nowMs, deployed_at: null, ready_at: null, fire_at: null, fired_at: null,
    paused: false, recovered_at: null, completed_at: null, cleaned_at: null,
    instance_id: null,          // pinned at readiness: a different id later = the instance was replaced
    evidence: [],               // [{id, by}] first examination of each view
    config_history: [],         // [{at, by, cidrs}] every change to the squad's ingress configuration
    pending_plan: null,         // {name, by}
    reviews: [],                // [{plan, by}]
    applied: [],                // [{plan, by, reviewed, reviewed_by_other}]
    refused: 0,
    penalties: [],
    last_checks: null,
    report: null,
    score: null,
    timeline: [],
  };
}

function log(st, nowMs, by, event, detail) {
  st.timeline.push({ t: new Date(nowMs).toISOString(), by, event, detail: String(detail || '').slice(0, 300) });
}

function penalize(st, reason) {
  if (st.penalties.some((p) => p.reason === reason)) return;
  st.penalties.push({ reason, points: S.PENALTIES[reason] || 0 });
}

const ACTIVE = ['armed', 'incident', 'recovering', 'completed'];
const fail = (message) => ({ ok: false, message });

// ---------------------------------------------------------------------------
// Member commands (each called with the authenticated member as `by`)
// ---------------------------------------------------------------------------
async function start(st, driver, by, nowMs) {
  if (st.phase !== 'new') return { ok: true, message: `already started (phase ${st.phase})` };
  const plan = await driver.plan('baseline');
  if (!plan.allowed) { log(st, nowMs, by, 'deploy_refused', plan.summary); return fail(`baseline plan refused: ${plan.summary}`); }
  log(st, nowMs, by, 'deploy_plan', plan.summary);
  await driver.apply(plan.name);
  st.phase = 'booting';
  st.deployed_at = nowMs;
  log(st, nowMs, by, 'deployed', 'baseline applied; the platform is waiting for the application to become healthy');
  return { ok: true, message: 'deployed; the platform will arm the incident once the application is healthy' };
}

async function evidence(st, driver, by, id, nowMs) {
  if (!has(S.EVIDENCE, id)) return fail(`unknown evidence; one of: ${Object.keys(S.EVIDENCE).join(', ')}`);
  if (!ACTIVE.includes(st.phase)) return fail(`no running lab to inspect (phase ${st.phase})`);
  const output = await driver.evidence(id);
  if (!st.evidence.some((e) => e.id === id)) st.evidence.push({ id, by });
  log(st, nowMs, by, 'evidence', id);
  return { ok: true, message: output };
}

async function setConfig(st, driver, by, cidrs, nowMs) {
  if (!['incident', 'recovering'].includes(st.phase)) return fail(`the configuration is only changed during the incident (phase ${st.phase})`);
  if (cidrs.includes && cidrs.includes('0.0.0.0/0')) return fail('0.0.0.0/0 is never allowed: this is an intentionally vulnerable training app');
  if (!S.validCidrs(cidrs)) return fail('http_ingress_cidrs: 1-10 distinct canonical IPv4 CIDRs, /24 or narrower');
  await driver.writeConfig(cidrs, by);   // the member is recorded in the lab's own config history too
  st.config_history.push({ at: new Date(nowMs).toISOString(), by, cidrs: [...cidrs] });
  st.pending_plan = null;     // any earlier plan no longer matches the configuration
  log(st, nowMs, by, 'config', `http_ingress_cidrs = ${JSON.stringify(cidrs)}`);
  return { ok: true, message: 'configuration updated; run plan' };
}

async function plan(st, driver, by, nowMs) {
  if (!['incident', 'recovering'].includes(st.phase)) return fail(`nothing to remediate (phase ${st.phase})`);
  const p = await driver.plan('current');
  if (!p.allowed) {
    st.refused += 1;
    log(st, nowMs, by, 'plan_refused', p.summary);
    return fail(`the guard refused this plan: ${p.summary}`);
  }
  st.pending_plan = { name: p.name, by };
  log(st, nowMs, by, 'plan', `${p.name}: ${p.summary}`);
  return { ok: true, message: `saved plan ${p.name} (${p.summary}). Review it, then apply it.`, plan: p.name };
}

async function review(st, driver, by, name, nowMs) {
  if (!st.pending_plan || name !== st.pending_plan.name) return fail('review the squad\'s current plan (see plan)');
  if (!st.reviews.some((r) => r.plan === name && r.by === by)) st.reviews.push({ plan: name, by });
  log(st, nowMs, by, 'review', `${name}${by !== st.pending_plan.by ? ' (second pair of eyes)' : ''}`);
  return { ok: true, message: await driver.showPlan(name) };
}

async function apply(st, driver, by, name, nowMs) {
  if (!st.pending_plan || name !== st.pending_plan.name) return fail('apply only the squad\'s current plan');
  const reviewers = st.reviews.filter((r) => r.plan === name).map((r) => r.by);
  await driver.apply(name);
  st.applied.push({ plan: name, by, reviewed: reviewers.length > 0, reviewed_by_other: reviewers.some((r) => r !== st.pending_plan.by) });
  st.pending_plan = null;
  if (st.phase === 'incident') st.phase = 'recovering';
  log(st, nowMs, by, 'apply', `${name}${reviewers.length ? ` (reviewed by ${reviewers.join(', ')})` : ' (NOT reviewed)'}`);
  return { ok: true, message: 'applied; the platform will verify the recovery from the squad\'s side' };
}

async function report(st, driver, by, body, nowMs) {
  if (st.report) return fail('the squad has already filed its report');
  if (!['incident', 'recovering', 'completed'].includes(st.phase)) return fail('no incident to report on yet');
  const hypothesis = body && typeof body.hypothesis === 'string' ? body.hypothesis : '';
  if (!has(S.HYPOTHESES, hypothesis)) return fail(`hypothesis: one of ${Object.keys(S.HYPOTHESES).join(', ')}`);
  const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 2000) : '';
  st.report = { hypothesis, summary, by, at: new Date(nowMs).toISOString() };
  log(st, nowMs, by, 'report', hypothesis);
  if (st.phase === 'completed') {
    st.score = score(st);
    await driver.tag({ WarRoomScore: String(st.score.total) });   // the instructor's view stays current
  }
  return { ok: true, message: 'report filed' };
}

async function cleanup(st, driver, by, nowMs, reason = 'requested by a squad member') {
  if (st.phase === 'cleaned' || st.phase === 'new') return { ok: true, message: `nothing to clean (phase ${st.phase})` };
  const p = await driver.plan('destroy');
  if (!p.allowed) { log(st, nowMs, by, 'cleanup_refused', p.summary); return fail(`destroy plan refused: ${p.summary}`); }
  await driver.apply(p.name);
  const left = await driver.remaining();
  st.phase = left.length ? 'cleanup_incomplete' : 'cleaned';
  st.cleaned_at = nowMs;
  log(st, nowMs, by, 'cleanup', `${reason}; ${left.length ? `LEFT: ${left.join(', ')}` : 'nothing left'}`);
  return { ok: left.length === 0, message: left.length ? `resources remain: ${left.join(', ')}` : 'all lab resources destroyed' };
}

// ---------------------------------------------------------------------------
// Instructor emergency override — never part of the normal journey.
// ---------------------------------------------------------------------------
async function override(st, driver, instructor, action, nowMs) {
  const by = `instructor:${instructor}`;
  switch (action) {
    case 'trigger_now':
      // A refused fault can be retried: the guard re-checks a fresh plan, so nothing is bypassed.
      if (st.phase === 'fault_refused') { st.phase = 'armed'; st.fired_at = null; }
      if (st.phase !== 'armed') return fail(`can only trigger an armed lab (phase ${st.phase})`);
      st.fire_at = nowMs;
      log(st, nowMs, by, 'override', 'fuse shortened: the incident fires on the next tick');
      return { ok: true, message: 'the incident will fire on the next platform tick' };
    case 'pause':
      st.paused = true; log(st, nowMs, by, 'override', 'fuse and auto-cleanup paused');
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
// The platform loop (run under the squad's operation lock). Idempotent.
// ---------------------------------------------------------------------------
async function tick(st, driver, nowMs) {
  const o = st.opts;
  const by = 'platform';
  if (['new', 'cleaned', 'cleanup_incomplete'].includes(st.phase)) return st.phase;

  // Cost control first: the hard lifetime cap applies in every phase with a lab, paused, failed or not.
  if (st.deployed_at && sec(nowMs - st.deployed_at) >= o.maxLifetimeSeconds) {
    await cleanup(st, driver, by, nowMs, 'maximum lab lifetime reached');
    return st.phase;
  }
  if (['deploy_failed', 'fault_refused'].includes(st.phase)) return st.phase;

  if (st.phase === 'booting') {
    const obs = await driver.observe();
    if (S.healthy(obs)) {
      st.phase = 'armed';
      st.ready_at = nowMs;
      st.instance_id = obs.instance.id;
      st.fire_at = nowMs + o.fuseSeconds * 1000;
      log(st, nowMs, by, 'ready', 'instance running, checks ok, SSM online, /api/health 200 from the squad\'s network');
      log(st, nowMs, by, 'armed', `the incident will occur at ${new Date(st.fire_at).toISOString()}`);
      await driver.tag({ WarRoomPhase: 'armed' });
    } else if (sec(nowMs - st.deployed_at) >= o.bootTimeoutSeconds) {
      st.phase = 'deploy_failed';
      log(st, nowMs, by, 'deploy_failed', `not healthy after ${o.bootTimeoutSeconds}s: ${S.why(obs)}`);
    }
    return st.phase;
  }

  if (st.phase === 'armed' && !st.paused && nowMs >= st.fire_at && !st.fired_at) {
    st.fired_at = nowMs;           // set first: a retry after a crash cannot fire again
    const r = await driver.injectFault();
    if (!r.allowed) {
      st.phase = 'fault_refused';
      log(st, nowMs, by, 'fault_refused', r.summary);
      return st.phase;
    }
    st.phase = 'incident';
    log(st, nowMs, by, 'incident', 'pipeline run #57 applied CHG-1042 ("move HTTP ingress to the new VPN egress range")');
    await driver.tag({ WarRoomPhase: 'incident' });
    return st.phase;
  }

  if (st.phase === 'incident' || st.phase === 'recovering') {
    const obs = await driver.observe();
    if (obs.console_rules) penalize(st, 'console_rule');
    if (obs.world_open) penalize(st, 'world_open');
    if (obs.instance && st.instance_id && obs.instance.id !== st.instance_id) penalize(st, 'instance_replaced');
    const checks = S.recoveryChecks(obs, st);
    st.last_checks = checks;
    if (st.phase === 'recovering' && Object.values(checks).every(Boolean)) {
      st.phase = 'completed';
      st.recovered_at = nowMs;
      st.completed_at = nowMs;
      st.score = score(st);
      log(st, nowMs, by, 'verified', 'the squad reaches /api/health; every rule managed by Terraform; no 0.0.0.0/0; plan has no changes');
      log(st, nowMs, by, 'completed', `squad score ${st.score.total}/100`);
      await driver.tag({ WarRoomPhase: 'completed', WarRoomScore: String(st.score.total) });
    }
    return st.phase;
  }

  if (st.phase === 'completed' && !st.paused && o.graceSeconds > 0 && sec(nowMs - st.completed_at) >= o.graceSeconds) {
    await cleanup(st, driver, by, nowMs, 'completed; grace period over');
  }
  return st.phase;
}

function score(st) {
  const R = S.RUBRIC;
  const seen = st.evidence.map((e) => e.id);
  const ev = Object.values(R.evidenceGroups).reduce((n, ids) => n + (ids.some((id) => seen.includes(id)) ? R.pointsPerGroup : 0), 0);
  const last = st.applied[st.applied.length - 1];
  const remediation = st.completed_at ? (last && last.reviewed ? R.reviewed : R.unreviewed) : 0;
  const verification = st.completed_at ? R.verification : 0;
  const diagnosis = st.report && st.report.hypothesis === R.correct ? R.diagnosis : 0;
  const report = st.report && st.report.summary.length >= R.minSummary ? R.report : 0;
  const deduct = st.penalties.reduce((n, p) => n + p.points, 0);
  const breakdown = { evidence: ev, diagnosis, remediation, verification, report };
  const contributors = {};
  for (const e of st.timeline) if (!e.by.startsWith('platform') && !e.by.startsWith('instructor:')) contributors[e.by] = (contributors[e.by] || 0) + 1;
  return {
    total: Math.max(0, Object.values(breakdown).reduce((a, b) => a + b, 0) - deduct),
    breakdown,
    penalties: st.penalties,
    time_to_recover_s: st.recovered_at && st.fired_at ? sec(st.recovered_at - st.fired_at) : null,
    four_eyes_review: Boolean(last && last.reviewed_by_other),
    contributors,
  };
}

module.exports = { create, start, evidence, setConfig, plan, review, apply, report, cleanup, override, tick, score, DEFAULTS };
