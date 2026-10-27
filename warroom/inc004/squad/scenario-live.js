/**
 * INC-004 live (real AWS) scenario rules — pure functions over a driver observation.
 * ONE squad, ONE lab: "users" are the squad's approved addresses (squad.auto.tfvars),
 * and the platform probes from the control plane's own address, which must be one of them.
 *
 * An observation (driver.observe()):
 *   {
 *     instance:          { id, state, system, instance } | null   EC2 + both status checks
 *     ssm_online:        bool                                     Session Manager registered
 *     app_health_inside: bool                                     curl localhost/api/health on the box
 *     http_from_squad:   number                                   HTTP code seen from the control plane (0 = no response)
 *     squad_cidrs:       ['a.b.c.d/32', ...]                      the squad's approved addresses
 *     probe_cidr:        'a.b.c.d/32'                             the control plane's own address
 *     rules:             [{ cidr, managed }]                      port-80 rules in AWS; managed = present in state
 *     plan_noop:         bool                                     terraform plan of the current configuration: no changes
 *     console_rules:     bool                                     some port-80 rule is not in state
 *     world_open:        bool                                     some port-80 rule is 0.0.0.0/0
 *   }
 */

// What a squad member can examine (each is a real, read-only command in driver-real.js / lab.sh).
const EVIDENCE = {
  http_from_squad: 'GET /api/health from the squad\'s own network (what users experience)',
  services: 'Inside the instance via Session Manager: containers + localhost /api/health',
  ec2_status: 'EC2 instance state and both status checks',
  sg_rules: 'The security group\'s port-80 rules as AWS has them',
  state_rules: 'The port-80 rules Terraform state records',
  config: 'The squad\'s Terraform ingress configuration (squad.auto.tfvars) and its change history',
  plan_now: 'terraform plan of the current configuration',
  change_history: 'CloudTrail: recent security group API calls',
};

const HYPOTHESES = {
  H1: 'A Terraform change removed the network path the users depended on',
  H2: 'The application containers crashed or became unhealthy',
  H3: 'The EC2 instance failed (host or status-check failure)',
  H4: 'Terraform state drifted away from the real infrastructure',
  H5: 'The bootstrap / user data failed after a rebuild',
  H6: 'An AWS regional service event',
};

const RUBRIC = {
  evidenceGroups: {
    symptom: ['http_from_squad', 'services'],
    platform: ['sg_rules', 'ec2_status'],
    change: ['config', 'change_history', 'plan_now', 'state_rules'],
  },
  pointsPerGroup: 10,
  correct: 'H1',
  diagnosis: 30,
  reviewed: 20,
  unreviewed: 15,
  verification: 10,
  report: 10,
  minSummary: 40,
};

// Detected from real observations, so they apply however the change was made.
const PENALTIES = {
  console_rule: 10,       // a port-80 rule exists that Terraform does not manage
  world_open: 15,         // port 80 open to 0.0.0.0/0 at any point after the incident
  instance_replaced: 25,  // the instance id changed: data lost, new address
};

const ok = (i) => Boolean(i && i.state === 'running' && i.system === 'ok' && i.instance === 'ok');

/** Ready to arm: running, both checks, SSM, app healthy inside AND reachable from the squad. */
function healthy(obs) {
  return ok(obs.instance) && obs.ssm_online && obs.app_health_inside && obs.http_from_squad === 200;
}

function why(obs) {
  const r = [];
  if (!ok(obs.instance)) r.push('instance not running with both status checks ok');
  if (!obs.ssm_online) r.push('Session Manager not online');
  if (!obs.app_health_inside) r.push('application not healthy on the instance');
  if (obs.http_from_squad !== 200) r.push(`the squad gets ${obs.http_from_squad || 'no response'}`);
  return r.join('; ') || 'healthy';
}

function recoveryChecks(obs, st) {
  const managed = new Set((obs.rules || []).filter((r) => r.managed).map((r) => r.cidr));
  return {
    users_reach_the_app: obs.http_from_squad === 200,
    fixed_in_terraform: (obs.squad_cidrs || []).length > 0 && obs.squad_cidrs.every((c) => managed.has(c)),
    no_rules_outside_terraform: !obs.console_rules,
    no_internet_wide_exposure: !obs.world_open,
    configuration_matches_aws: Boolean(obs.plan_noop),
    same_instance: Boolean(obs.instance && obs.instance.id === st.instance_id),
  };
}

/** Validate a squad's ingress list: canonical IPv4 CIDRs, /24 or narrower, never 0.0.0.0/0, 1-10 entries. */
function validCidrs(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 10) return false;
  return list.every((c) => {
    if (typeof c !== 'string') return false;
    const m = c.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
    if (!m) return false;
    const oct = m.slice(1, 5).map(Number);
    const bits = Number(m[5]);
    if (oct.some((o) => o > 255) || bits < 24 || bits > 32) return false;
    const ip = oct.reduce((n, o) => n * 256 + o, 0);
    const size = 2 ** (32 - bits);
    return ip % size === 0;           // canonical: no host bits set
  }) && new Set(list).size === list.length;
}

module.exports = { EVIDENCE, HYPOTHESES, RUBRIC, PENALTIES, healthy, why, recoveryChecks, validCidrs };
