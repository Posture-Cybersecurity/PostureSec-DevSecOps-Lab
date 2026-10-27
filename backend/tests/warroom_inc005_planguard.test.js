/**
 * plan-guard.js drift mode (INC-005 restore). The two fixtures are REAL `terraform show -json`
 * output from the 2026-10-27 live rehearsal on AWS (sanitized; see their _source field):
 *   restore-plan.json            the shape a restore after the drift has: one port-80 rule
 *                                created, everything else no-op (the security group's own
 *                                refresh drift shows only in resource_drift, never as an action)
 *   unexpected-update-plan.json  a plan the guard refused live: an instance tag update + a rule
 *                                delete + a rule create
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { check } = require('../../warroom/inc004/plan-guard');

const GUARD = path.join(__dirname, '../../warroom/inc004/plan-guard.js');
const FIX = (n) => path.join(__dirname, 'fixtures/inc005', n);
const load = (n) => JSON.parse(JSON.stringify(require(FIX(n))));
const SQUAD = '203.0.113.10/32';
const opts = { tag: 'INC-005', cidrs: [SQUAD] };
const RULE = (cidr) => `module.lab.aws_vpc_security_group_ingress_rule.http["${cidr}"]`;

const createOf = (plan) => plan.resource_changes.find((rc) => rc.change.actions.join() === 'create');

describe('drift mode on the real restore plan', () => {
  test('exactly one create of the squad\'s own tcp/80 rule, all else no-op: ALLOWED', () => {
    const plan = load('restore-plan.json');
    expect(plan.resource_drift.map((r) => r.address)).toEqual(['module.lab.aws_security_group.app']);   // refresh noise only
    expect(check(plan, 'drift', 'alpha', opts).problems).toEqual([]);
  });

  test('the CLI allows it and reports the changes', () => {
    const r = spawnSync('node', [GUARD, FIX('restore-plan.json'), 'drift', 'alpha', '--tag=INC-005', `--cidrs=${SQUAD}`], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/plan-guard \[drift squad=alpha INC-005\]: .*changes \{"create":1\}/);
    expect(r.stdout).toMatch(/^ALLOWED$/m);
  });

  test('a rule for an address that is not the squad\'s is refused', () => {
    expect(check(load('restore-plan.json'), 'drift', 'alpha', { tag: 'INC-005', cidrs: ['198.18.0.1/32'] }).problems.join())
      .toMatch(/the only change allowed is the squad's own port-80 rule/);
  });

  test("another squad's rule, or another incident's tag, is refused", () => {
    expect(check(load('restore-plan.json'), 'drift', 'bravo', opts).problems.join()).toMatch(/belongs to squad "alpha", not "bravo"/);
    expect(check(load('restore-plan.json'), 'drift', 'alpha', { ...opts, tag: 'INC-004' }).problems.join()).toMatch(/missing tag WarRoom=INC-004/);
  });

  test('the wrong port or protocol is refused', () => {
    const plan = load('restore-plan.json');
    createOf(plan).change.after.from_port = 22;
    createOf(plan).change.after.to_port = 22;
    expect(check(plan, 'drift', 'alpha', opts).problems.join()).toMatch(/must be tcp 80/);
  });
});

describe('drift mode refuses everything else', () => {
  test('the real refused plan (instance update + delete + create) is refused, naming each change', () => {
    const p = check(load('unexpected-update-plan.json'), 'drift', 'alpha', { tag: 'INC-005', cidrs: [SQUAD, '198.51.100.0/24'] }).problems.join();
    expect(p).toMatch(/exactly 1 create and nothing else \(found 3 change\(s\)/);
    expect(p).toMatch(/module\.lab\.aws_instance\.app update/);
    expect(p).toMatch(/delete/);
  });

  test('a replacement (delete+create) of the instance is refused', () => {
    const plan = load('restore-plan.json');
    plan.resource_changes.find((rc) => rc.address === 'module.lab.aws_instance.app').change.actions = ['delete', 'create'];
    expect(check(plan, 'drift', 'alpha', opts).problems.join()).toMatch(/found 2 change\(s\).*aws_instance\.app delete\/create/);
  });

  test('two creates are refused', () => {
    const plan = load('restore-plan.json');
    const extra = JSON.parse(JSON.stringify(createOf(plan)));
    extra.address = RULE('203.0.113.11/32'); extra.index = '203.0.113.11/32'; extra.change.after.cidr_ipv4 = '203.0.113.11/32';
    plan.resource_changes.push(extra);
    expect(check(plan, 'drift', 'alpha', { ...opts, cidrs: [SQUAD, '203.0.113.11/32'] }).problems.join()).toMatch(/found 2 change\(s\)/);
  });

  test('a plan with no changes (nothing to restore) is refused', () => {
    const plan = load('restore-plan.json');
    createOf(plan).change.actions = ['no-op'];
    expect(check(plan, 'drift', 'alpha', opts).problems.join()).toMatch(/found 0 change\(s\): none/);
  });

  test('a resource outside the EC2 lab is refused', () => {
    const plan = load('restore-plan.json');
    plan.resource_changes.push({ address: 'aws_s3_bucket.x', module_address: undefined, mode: 'managed', type: 'aws_s3_bucket', change: { actions: ['no-op'] } });
    expect(check(plan, 'drift', 'alpha', opts).problems.join()).toMatch(/type aws_s3_bucket is not part of the EC2 lab stack/);
  });

  test('the CLI exits 1 on a refusal and 2 on bad usage (drift needs --cidrs; the tag must be a known incident)', () => {
    const run = (args) => spawnSync('node', [GUARD, ...args], { encoding: 'utf8' });
    const refused = run([FIX('unexpected-update-plan.json'), 'drift', 'alpha', '--tag=INC-005', `--cidrs=${SQUAD}`]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/^REFUSED \(\d+\):/m);
    expect(run([FIX('restore-plan.json'), 'drift', 'alpha', '--tag=INC-005']).status).toBe(2);
    expect(run([FIX('restore-plan.json'), 'drift', 'alpha', '--tag=INC-999', `--cidrs=${SQUAD}`]).status).toBe(2);
  });
});

describe('INC-005 baseline/destroy use the INC-005 tag; INC-004 is unchanged by default', () => {
  test('create mode with --tag=INC-005 accepts INC-005-tagged resources and refuses INC-004 ones', () => {
    const plan = load('restore-plan.json');
    expect(check(plan, 'create', 'alpha', { tag: 'INC-005' }).problems).toEqual([]);
    expect(check(plan, 'create', 'alpha').problems.join()).toMatch(/missing tag WarRoom=INC-004/);   // the INC-004 default
  });
});
