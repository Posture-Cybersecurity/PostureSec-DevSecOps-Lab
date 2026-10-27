/**
 * The REAL squad driver: every side effect is `squad-lab.sh <command>` run as the SQUAD's own
 * least-privilege AWS identity (a profile NAME — no credential passes through here). Kept apart
 * from driver-fake.js on purpose: the fake is for tests and is never selected implicitly.
 *
 *   exec:  execFile with an argument array and no shell, so member input can never become a
 *          shell command; a timeout per operation; stdout/stderr captured.
 *   parse: the script's machine lines (PLAN / APPLIED / FAULT / CONFIG / TAGGED, JSON lines).
 *          Anything unrecognised is an error — the driver fails closed, it never guesses.
 *
 * scenario 'drift' (INC-005) runs squad-lab.sh with WARROOM_SCENARIO=drift: injectDrift() and the
 * restore plan; set-config / inject-fault / tag are then refused by the script itself.
 *
 * mask(): everything a person sees (evidence, plan text, summaries, timeline) has the squad's
 * addresses replaced by <squad-network-N>, other IPv4 addresses by <ip>, account ids masked.
 * observe() keeps raw values: the platform's checks need them; they are never displayed.
 */
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'squad-lab.sh');
const TIMEOUT = { plan: 15 * 60e3, apply: 45 * 60e3, observe: 3 * 60e3, default: 5 * 60e3 };

function defaultExec(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, { ...opts, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

class DriverError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; }
}

function maskWith(squadCidrs) {
  const labels = squadCidrs.map((c, i) => [c, `<squad-network-${i + 1}>`]);
  return (text) => {
    let t = String(text == null ? '' : text);
    for (const [c, label] of labels) t = t.split(c).join(label);
    return t.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g, '<ip>').replace(/\b\d{8}(\d{4})\b/g, '********$1');
  };
}

function createRealDriver({ squad, squadCidrs, accountId, profile, allowRoot = false, scenario = 'inc004', exec = defaultExec, bash = 'bash', script = SCRIPT, operatorDir }) {
  if (!/^[a-z0-9][a-z0-9-]{1,14}$/.test(squad || '')) throw new Error('squad id invalid');
  if (!Array.isArray(squadCidrs) || !squadCidrs.length) throw new Error('squadCidrs required');
  if (!/^[0-9]{12}$/.test(accountId || '')) throw new Error('accountId must be 12 digits');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(profile || '')) throw new Error('profile: an AWS CLI profile NAME');
  if (!['inc004', 'drift'].includes(scenario)) throw new Error('scenario: inc004 or drift');
  const mask = maskWith(squadCidrs);

  const env = (actor) => {
    const e = { ...process.env, WARROOM_SQUAD_ID: squad, WARROOM_SQUAD_CIDRS: squadCidrs.join(','), WARROOM_EXPECTED_ACCOUNT_ID: accountId, AWS_PROFILE: profile, WARROOM_ACTOR: actor || 'platform', WARROOM_SCENARIO: scenario };
    for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) delete e[k];   // the profile only
    if (operatorDir) e.WARROOM_OPERATOR_DIR = operatorDir;
    // The owner's explicit authorization to run THIS dedicated lab account as root (bound to it).
    if (allowRoot) e.WARROOM_ALLOW_ROOT_FOR_LAB = `dedicated-lab-${accountId}`; else delete e.WARROOM_ALLOW_ROOT_FOR_LAB;
    return e;
  };

  async function run(args, { actor, kind = 'default' } = {}) {
    const r = await exec(bash, [script, ...args], { env: env(actor), timeout: TIMEOUT[kind] || TIMEOUT.default });
    const refused = (r.stderr.match(/^REFUSED: (.*)$/m) || [])[1];
    if (refused) throw new DriverError(`refused: ${mask(refused)}`, r);
    return r;
  }

  const line = (stdout, re) => {
    const m = stdout.split(/\r?\n/).map((l) => l.match(re)).find(Boolean);
    return m || null;
  };

  const lastJson = (stdout) => {
    const l = stdout.trim().split(/\r?\n/).pop();
    try { return JSON.parse(l); } catch (_e) { throw new DriverError('unreadable JSON from squad-lab.sh', { stdout }); }
  };

  return {
    kind: 'real',
    mask,

    async plan(kind) {
      const r = await run(['plan', kind], { kind: 'plan' });
      const m = line(r.stdout, /^PLAN (\S+) (ALLOWED|REFUSED|ERROR) ?(.*)$/);
      if (!m) throw new DriverError('no PLAN line from squad-lab.sh', r);
      return { name: m[1], allowed: m[2] === 'ALLOWED', summary: mask(m[3] || m[2]) };
    },

    async apply(name) {
      const r = await run(['apply', name], { kind: 'apply' });
      const ok = line(r.stdout, /^APPLIED (\S+) ?(.*)$/);
      if (ok && ok[1] === name) return ok[2];
      const failed = line(r.stdout, /^APPLY \S+ FAILED (.*)$/);
      throw new DriverError(failed ? mask(failed[1]) : `apply of ${name} did not report success`, r);
    },

    async showPlan(name) { return mask((await run(['show-plan', name])).stdout); },

    async writeConfig(cidrs, actor) {
      const r = await run(['set-config', cidrs.join(',')], { actor });
      if (!line(r.stdout, /^CONFIG /)) throw new DriverError('set-config did not confirm', r);
    },

    async injectFault() {
      const r = await run(['inject-fault'], { kind: 'apply' });
      const m = line(r.stdout, /^FAULT (ALLOWED|REFUSED|FAILED) ?(.*)$/);
      if (!m) throw new DriverError('no FAULT line from squad-lab.sh', r);
      return { allowed: m[1] === 'ALLOWED', summary: m[2] || m[1] };
    },

    // INC-005: delete the squad's Terraform-managed port-80 rule through the AWS API (idempotent).
    async injectDrift() {
      const r = await run(['inject-drift'], { kind: 'apply' });
      const ok = line(r.stdout, /^DRIFT DELETED (sgr-[0-9a-f]+) (\S+)( already-absent)?$/);
      if (ok) return { deleted: true, ruleId: ok[1], cidr: ok[2], already: Boolean(ok[3]) };
      const no = line(r.stdout, /^DRIFT (REFUSED|FAILED) (.*)$/);
      if (no) return { deleted: false, summary: mask(`${no[1]}: ${no[2]}`) };
      throw new DriverError('no DRIFT line from squad-lab.sh', r);
    },

    async observe() {
      const o = lastJson((await run(['observe'], { kind: 'observe' })).stdout);
      if (o.instance === null) return { instance: null, ssm_online: false, app_health_inside: false, http_from_squad: 0, squad_cidrs: squadCidrs, rules: [], plan_noop: false, console_rules: false, world_open: false };
      for (const k of ['ssm_online', 'app_health_inside', 'plan_noop', 'console_rules', 'world_open']) {
        if (typeof o[k] !== 'boolean') throw new DriverError(`observe: ${k} missing`, o);
      }
      if (!Array.isArray(o.rules) || typeof o.http_from_squad !== 'number') throw new DriverError('observe: malformed', o);
      return o;
    },

    async evidence(id) { return mask((await run(['evidence', id])).stdout); },

    async tag(tags) {
      const args = Object.entries(tags).map(([k, v]) => `${k}=${v}`);
      const r = await run(['tag', ...args]);
      if (!line(r.stdout, /^TAGGED /)) throw new DriverError('tag did not confirm', r);
    },

    async remaining() {
      const v = lastJson((await run(['remaining'])).stdout);
      if (!Array.isArray(v)) throw new DriverError('remaining: not a list', v);
      return v;
    },
  };
}

module.exports = { createRealDriver, DriverError, SCRIPT, maskWith };
