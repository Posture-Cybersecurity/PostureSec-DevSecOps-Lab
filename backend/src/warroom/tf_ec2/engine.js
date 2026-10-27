/**
 * INC-004 (EC2 edition) engine — a PURE, deterministic reducer over the scenario.
 *
 *   newAttempt(id, nowMs)               -> state
 *   act(state, actionId, nowMs)         -> { state, result }
 *   submitReport(state, body, nowMs)    -> { state, result }
 *   renderEvidence(id, state)           -> { id, title, layer, command, output[], source }
 *   score(state)                        -> { total, breakdown, penalties, time_to_verified_s }
 *   publicView(state)                   -> what a squad may see
 *
 * No I/O, no randomness, no wall clock: the caller passes time in, so runs replay
 * identically. The model of the real stack it encodes:
 *   * port-80 rules are separate aws_vpc_security_group_ingress_rule resources, one
 *     per CIDR; a rule added in the console is NOT in state, so `terraform plan`
 *     cannot see it (and creating the same rule in Terraform then fails as a duplicate);
 *   * the instance keeps PostgreSQL on its root volume and has no Elastic IP, so a
 *     replacement wipes the data and changes the public address.
 */
const S = require('./scenario');
const { captured } = require('./evidence');

const MAX_ACTIONS = 200;
const MAX_SUMMARY = 2000;

const clone = (o) => JSON.parse(JSON.stringify(o));
// Own properties only: a client-supplied key such as "constructor" must never resolve.
const own = (obj, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const secs = (st, nowMs) => Math.max(0, Math.round((nowMs - st.started_ms) / 1000));

function newAttempt(attemptId, nowMs) {
  return {
    attempt_id: attemptId,
    started_ms: nowMs,
    phase: 'outage',
    revealed: [],
    proposed: null,
    reviewed: false,
    applied: [],
    tf_users_rule: false,       // C1 applied: our /32 managed by Terraform
    tf_world_rule: false,       // C3 applied: 0.0.0.0/0 managed by Terraform
    console_users_rule: false,  // out-of-band rule for our /32
    console_world_rule: false,  // out-of-band 0.0.0.0/0
    console_was_used: false,    // any out-of-band console change was made
    rebuilding: false,
    replaced: false,            // the instance was replaced: data gone, new public IP
    fixed_reviewed: false,
    penalized: [],
    verified: false,
    restored_at_s: null,
    report: null,
    timeline: [],
  };
}

const reachable = (st) => !st.rebuilding
  && (st.tf_users_rule || st.tf_world_rule || st.console_users_rule || st.console_world_rule);

function refresh(st) {
  if (st.phase === 'closed' || st.phase === 'completed') return;
  st.phase = st.rebuilding ? 'rebuilding' : (reachable(st) ? 'restored' : 'outage');
}

function serviceStatus(st) {
  if (st.rebuilding) return 'down (instance being replaced)';
  return reachable(st) ? 'up' : 'down';
}

// ---------------------------------------------------------------------------
// Evidence for the CURRENT state
// ---------------------------------------------------------------------------
const SSM_DOWN = ['Session Manager: the target is not connected (the instance is being replaced).'];

function sgRuleLines(st) {
  const desc = '"HTTP to the frontend container (nginx serves the app and proxies /api)"';
  const lines = [`[ "tcp", 80, "${S.VPN}", ${desc} ]`];
  if (st.tf_users_rule) lines.push(`[ "tcp", 80, "${S.USERS}", ${desc} ]`);
  if (st.console_users_rule) lines.push(`[ "tcp", 80, "${S.USERS}", "" ]`);
  if (st.tf_world_rule) lines.push(`[ "tcp", 80, "0.0.0.0/0", ${desc} ]`);
  if (st.console_world_rule) lines.push(`[ "tcp", 80, "0.0.0.0/0", "" ]`);
  return lines;
}

function variant(id, st) {
  const up = reachable(st);
  if (st.rebuilding && ['bootstrap_log', 'docker_ps', 'curl_localhost', 'listening', 'app_logs'].includes(id)) return SSM_DOWN;
  switch (id) {
    case 'curl_public':
      if (st.rebuilding) return ['*   Trying 192.0.2.44:80...', 'curl: (28) Connection timed out after 10001 milliseconds', '(the instance is being replaced)'];
      if (up && st.replaced) {
        return ['*   Trying 192.0.2.44:80...', 'curl: (28) Connection timed out after 10001 milliseconds',
          '(the replacement instance has a NEW public address, 192.0.2.91; users and the monitor still use 192.0.2.44)',
          '$ curl -s -m 10 http://192.0.2.91/api/health', '{"status":"ok","message":"PostureSec API is operational 🛡️"}'];
      }
      if (up) return ['*   Trying 192.0.2.44:80...', '* Connected to 192.0.2.44 port 80', '< HTTP/1.1 200 OK', '{"status":"ok","message":"PostureSec API is operational 🛡️"}'];
      return null;
    case 'ec2_status':
      if (st.rebuilding) return ['[ "pending", "initializing", "initializing" ]', '(a replacement instance is booting; the old one was terminated)'];
      if (st.replaced) return ['[ "running", "ok", "ok" ]', '(a NEW instance, i-0e81f2a6c3d9b4705, up 6 minutes; the original was terminated)'];
      return null;
    case 'bootstrap_log':
      if (st.replaced) return ['[6 min ago] 4/7 application source @ 73922b0', '[5 min ago] 7/7 health check: http://localhost/api/health', '[4 min ago] HEALTHY — PostureBlogging is serving on port 80 (fresh database)'];
      return null;
    case 'docker_ps':
      if (st.replaced) return S.EVIDENCE.docker_ps.output.map((l) => l.replace('Up 2 days', 'Up 4 minutes'));
      return null;
    case 'app_logs':
      if (up && !st.replaced) return ['frontend-1  | 127.0.0.1 - - [T-1m] "GET /api/health HTTP/1.1" 200 61', 'frontend-1  | 203.0.113.10 - - [now] "GET /api/health HTTP/1.1" 200 61', 'frontend-1  | 203.0.113.10 - - [now] "GET / HTTP/1.1" 200 912'];
      if (st.replaced) return ['frontend-1  | 127.0.0.1 - - [now] "GET /api/health HTTP/1.1" 200 61', '(a fresh instance: the posts table is empty — the previous database was on the terminated instance\'s root volume)'];
      return null;
    case 'sg_rules':
      return sgRuleLines(st);
    case 'cloudtrail': {
      const extra = [];
      if (st.console_users_rule || st.console_world_rule || st.console_was_used) extra.push('now    AuthorizeSecurityGroupIngress   principal: root (AWS console)');
      return extra.length ? [...extra, ...S.EVIDENCE.cloudtrail.output] : null;
    }
    case 'state_list': {
      const lines = [`aws_vpc_security_group_ingress_rule.http["${S.VPN}"]`];
      if (st.tf_users_rule) lines.push(`aws_vpc_security_group_ingress_rule.http["${S.USERS}"]`);
      if (st.tf_world_rule) lines.push('aws_vpc_security_group_ingress_rule.http["0.0.0.0/0"]');
      return lines;
    }
    // plan_now is deliberately ALWAYS "No changes": console rules are not in state,
    // so Terraform cannot see them. That is the lesson.
    default:
      return null;
  }
}

function renderEvidence(id, st) {
  if (/^plan_C[0-9]+$/.test(id)) {               // a proposed change's plan (not 'plan_now')
    const change = id.slice(5);
    const plan = own(S.PLANS, change);
    if (!plan) return null;
    let output = plan.output;
    if (change === 'C5' && !st.tf_world_rule) output = ['No changes. Your infrastructure matches the configuration.'];
    return { id, title: plan.title, layer: 'terraform', command: `terraform plan -out=${change}.tfplan`, output, source: 'simulated' };
  }
  const base = own(S.EVIDENCE, id);
  if (!base) return null;
  const v = variant(id, st);
  // A real capture replaces the simulated output only in the two states it was
  // recorded in: the outage itself, and the clean Terraform recovery.
  const cleanOutage = st.phase === 'outage' && !st.replaced && !st.console_was_used && st.applied.length === 0;
  const cleanRestore = st.tf_users_rule && !st.replaced && !st.console_users_rule && !st.console_world_rule && !st.tf_world_rule;
  const phaseKey = cleanOutage ? 'outage' : (cleanRestore ? 'restored' : null);
  const cap = captured(phaseKey, id);
  return {
    id, title: base.title, layer: base.layer, command: base.command,
    output: cap ? cap.lines : (v || base.output),
    source: cap ? 'captured' : 'simulated',
    ...(cap && cap.captured_at ? { captured_at: cap.captured_at } : {}),
  };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
function penalize(st, reason) {
  if (st.penalized.includes(reason)) return;     // each penalty applies once
  st.penalized.push(reason);
}

function reveal(st, ids) {
  for (const id of ids) if (!st.revealed.includes(id)) st.revealed.push(id);
}

/** A replacement started in an earlier step finishes before the next one. */
function finishRebuild(st) {
  if (!st.rebuilding) return null;
  st.rebuilding = false;
  return reachable(st)
    ? 'The replacement instance finished booting with a NEW public address and an EMPTY database.'
    : 'The replacement instance finished booting (new public address, empty database). The security group did not change, so it is just as unreachable.';
}

function act(prev, actionId, nowMs) {
  const st = clone(prev);
  const def = own(S.ACTIONS, actionId);
  if (!def) return { state: prev, result: { ok: false, code: 400, message: 'Unknown action' } };
  if (st.phase === 'closed') return { state: prev, result: { ok: false, code: 409, message: 'This attempt is closed' } };
  if (st.timeline.length >= MAX_ACTIONS) return { state: prev, result: { ok: false, code: 429, message: 'Action limit reached for this attempt' } };
  if (st.phase === 'completed' && def.kind !== 'investigate') {
    return { state: prev, result: { ok: false, code: 409, message: 'Incident already completed; only investigation is available' } };
  }

  const notes = [];
  if (def.kind !== 'investigate') {
    const rebuilt = finishRebuild(st);
    if (rebuilt) notes.push(rebuilt);
  }
  let message;
  let revealed = [];
  if (def.kind === 'investigate') {
    reveal(st, def.reveals);
    revealed = def.reveals;
    message = 'Evidence added.';
  } else if (def.kind === 'runtime') {
    message = runtime(st, actionId);
  } else if (def.kind === 'remediate') {
    ({ message, revealed } = remediate(st, def, actionId));
  } else {
    message = verify(st, nowMs);
  }

  refresh(st);
  if (st.verified && st.report && st.phase === 'restored') st.phase = 'completed';
  const outcome = [...notes, message].join(' ');
  st.timeline.push({ t: secs(st, nowMs), action: actionId, kind: def.kind, outcome: outcome.slice(0, 300) });
  return { state: st, result: { ok: true, code: 200, message: outcome, revealed, service: serviceStatus(st) } };
}

function runtime(st, actionId) {
  const up = reachable(st);
  switch (actionId) {
    case 'restart_containers':
      if (st.rebuilding) return 'Session Manager cannot reach the instance while it is being replaced.';
      return up ? 'Containers restarted.' : 'All three containers restarted and are healthy again on the instance. The site is still unreachable from outside.';
    case 'reboot_instance':
      if (st.rebuilding) return 'The instance is being replaced.';
      return up ? 'Rebooted; back in about a minute.' : 'The instance rebooted and came back in about a minute (same address, containers healthy). Still unreachable from outside.';
    case 'console_add_our_ip':
      if (st.console_users_rule || st.tf_users_rule) return 'A rule for our address already exists.';
      penalize(st, 'console_add_our_ip');
      st.console_users_rule = true;
      st.console_was_used = true;
      return 'Rule added in the console. The site loads again from the classroom.';
    case 'console_open_world':
      if (st.console_world_rule) return 'The rule already exists.';
      penalize(st, 'console_open_world');
      st.console_world_rule = true;
      st.console_was_used = true;
      return 'Port 80 opened to 0.0.0.0/0 in the console. The site loads again — for everyone on the internet.';
    case 'remove_console_rules':
      if (!st.console_users_rule && !st.console_world_rule) return 'No console-created rules exist.';
      st.console_users_rule = false;
      st.console_world_rule = false;
      return reachable(st) ? 'Console-created rules removed; the Terraform-managed rules remain.' : 'Console-created rules removed. Nothing now allows our address in: the site is unreachable again.';
    case 'edit_state':
      penalize(st, 'edit_state');
      return 'Refused by change control: hand-editing state makes Terraform\'s record disagree with AWS and is not a recovery procedure. Nothing was changed.';
    case 'replace_instance':
      penalize(st, 'replace_instance');
      st.rebuilding = true;
      st.replaced = true;
      return 'The instance is being terminated and replaced: the database on its root volume is gone, and the new instance will get a new public address.';
    default:
      return 'Nothing happened.';
  }
}

function remediate(st, def, actionId) {
  if (def.change) {
    if (st.applied.includes(def.change) && def.change !== 'C5') return { message: `Change ${def.change} is already applied.`, revealed: [] };
    st.proposed = def.change;
    st.reviewed = false;
    return { message: `Change ${def.change} committed to a branch: "${S.CHANGES[def.change]}". Review its plan before applying.`, revealed: [] };
  }
  if (actionId === 'review_plan') {
    if (!st.proposed) return { message: 'Nothing proposed yet.', revealed: [] };
    st.reviewed = true;
    const id = `plan_${st.proposed}`;
    reveal(st, [id]);
    return { message: `Plan for ${st.proposed} produced.`, revealed: [id] };
  }
  // apply_plan
  if (!st.proposed) return { message: 'Nothing proposed yet.', revealed: [] };
  const change = st.proposed;
  const reviewed = st.reviewed;
  if (change === 'C1' && st.console_users_rule) {
    // The console rule is not in state, so Terraform tries to create an identical rule.
    return {
      message: 'Apply FAILED: creating VPC Security Group Ingress Rule: InvalidPermission.Duplicate: the specified rule "peer: 203.0.113.10/32, TCP, from port: 80, to port: 80, ALLOW" already exists. Nothing was changed.',
      revealed: [],
    };
  }
  st.proposed = null;
  st.reviewed = false;
  if (!st.applied.includes(change)) st.applied.push(change);
  switch (change) {
    case 'C1':
      st.tf_users_rule = true;
      st.fixed_reviewed = reviewed;
      return { message: 'Apply complete: 1 added, 0 changed, 0 destroyed. The classroom can reach the site again.', revealed: [] };
    case 'C2':
      penalize(st, 'apply_wrong_change');
      return { message: 'Apply complete: 1 added, 0 changed, 0 destroyed. Port 80 from our address is still not allowed.', revealed: [] };
    case 'C3':
      penalize(st, 'apply_world_open');
      st.tf_world_rule = true;
      return { message: 'Apply complete: 1 added. Port 80 is now open to the whole internet — for an intentionally vulnerable training app.', revealed: [] };
    case 'C4':
      penalize(st, 'replace_instance');
      st.rebuilding = true;
      st.replaced = true;
      return { message: 'Apply started: 1 to add, 1 to destroy. aws_instance.app is being REPLACED (user_data changed): new address, fresh database.', revealed: [] };
    case 'C5':
      if (!st.tf_world_rule) return { message: 'Apply complete: no changes.', revealed: [] };
      st.tf_world_rule = false;
      return { message: 'Apply complete: 0 added, 0 changed, 1 destroyed. 0.0.0.0/0 removed from port 80.', revealed: [] };
    default:
      return { message: 'Nothing happened.', revealed: [] };
  }
}

function verify(st, nowMs) {
  const checks = {
    reachable_from_users: reachable(st) && !st.replaced,
    fixed_in_terraform: st.tf_users_rule,
    no_internet_wide_exposure: !st.tf_world_rule && !st.console_world_rule,
    no_rules_outside_terraform: !st.console_users_rule && !st.console_world_rule,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length === 0) {
    if (!st.verified) st.restored_at_s = secs(st, nowMs);
    st.verified = true;
    return 'Verification passed: http://192.0.2.44/api/health = 200 from the classroom, every port-80 rule is managed by Terraform, nothing is open to 0.0.0.0/0, terraform plan reports no changes.';
  }
  st.verified = false;
  return `Verification failed: ${failed.join(', ')}.`;
}

function submitReport(prev, body, nowMs) {
  const st = clone(prev);
  if (st.phase === 'closed') return { state: prev, result: { ok: false, code: 409, message: 'This attempt is closed' } };
  if (st.report) return { state: prev, result: { ok: false, code: 409, message: 'A report has already been submitted for this attempt' } };
  const hypothesis = typeof body.hypothesis === 'string' ? body.hypothesis : '';
  if (!own(S.HYPOTHESES, hypothesis)) return { state: prev, result: { ok: false, code: 400, message: 'hypothesis must be one of the listed options' } };
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (summary.length > MAX_SUMMARY) return { state: prev, result: { ok: false, code: 400, message: `summary must be at most ${MAX_SUMMARY} characters` } };
  st.report = { hypothesis, summary, at_s: secs(st, nowMs) };
  if (st.verified && st.phase === 'restored') st.phase = 'completed';
  st.timeline.push({ t: secs(st, nowMs), action: 'submit_report', kind: 'report', outcome: 'Report submitted.' });
  return { state: st, result: { ok: true, code: 200, message: 'Report submitted.' } };
}

function score(st) {
  const R = S.RUBRIC;
  const evidence = ['symptom', 'platform', 'change']
    .reduce((n, g) => n + (R.evidence[g].some((id) => st.revealed.includes(id)) ? R.evidence.pointsPerGroup : 0), 0);
  const diagnosis = st.report && st.report.hypothesis === R.diagnosis.correct ? R.diagnosis.points : 0;
  const remediation = st.tf_users_rule ? (st.fixed_reviewed ? R.remediation.reviewed : R.remediation.unreviewed) : 0;
  const verification = st.verified ? R.verification : 0;
  const report = st.report && st.report.summary.length >= R.report.minSummary ? R.report.points : 0;
  const penalties = st.penalized.map((reason) => ({ reason, points: R.penalties[reason] || 0 }));
  const gross = evidence + diagnosis + remediation + verification + report;
  return {
    total: Math.max(0, gross - penalties.reduce((n, p) => n + p.points, 0)),
    breakdown: { evidence, diagnosis, remediation, verification, report },
    penalties,
    time_to_verified_s: st.restored_at_s,
  };
}

/** What the squad may see. Never the correct hypothesis or the internal flags. */
function publicView(st) {
  return {
    attempt_id: st.attempt_id,
    service_name: S.SERVICE,
    service: serviceStatus(st),
    completed: st.phase === 'completed',
    evidence: st.revealed.map((id) => renderEvidence(id, st)).filter(Boolean),
    proposed_change: st.proposed,
    plan_reviewed: st.reviewed,
    applied_changes: st.applied,
    report_submitted: Boolean(st.report),
    timeline: st.timeline,
    score: st.phase === 'completed' ? score(st) : null,
  };
}

module.exports = {
  newAttempt, act, submitReport, renderEvidence, score, publicView, serviceStatus, reachable, MAX_ACTIONS, MAX_SUMMARY,
};
