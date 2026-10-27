/**
 * squad-lab.sh — the REAL script, run by real bash, with fake `aws`, `terraform` and `curl` first
 * on PATH (jq and node are the real ones). Nothing reaches AWS. Pinned: root and wrong-account
 * refusal before any Terraform runs; per-squad workspace, configuration file, plans and history;
 * the guard invoked with the squad (another squad's resources refused); allow-listed commands.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../../warroom/inc004/squad/squad-lab.sh');
const ACCT = '111111111111';

const AWS = `#!/usr/bin/env bash
echo "aws $*" >> "$SHIM_LOG"
case "$1 $2" in
  "sts get-caller-identity") printf '{"Account":"%s","Arn":"%s"}\\n' "$FAKE_ACCOUNT" "$FAKE_ARN" ;;
  "ec2 describe-security-groups") echo "\${FAKE_EXISTING_SG:-}" ;;
  "ec2 create-tags") : ;;
  *) : ;;
esac
`;
// Plans: the shape of the JSON depends on the plan kind (from the -out file name).
const TF = `#!/usr/bin/env bash
args=(); for a in "$@"; do case "$a" in -chdir=*) ;; *) args+=("$a");; esac; done
echo "terraform TF_WORKSPACE=\${TF_WORKSPACE:-} \${args[*]} PRECREATED=\${TF_VAR_use_precreated_profile:-}" >> "$SHIM_LOG"
sq="\${FAKE_TAG_SQUAD:-$TF_WORKSPACE}"
tags="{\\"WarRoom\\":\\"INC-004\\",\\"WarRoomSquad\\":\\"$sq\\"}"
case "\${args[0]}" in
  init) exit 0 ;;
  workspace) [ "\${args[1]}" = list ] && echo "* default"; exit 0 ;;
  state) exit 0 ;;
  output) exit 1 ;;
  plan) for a in "\${args[@]}"; do case "$a" in -out=*) echo plan > "\${a#-out=}";; esac; done
        echo "Terraform will perform the following actions:"; echo '  - "WarRoomPhase" = "armed" -> null'; echo "Plan: 1 to add, 0 to change, 1 to destroy."; exit 0 ;;
  show) f="\${args[2]}"
        case "$(basename "$f")" in
          fault-*) echo "{\\"resource_changes\\":[{\\"address\\":\\"module.lab.aws_vpc_security_group_ingress_rule.http[\\\\\\"198.51.100.0/24\\\\\\"]\\",\\"module_address\\":\\"module.lab\\",\\"mode\\":\\"managed\\",\\"type\\":\\"aws_vpc_security_group_ingress_rule\\",\\"index\\":\\"198.51.100.0/24\\",\\"change\\":{\\"actions\\":[\\"create\\"],\\"before\\":null,\\"after\\":{\\"tags_all\\":$tags}}},{\\"address\\":\\"module.lab.aws_vpc_security_group_ingress_rule.http[\\\\\\"203.0.113.10/32\\\\\\"]\\",\\"module_address\\":\\"module.lab\\",\\"mode\\":\\"managed\\",\\"type\\":\\"aws_vpc_security_group_ingress_rule\\",\\"index\\":\\"203.0.113.10/32\\",\\"change\\":{\\"actions\\":[\\"delete\\"],\\"before\\":{\\"tags_all\\":$tags},\\"after\\":null}}]}" ;;
          *) echo "{\\"resource_changes\\":[{\\"address\\":\\"module.lab.aws_instance.app\\",\\"module_address\\":\\"module.lab\\",\\"mode\\":\\"managed\\",\\"type\\":\\"aws_instance\\",\\"change\\":{\\"actions\\":[\\"create\\"],\\"before\\":null,\\"after\\":{\\"tags_all\\":$tags}}}]}" ;;
        esac ;;
  apply) echo "Apply complete! Resources: 1 added, 0 changed, 1 destroyed." ;;
esac
`;
const CURL = `#!/usr/bin/env bash
echo "curl $*" >> "$SHIM_LOG"
case "$*" in *checkip*) echo 203.0.113.10 ;; *) echo 000 ;; esac
`;

let shims;
let opdir;
beforeAll(() => {
  shims = fs.mkdtempSync(path.join(os.tmpdir(), 'inc004-shims-'));
  for (const [n, body] of [['aws', AWS], ['terraform', TF], ['curl', CURL]]) {
    fs.writeFileSync(path.join(shims, n), body, { mode: 0o755 });
  }
});
beforeEach(() => { opdir = fs.mkdtempSync(path.join(os.tmpdir(), 'inc004-op-')); });
afterAll(() => { fs.rmSync(shims, { recursive: true, force: true }); });

function run(args, env = {}) {
  const log = path.join(opdir, 'shim.log');
  const sep = process.platform === 'win32' ? ';' : ':';
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${shims}${sep}${process.env.PATH}`, SHIM_LOG: log, WARROOM_OPERATOR_DIR: opdir,
      WARROOM_SQUAD_ID: 'alpha', WARROOM_SQUAD_CIDRS: '203.0.113.10/32', WARROOM_EXPECTED_ACCOUNT_ID: ACCT,
      FAKE_ACCOUNT: ACCT, FAKE_ARN: `arn:aws:sts::${ACCT}:assumed-role/warroom-squad-alpha/bob`, AWS_PROFILE: 'warroom-squad-alpha',
      ...env,
    },
  });
  const shim = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { code: r.status, out: r.stdout, err: r.stderr, shim };
}

describe('identity: never root, never the wrong account — refused before any Terraform', () => {
  test('the root user is refused', () => {
    const r = run(['plan', 'baseline'], { FAKE_ARN: `arn:aws:iam::${ACCT}:root` });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/REFUSED: the root user is never a squad identity/);
    expect(r.shim).not.toMatch(/^terraform/m);
  });
  test('root with an acknowledgement for ANOTHER account, or a vague one, is still refused', () => {
    for (const ack of ['dedicated-lab-999999999999', 'yes', 'dedicated-lab-']) {
      const r = run(['plan', 'baseline'], { FAKE_ARN: `arn:aws:iam::${ACCT}:root`, WARROOM_ALLOW_ROOT_FOR_LAB: ack });
      expect(r.err).toMatch(/REFUSED: the root user is never a squad identity unless authorized/);
      expect(r.shim).not.toMatch(/^terraform/m);
    }
  });
  test('root with the acknowledgement bound to THIS account runs, warns, and the stack creates its own profile', () => {
    const r = run(['plan', 'baseline'], { FAKE_ARN: `arn:aws:iam::${ACCT}:root`, WARROOM_ALLOW_ROOT_FOR_LAB: `dedicated-lab-${ACCT}` });
    expect(r.err).toMatch(/WARNING: running as the ROOT user of account \*{8}1111, as authorized for this dedicated lab/);
    expect(r.out).toMatch(/^PLAN baseline-alpha-\S+ ALLOWED/m);
    expect(r.shim).toMatch(/terraform TF_WORKSPACE=alpha plan .* PRECREATED=false/);
    const n = run(['plan', 'baseline']);                                       // a non-root squad identity: unchanged
    expect(n.shim).toMatch(/terraform TF_WORKSPACE=alpha plan .* PRECREATED=true/);
  });
  test('root authorization does not bypass the account check', () => {
    const r = run(['plan', 'baseline'], { FAKE_ARN: 'arn:aws:iam::999999999999:root', FAKE_ACCOUNT: '999999999999', WARROOM_ALLOW_ROOT_FOR_LAB: 'dedicated-lab-999999999999' });
    expect(r.err).toMatch(/is not the expected lab account/);
  });
  test('another account is refused, and its number is masked', () => {
    const r = run(['plan', 'baseline'], { FAKE_ACCOUNT: '999999999999' });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/caller account \*{8}9999 is not the expected lab account/);
    expect(r.shim).not.toMatch(/^terraform/m);
  });
  test('a bad squad id or address list is refused before AWS is even asked', () => {
    expect(run(['preflight'], { WARROOM_SQUAD_ID: '../x' }).err).toMatch(/WARROOM_SQUAD_ID/);
    for (const bad of ['0.0.0.0/0', '10.0.0.0/8', '203.0.113.11/24', '']) {
      const r = run(['preflight'], { WARROOM_SQUAD_CIDRS: bad });
      expect(r.err).toMatch(/WARROOM_SQUAD_CIDRS/);
      expect(r.shim).not.toMatch(/sts get-caller-identity/);
    }
  });
});

describe('per-squad isolation on one control-plane host', () => {
  test("each squad gets its own workspace, configuration, plans and history", () => {
    const a = run(['plan', 'baseline']);
    const b = run(['plan', 'baseline'], { WARROOM_SQUAD_ID: 'bravo', WARROOM_SQUAD_CIDRS: '198.18.0.10/32', FAKE_ARN: `arn:aws:sts::${ACCT}:assumed-role/warroom-squad-bravo/zed` });
    expect(a.out).toMatch(/^PLAN baseline-alpha-\S+ ALLOWED/m);
    expect(b.out).toMatch(/^PLAN baseline-bravo-\S+ ALLOWED/m);
    expect(a.shim).toMatch(/terraform TF_WORKSPACE= workspace new alpha/);
    expect(a.shim).toMatch(/terraform TF_WORKSPACE=alpha plan .*-var-file=.*squads[\\/]alpha[\\/]ingress\.tfvars/);
    expect(b.shim).toMatch(/terraform TF_WORKSPACE=bravo plan .*-var-file=.*squads[\\/]bravo[\\/]ingress\.tfvars/);
    expect(fs.readFileSync(path.join(opdir, 'squads/alpha/ingress.tfvars'), 'utf8')).toMatch(/"203\.0\.113\.10\/32"/);
    expect(fs.readFileSync(path.join(opdir, 'squads/bravo/ingress.tfvars'), 'utf8')).toMatch(/"198\.18\.0\.10\/32"/);
    expect(fs.readdirSync(path.join(opdir, 'squads/alpha/plans')).every((f) => f.includes('-alpha-'))).toBe(true);
  });

  test("the guard is run with the squad: a plan touching another squad's resources is REFUSED", () => {
    const r = run(['plan', 'baseline'], { FAKE_TAG_SQUAD: 'bravo' });
    expect(r.out).toMatch(/^PLAN baseline-alpha-\S+ REFUSED .*belongs to squad "bravo", not "alpha"/m);
  });

  test("apply accepts only this squad's own, guard-ALLOWED, not-yet-applied plans", () => {
    const p = run(['plan', 'baseline']).out.match(/^PLAN (\S+) ALLOWED/m)[1];
    expect(run(['apply', p.replace('-alpha-', '-bravo-')]).err).toMatch(/apply <plan-name of this squad>/);
    const ok = run(['apply', p]);
    expect(ok.out).toMatch(new RegExp(`^APPLIED ${p} Apply complete!`, 'm'));
    expect(run(['apply', p]).err).toMatch(/no such saved plan \(or it was already applied\)/);
    const refused = run(['plan', 'baseline'], { FAKE_TAG_SQUAD: 'bravo' }).out.match(/^PLAN (\S+) REFUSED/m)[1];
    expect(run(['apply', refused]).err).toMatch(/was not allowed by the guard/);
  });
});

describe('the squad configuration and the pipeline fault', () => {
  test('set-config validates, writes the squad file, and records the acting member', () => {
    expect(run(['set-config', '0.0.0.0/0']).err).toMatch(/never 0\.0\.0\.0\/0/);
    expect(run(['set-config', '203.0.113.0/16']).err).toMatch(/REFUSED/);
    const r = run(['set-config', '203.0.113.10/32,198.51.100.0/24'], { WARROOM_ACTOR: 'carol@squad.test' });
    expect(r.out).toMatch(/^CONFIG http_ingress_cidrs = \["203\.0\.113\.10\/32","198\.51\.100\.0\/24"\]/m);
    expect(fs.readFileSync(path.join(opdir, 'squads/alpha/config-history.log'), 'utf8')).toMatch(/carol@squad\.test set 203\.0\.113\.10\/32,198\.51\.100\.0\/24/);
  });

  test('inject-fault commits CHG-1042 to the squad configuration and applies it through the guard (fault mode)', () => {
    const r = run(['inject-fault']);
    expect(r.out).toMatch(/^FAULT ALLOWED fault-alpha-\S+/m);
    expect(fs.readFileSync(path.join(opdir, 'squads/alpha/ingress.tfvars'), 'utf8')).toMatch(/CHG-1042[\s\S]*\["198\.51\.100\.0\/24"\]/);
    expect(fs.readFileSync(path.join(opdir, 'squads/alpha/config-history.log'), 'utf8')).toMatch(/pipeline CHG-1042/);
    expect(r.shim).toMatch(/terraform TF_WORKSPACE=alpha apply/);
  });

  test("the fault is refused if its plan would touch another squad's rules", () => {
    expect(run(['inject-fault'], { FAKE_TAG_SQUAD: 'bravo' }).out).toMatch(/^FAULT REFUSED/m);
  });
});

describe('allow-listed commands only', () => {
  test('unknown evidence, unknown tags and an empty tag are refused', () => {
    expect(run(['evidence', 'cat /etc/passwd']).err).toMatch(/REFUSED: evidence </);
    expect(run(['tag', 'Owner=mallory']).err).toMatch(/REFUSED/);
    expect(run(['tag', 'WarRoomScore=1000']).err).toMatch(/REFUSED/);
    expect(run(['tag']).err).toMatch(/REFUSED/);
    expect(run(['plan', 'everything']).err).toMatch(/plan <baseline\|current\|restore\|destroy>/);
  });
});

describe('instructor fleet tool', () => {
  const FLEET = path.join(__dirname, '../../warroom/inc004/instructor/fleet.sh');
  const fleet = (args, env = {}) => spawnSync('bash', [FLEET, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${shims}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, SHIM_LOG: path.join(opdir, 'fleet.log'), ...env } });
  test('list is read-only: only describe-instances is called', () => {
    const r = fleet(['list']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^SQUAD\s+STATE\s+PHASE\s+SCORE/m);
    const log = fs.readFileSync(path.join(opdir, 'fleet.log'), 'utf8').trim().split('\n');
    expect(log.every((l) => /^aws ec2 describe-instances /.test(l))).toBe(true);
  });
  test('override refuses unknown actions, malformed URLs and a missing token — and has no delete-by-tag path', () => {
    expect(fleet(['override', 'http://cp.example:8080', 'nuke'], { WAR_ROOM_INSTRUCTOR_TOKEN: 't' }).stderr).toMatch(/REFUSED: action/);
    expect(fleet(['override', 'http://cp.example:8080/x;rm', 'pause'], { WAR_ROOM_INSTRUCTOR_TOKEN: 't' }).stderr).toMatch(/REFUSED: override/);
    expect(fleet(['override', 'http://cp.example:8080', 'pause'], { WAR_ROOM_INSTRUCTOR_TOKEN: '' }).stderr).toMatch(/TOKEN is not set/);
    expect(fs.readFileSync(FLEET, 'utf8')).not.toMatch(/terminate-instances|delete-security-group|terraform destroy/);
  });
});
