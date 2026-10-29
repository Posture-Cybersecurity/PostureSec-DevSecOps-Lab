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
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 full$/m);
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
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 already-absent full$/m);
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

describe('prepare-drift (while healthy) and the fast inject path (at the deadline)', () => {
  const TARGET = ['sg-0bbbbbbbbbbbbbbbb', 'sgr-0aaaaaaaaaaaaaaaa', '203.0.113.10/32'];
  const since = (r, prior) => r.shim.slice(prior).trim().split('\n').filter(Boolean);

  test('prepare-drift resolves the state rule, checks it live, prints the target, and changes nothing', () => {
    const prior = deployed().shim.length;
    const r = run(['prepare-drift']);
    expect(r.out).toMatch(/^TARGET sg-0bbbbbbbbbbbbbbbb sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32$/m);
    const calls = since(r, prior);
    expect(calls.some((l) => /terraform .* show -json/.test(l))).toBe(true);
    expect(calls.some((l) => /describe-security-groups --group-ids/.test(l))).toBe(true);
    expect(calls.some((l) => /revoke-security-group-ingress/.test(l))).toBe(false);
  });

  test('prepare-drift refuses when the rule is already gone, or the group is not this squad\'s', () => {
    deployed();
    expect(run(['prepare-drift'], { FAKE_RULE_ABSENT: '1' }).out).toMatch(/^DRIFT REFUSED the squad's rule is not present in AWS/m);
    expect(run(['prepare-drift'], { FAKE_SG_SQUAD: 'bravo' }).out).toMatch(/^DRIFT REFUSED the security group is not tagged WarRoomSquad=alpha/m);
  });

  test('fast path: no Terraform at all; identity + a live read of that one rule, then exactly one revoke', () => {
    const prior = deployed().shim.length;
    const r = run(['inject-drift', ...TARGET]);
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 fast$/m);
    const calls = since(r, prior);
    expect(calls.filter((l) => l.startsWith('terraform'))).toEqual([]);
    expect(calls).toEqual(expect.arrayContaining([
      'aws sts get-caller-identity --output json',
      'aws ec2 describe-security-group-rules --security-group-rule-ids sgr-0aaaaaaaaaaaaaaaa --output json',
    ]));
    expect(calls.filter((l) => /revoke-security-group-ingress/.test(l))).toEqual([
      'aws ec2 revoke-security-group-ingress --group-id sg-0bbbbbbbbbbbbbbbb --security-group-rule-ids sgr-0aaaaaaaaaaaaaaaa',
    ]);
  });

  test('the identity guard still runs on the fast path: another account deletes nothing', () => {
    deployed();
    const r = run(['inject-drift', ...TARGET], { FAKE_ACCOUNT: '999999999999' });
    expect(r.err).toMatch(/REFUSED: caller account \*{8}9999 is not the expected lab account/);
    expect(r.shim).not.toMatch(/revoke-security-group-ingress/);
  });

  test('a prepared target that no longer matches in any way is refused, and nothing is deleted', () => {
    deployed();
    for (const env of [
      { FAKE_RULE_GROUP: 'sg-0ccccccccccccccc' }, { FAKE_RULE_EGRESS: 'true' }, { FAKE_RULE_PORT: '22' },
      { FAKE_RULE_CIDR: '203.0.113.11/32' }, { FAKE_RULE_SQUAD: 'bravo' }, { FAKE_RULE_INCIDENT: 'INC-004' },
    ]) {
      const r = run(['inject-drift', ...TARGET], env);
      expect(r.out).toMatch(/^DRIFT REFUSED the prepared target sgr-0aaaaaaaaaaaaaaaa no longer matches .*nothing deleted$/m);
      expect(r.shim).not.toMatch(/revoke-security-group-ingress/);
    }
  });

  test('a target outside the approved CIDRs, or malformed, is refused before any AWS call', () => {
    const prior = deployed().shim.length;
    const bad = run(['inject-drift', 'sg-0bbbbbbbbbbbbbbbb', 'sgr-0aaaaaaaaaaaaaaaa', '198.18.0.1/32']);
    expect(bad.err).toMatch(/REFUSED: inject-drift: the target CIDR is not one of the squad's approved addresses/);
    expect(since(bad, prior)).toEqual([]);
    expect(run(['inject-drift', 'sg-x', 'sgr-0aaaaaaaaaaaaaaaa', '203.0.113.10/32']).err).toMatch(/REFUSED: inject-drift: malformed target/);
  });

  test('the prepared rule no longer exists: the full path decides (already absent), nothing else is deleted', () => {
    const prior = deployed().shim.length;
    const r = run(['inject-drift', ...TARGET], { FAKE_RULE_ABSENT: '1' });
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 already-absent full$/m);
    expect(since(r, prior).some((l) => /terraform .* show -json/.test(l))).toBe(true);    // re-resolved from state
    expect(r.shim).not.toMatch(/revoke-security-group-ingress/);
  });

  test('AWS API errors are reported as failures, never as a deletion', () => {
    deployed();
    const d = run(['inject-drift', ...TARGET], { FAKE_DESCRIBE_ERROR: '1' });
    expect(d.out).toMatch(/^DRIFT FAILED describe-security-group-rules sgr-0aaaaaaaaaaaaaaaa: .*RequestLimitExceeded/m);
    expect(d.shim).not.toMatch(/revoke-security-group-ingress/);
    const v = run(['inject-drift', ...TARGET], { FAKE_REVOKE_ERROR: '1' });
    expect(v.out).toMatch(/^DRIFT FAILED revoke-security-group-ingress sgr-0aaaaaaaaaaaaaaaa$/m);
    expect(v.out).not.toMatch(/DRIFT DELETED/);
  });

  test('the full path (no target) still works and says so', () => {
    deployed();
    expect(run(['inject-drift']).out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 full$/m);
  });
});

describe('fast path timing marks', () => {
  test('the fast path reports ordered wall-clock marks around the one revoke', () => {
    const r = (() => { deployed(); return run(['inject-drift', 'sg-0bbbbbbbbbbbbbbbb', 'sgr-0aaaaaaaaaaaaaaaa', '203.0.113.10/32']); })();
    const m = r.out.match(/^TIMING script_start=(\d+) checked=(\d+) revoke_start=(\d+) revoke_done=(\d+)$/m);
    expect(m).not.toBeNull();
    const [a, b, c, d] = m.slice(1).map(Number);
    expect(a).toBeGreaterThan(1.7e12);                                        // real epoch milliseconds
    expect(a <= b && b <= c && c <= d).toBe(true);
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 fast$/m);
  });
});

describe('fast path: the revoke CLI starts with the checks, but is gated on them', () => {
  const TARGET = ['sg-0bbbbbbbbbbbbbbbb', 'sgr-0aaaaaaaaaaaaaaaa', '203.0.113.10/32'];
  const STARTED = /^STARTED ec2 revoke, waiting for its group on stdin$/gm;

  test('every refusal or failure kills the started revoke while it waits: no request is ever sent', () => {
    for (const env of [
      { FAKE_ACCOUNT: '999999999999' },             // identity guard (exits via die)
      { FAKE_RULE_PORT: '22' }, { FAKE_RULE_SQUAD: 'bravo' }, { FAKE_RULE_GROUP: 'sg-0ccccccccccccccc' },
      { FAKE_DESCRIBE_ERROR: '1' },                 // AWS read failure
      { FAKE_RULE_ABSENT: '1' },                    // gone: aborted, then the full path decides (already absent)
    ]) {
      const prior = deployed().shim.length;
      const r = run(['inject-drift', ...TARGET], env);
      const mine = r.shim.slice(prior);
      expect([env, (mine.match(STARTED) || []).length]).toEqual([env, 1]);     // it was really started
      expect(mine).not.toMatch(/revoke-security-group-ingress/);
      expect(fs.existsSync(path.join(opdir, 'revoked'))).toBe(false);
      expect(r.out).not.toMatch(/DRIFT DELETED sgr-\S+ \S+ fast/);
    }
  });

  test('a successful fast path sends exactly the validated target, once', () => {
    deployed();
    const r = run(['inject-drift', ...TARGET]);
    expect(r.out).toMatch(/^DRIFT DELETED sgr-0aaaaaaaaaaaaaaaa 203\.0\.113\.10\/32 fast$/m);
    expect(r.shim.match(STARTED)).toHaveLength(1);
    expect(r.shim.match(/^aws ec2 revoke-security-group-ingress .*$/gm)).toEqual([
      'aws ec2 revoke-security-group-ingress --group-id sg-0bbbbbbbbbbbbbbbb --security-group-rule-ids sgr-0aaaaaaaaaaaaaaaa',
    ]);
  });

  test('its start-up overlaps the checks: with a 2 s CLI start-up and a 2 s STS call, the release is immediate', () => {
    deployed();
    const r = run(['inject-drift', ...TARGET], { FAKE_REVOKE_STARTUP: '2', FAKE_STS_SLEEP: '2' });
    const [a, b, c, d] = r.out.match(/^TIMING script_start=(\d+) checked=(\d+) revoke_start=(\d+) revoke_done=(\d+)$/m).slice(1).map(Number);
    expect(b - a).toBeGreaterThanOrEqual(2000);       // the checks really took the slow STS call
    expect(d - c).toBeLessThan(1500);                 // started serially, the revoke alone would take >= 2000 ms here
    expect(r.out).toMatch(/ fast$/m);
  });
});
