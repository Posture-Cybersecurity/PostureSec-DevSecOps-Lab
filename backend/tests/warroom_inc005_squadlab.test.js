/**
 * squad-lab.sh in the INC-005 drift scenario — the REAL script under real bash, with fake `aws`,
 * `terraform` and `curl` first on PATH (fixtures/inc005/shims; jq and node are real). Nothing
 * reaches AWS. Pinned: the desired configuration is written once and hash-checked; the restore
 * plan goes through the drift guard; inject-drift deletes exactly the state's rule after checking
 * its ownership and shape, through the AWS API, never through Terraform.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../../warroom/inc004/squad/squad-lab.sh');
const FIXTURES = path.join(__dirname, 'fixtures/inc005');
const ACCT = '111111111111';

let shims;
let opdir;
beforeAll(() => {
  shims = fs.mkdtempSync(path.join(os.tmpdir(), 'inc005-shims-'));
  for (const n of ['aws', 'terraform', 'curl']) {
    fs.writeFileSync(path.join(shims, n), fs.readFileSync(path.join(FIXTURES, 'shims', n), 'utf8').replace(/\r/g, ''), { mode: 0o755 });
  }
});
beforeEach(() => { opdir = fs.mkdtempSync(path.join(os.tmpdir(), 'inc005-op-')); });
afterAll(() => { fs.rmSync(shims, { recursive: true, force: true }); });

function run(args, env = {}) {
  const log = path.join(opdir, 'shim.log');
  const sep = process.platform === 'win32' ? ';' : ':';
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${shims}${sep}${process.env.PATH}`, SHIM_LOG: log, WARROOM_OPERATOR_DIR: opdir,
      FIXTURES, REVOKED: path.join(opdir, 'revoked'),
      WARROOM_SCENARIO: 'drift', WARROOM_SQUAD_ID: 'alpha', WARROOM_SQUAD_CIDRS: '203.0.113.10/32', WARROOM_EXPECTED_ACCOUNT_ID: ACCT,
      FAKE_ACCOUNT: ACCT, FAKE_ARN: `arn:aws:iam::${ACCT}:root`, WARROOM_ALLOW_ROOT_FOR_LAB: `dedicated-lab-${ACCT}`, AWS_PROFILE: 'postureblog-lab',
      ...env,
    },
  });
  const shim = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { code: r.status, out: r.stdout, err: r.stderr, shim };
}
const desired = () => path.join(opdir, 'squads/alpha/desired.tfvars');
const deployed = () => run(['plan', 'baseline']);

describe('the desired configuration: written once at deploy, pinned, never changed', () => {
  test('the baseline writes the squad addresses and the pinned AMI, records its hash, and plans through the guard as INC-005', () => {
    const r = deployed();
    expect(r.out).toMatch(/^PLAN baseline-alpha-\S+ ALLOWED/m);
    expect(fs.readFileSync(desired(), 'utf8')).toMatch(/http_ingress_cidrs = \["203\.0\.113\.10\/32"\]\s+ami_id = "ami-0123456789abcdef0"/);
    expect(fs.existsSync(`${desired()}.sha256`)).toBe(true);
    expect(r.shim).toMatch(/aws ssm get-parameter --name \/aws\/service\/canonical\/ubuntu\/server\/24\.04\/stable\/current/);
    expect(r.shim).toMatch(/terraform TF_WORKSPACE=alpha INC=INC-005 plan .*-var-file=.*squads[\\/]alpha[\\/]desired\.tfvars/);
    expect(fs.readFileSync(path.join(opdir, 'squads/alpha/plans', fs.readdirSync(path.join(opdir, 'squads/alpha/plans')).find((f) => f.endsWith('.txt'))), 'utf8'))
      .toMatch(/plan-guard \[create squad=alpha INC-005\]/);
  });

  test('a baseline whose resources are not tagged INC-005 is refused', () => {
    expect(run(['plan', 'baseline'], { FAKE_TAG: 'INC-004' }).out).toMatch(/^PLAN baseline-alpha-\S+ REFUSED .*missing tag WarRoom=INC-005/m);
  });

  test('plan restore goes through the drift guard and is ALLOWED for exactly the one rule', () => {
    deployed();
    const r = run(['plan', 'restore'], { FAKE_STATE_COUNT: '7' });
    expect(r.out).toMatch(/^PLAN restore-alpha-\S+ ALLOWED Plan: 1 to add, 0 to change, 0 to destroy\./m);
    const name = r.out.match(/^PLAN (\S+)/m)[1];
    expect(fs.readFileSync(path.join(opdir, 'squads/alpha/plans', `${name}.txt`), 'utf8')).toMatch(/plan-guard \[drift squad=alpha INC-005\]: .*\{"create":1\}/);
    expect(run(['apply', name]).out).toMatch(new RegExp(`^APPLIED ${name}`, 'm'));
  });

  test("a restore plan for another squad's rule is REFUSED", () => {
    deployed();
    expect(run(['plan', 'restore'], { FAKE_TAG_SQUAD: 'bravo' }).out).toMatch(/^PLAN restore-alpha-\S+ REFUSED .*belongs to squad "bravo", not "alpha"/m);
  });

  test('a changed desired configuration is refused before Terraform runs', () => {
    deployed();
    fs.appendFileSync(desired(), 'http_ingress_cidrs = ["0.0.0.0/0"]\n');
    const r = run(['plan', 'restore']);
    expect(r.err).toMatch(/REFUSED: the desired configuration changed since deployment/);
    expect(r.shim.split('\n').filter((l) => / plan /.test(l) && l.startsWith('terraform'))).toHaveLength(1);   // only the baseline's
    expect(run(['inject-drift']).err).toMatch(/REFUSED: the desired configuration changed/);
  });

  test('the drift scenario refuses INC-004 commands and out-of-band tags', () => {
    deployed();
    expect(run(['set-config', '203.0.113.10/32']).err).toMatch(/REFUSED: set-config is not part of the drift scenario/);
    expect(run(['inject-fault']).err).toMatch(/REFUSED: inject-fault belongs to INC-004/);
    expect(run(['tag', 'WarRoomPhase=armed']).err).toMatch(/REFUSED: tag: the drift scenario never tags/);
    expect(run(['plan', 'current']).err).toMatch(/REFUSED: plan current belongs to INC-004/);
    expect(run(['plan', 'restore'], { WARROOM_SCENARIO: 'inc004' }).err).toMatch(/REFUSED: plan restore belongs to the drift scenario/);
  });
});

describe('inject-drift: the real Terraform-managed rule, through the AWS API, exactly once', () => {
  test('revokes exactly the rule recorded in state, in the lab\'s own group, and confirms it is gone; Terraform does not change', () => {
    const prior = deployed().shim.length;
    const before = fs.readFileSync(desired(), 'utf8');
    const r = run(['inject-drift']);
    const calls = r.shim.slice(prior).trim().split('\n');
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32$/m);
    expect(calls.filter((l) => /revoke-security-group-ingress/.test(l))).toEqual([
      'aws ec2 revoke-security-group-ingress --group-id sg-0bbbbbbbbbbbbbbbb --security-group-rule-ids sgr-0aaaaaaaaaaaaaaaa',
    ]);
    // Terraform only READ (init, workspace, output, show -json): no plan, apply, import or state edit.
    expect(calls.filter((l) => l.startsWith('terraform') && !/ (init|workspace|output|show -json)( |$)/.test(l))).toEqual([]);
    expect(fs.readFileSync(desired(), 'utf8')).toBe(before);
  });

  test('idempotent: a retry after the rule is already gone deletes nothing more', () => {
    deployed();
    const r = run(['inject-drift'], { FAKE_RULE_ABSENT: '1' });
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 already-absent$/m);
    expect(r.shim).not.toMatch(/revoke-security-group-ingress/);
  });

  test("refused, and nothing revoked, when the group is not this squad's INC-005 lab", () => {
    deployed();
    for (const env of [{ FAKE_SG_SQUAD: 'bravo' }, { FAKE_SG_INCIDENT: 'INC-004' }]) {
      const r = run(['inject-drift'], env);
      expect(r.out).toMatch(/^DRIFT REFUSED the security group is not tagged WarRoomSquad=alpha, WarRoom=INC-005/m);
      expect(r.shim).not.toMatch(/revoke-security-group-ingress/);
    }
  });

  test('refused when the live rule is not the tcp/80 rule for the squad address', () => {
    deployed();
    const r = run(['inject-drift'], { FAKE_RULE_PORT: '22' });
    expect(r.out).toMatch(/^DRIFT REFUSED rule sgr-0aaaaaaaaaaaaaaaa is not the tcp\/80 rule/m);
    expect(r.shim).not.toMatch(/revoke-security-group-ingress/);
  });

  test("refused when no squad rule covers the control plane's own address (the outage would be invisible)", () => {
    deployed();
    const r = run(['inject-drift'], { FAKE_PROBE_IP: '198.18.0.99' });
    expect(r.out).toMatch(/^DRIFT REFUSED no single Terraform-managed squad rule covers/m);
    expect(r.shim).not.toMatch(/revoke-security-group-ingress/);
  });

  test('refused before the lab is deployed (no desired configuration yet)', () => {
    expect(run(['inject-drift']).err).toMatch(/REFUSED: the desired configuration changed since deployment/);
  });
});
