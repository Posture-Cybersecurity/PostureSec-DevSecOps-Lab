/**
 * INC-005 "Console Hotfix Drift" — pure rules over a driver observation (see scenario-live.js
 * for the observation's shape; INC-005 adds config_intact: the desired configuration is
 * byte-for-byte what was deployed).
 *
 * The fault is DRIFT, not a broken configuration: the platform deletes the squad's real
 * Terraform-managed port-80 rule through the AWS API. Configuration and state are untouched, so
 * the next plan of the unchanged configuration is exactly "1 to add". The fix is that plan,
 * saved, inspected and applied — never a console repair.
 */
const LIVE = require('./scenario-live');

// What a squad member can examine (real, read-only commands in squad-lab.sh `evidence`).
const EVIDENCE = {
  http_from_squad: 'HTTP probe: GET /api/health from the squad\'s network (what users experience)',
  services: 'Inside the instance via Session Manager: containers + localhost /api/health',
  sg_rules: 'Security group rules as AWS has them right now',
  state_rules: 'Port-80 rules as Terraform state records them',
  plan_now: 'terraform plan of the unchanged desired configuration',
  change_history: 'CloudTrail: recent API calls against the security group',
};

// Scoring is objective: what the squad looked at, how it fixed it, and how fast. No report needed.
const RUBRIC = {
  evidenceGroups: {                       // 10 each: symptom, AWS reality, Terraform's view
    symptom: ['http_from_squad', 'services'],
    aws: ['sg_rules', 'change_history'],
    terraform: ['plan_now', 'state_rules'],
  },
  pointsPerGroup: 10,
  restored: 40,                           // all checks pass after a guarded Terraform apply
  inspected: 15,                          // the applied saved plan was inspected before the apply
  speed: [[15 * 60, 15], [30 * 60, 10], [60 * 60, 5]],   // seconds from incident to verified recovery
};

const PENALTIES = {
  console_rule: 20,        // a port-80 rule exists that Terraform does not manage (a console "fix")
  world_open: 30,          // port 80 open to 0.0.0.0/0 at any point
  instance_replaced: 30,   // the instance id changed: data lost, new address
};

const CHECKS = {
  same_instance_healthy: 'The original EC2 instance is the same one and is healthy',
  app_reachable_from_squad: 'The application answers from the squad\'s approved network',
  rule_exists_in_aws: 'The intended port-80 rule exists in AWS',
  rule_managed_by_terraform: 'That rule is recorded in the squad\'s Terraform state and configuration',
  no_world_open_http: 'No port-80 rule is open to 0.0.0.0/0',
  plan_clean: 'A fresh terraform plan reports no changes',
};

const ok = (i) => Boolean(i && i.state === 'running' && i.system === 'ok' && i.instance === 'ok');

/** Ready to inject: healthy AND converged (the unchanged configuration plans clean). */
function ready(obs) {
  return LIVE.healthy(obs) && obs.plan_noop === true && obs.config_intact === true;
}

function why(obs) {
  const r = [LIVE.why(obs)].filter((x) => x !== 'healthy');
  if (obs.plan_noop !== true) r.push('the plan of the desired configuration is not clean');
  if (obs.config_intact !== true) r.push('the desired configuration changed');
  return r.join('; ') || 'ready';
}

/** The six recovery checks. `target` is the CIDR of the rule the platform deleted. */
function checks(obs, st) {
  const target = st.injection && st.injection.cidr;
  const rules = obs.rules || [];
  return {
    same_instance_healthy: Boolean(obs.instance && obs.instance.id === st.instance_id && ok(obs.instance) && obs.app_health_inside),
    app_reachable_from_squad: obs.http_from_squad === 200,
    rule_exists_in_aws: rules.some((r) => r.cidr === target),
    rule_managed_by_terraform: rules.some((r) => r.cidr === target && r.managed) && obs.config_intact === true,
    no_world_open_http: !obs.world_open,
    plan_clean: obs.plan_noop === true,
  };
}

function penaltiesFrom(obs, st) {
  const p = [];
  if (obs.console_rules) p.push('console_rule');
  if (obs.world_open) p.push('world_open');
  if (obs.instance && st.instance_id && obs.instance.id !== st.instance_id) p.push('instance_replaced');
  return p;
}

/** a.b.c.d inside cidr? (IPv4 only; used to pick the rule the control plane probes through.) */
function cidrContains(cidr, ip) {
  const n = (s) => s.split('.').reduce((a, o) => a * 256 + Number(o), 0);
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr || '');
  if (!m || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip || '')) return false;
  const size = 2 ** (32 - Number(m[2]));
  return Math.floor(n(ip) / size) === Math.floor(n(m[1]) / size);
}

module.exports = { EVIDENCE, RUBRIC, PENALTIES, CHECKS, ready, why, checks, penaltiesFrom, cidrContains, validCidrs: LIVE.validCidrs };
