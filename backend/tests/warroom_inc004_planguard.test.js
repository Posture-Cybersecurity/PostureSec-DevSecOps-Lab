/**
 * INC-004 plan guard — the protection against touching anything that is not the
 * War Room's EC2 lab. Synthetic plans in the `terraform show -json` shape; each
 * refusal case is a way a real plan could reach beyond the lab.
 */
const { check } = require('../../warroom/inc004/plan-guard');

const TAGS = { tags_all: { WarRoom: 'INC-004', Stack: 'postureblog-ec2' } };
const rc = (address, actions, before = null, after = null, extra = {}) => {
  const m = address.match(/^(module\.lab)\.([a-z0-9_]+)\.([a-z0-9_]+)(?:\["(.+)"\])?$/);
  return {
    address, mode: 'managed', module_address: m ? m[1] : undefined, type: m ? m[2] : address.split('.')[0],
    name: m ? m[3] : address.split('.')[1], ...(m && m[4] ? { index: m[4] } : {}),
    change: { actions, before, after, after_unknown: {} }, ...extra,
  };
};
const rule = (cidr, actions) => rc(`module.lab.aws_vpc_security_group_ingress_rule.http["${cidr}"]`, actions,
  actions.includes('delete') ? { ...TAGS, cidr_ipv4: cidr } : null, actions.includes('create') ? { ...TAGS, cidr_ipv4: cidr } : null);
const plan = (...changes) => ({ resource_changes: changes });
const refused = (p, mode) => check(p, mode).problems;
const USERS = '203.0.113.10/32';
const VPN = '198.51.100.0/24';

describe('create', () => {
  test('allows a create-only plan of tagged resources inside module.lab', () => {
    expect(refused(plan(rc('module.lab.aws_instance.app', ['create'], null, TAGS), rule(USERS, ['create'])), 'create')).toEqual([]);
  });
  test('refuses an update, a replacement, an untagged resource, a foreign type, anything outside module.lab', () => {
    expect(refused(plan(rc('module.lab.aws_instance.app', ['update'], TAGS, TAGS)), 'create')).toHaveLength(1);
    expect(refused(plan(rc('module.lab.aws_instance.app', ['delete', 'create'], TAGS, TAGS)), 'create')).toHaveLength(1);
    expect(refused(plan(rc('module.lab.aws_instance.app', ['create'], null, { tags_all: { Stack: 'x' } })), 'create')[0]).toMatch(/missing tag/);
    expect(refused(plan(rc('module.lab.aws_db_instance.prod', ['create'], null, TAGS)), 'create')[0]).toMatch(/not part of the EC2 lab stack/);
    expect(refused(plan(rc('aws_instance.app', ['create'], null, TAGS)), 'create')[0]).toMatch(/outside module\.lab/);
    expect(refused(plan(rc('module.other.aws_instance.app', ['create'], null, TAGS)), 'create').some((p) => /outside module\.lab/.test(p))).toBe(true);
  });
});

describe('fault', () => {
  test("allows exactly: create the VPN rule, destroy the users' rule", () => {
    expect(refused(plan(rule(VPN, ['create']), rule(USERS, ['delete'])), 'fault')).toEqual([]);
  });
  test('refuses touching the instance, the wrong CIDR, keeping the users, or removing the VPN rule', () => {
    expect(refused(plan(rule(VPN, ['create']), rule(USERS, ['delete']), rc('module.lab.aws_instance.app', ['delete', 'create'], TAGS, TAGS)), 'fault')
      .some((p) => /only port-80 ingress rules/.test(p))).toBe(true);
    expect(refused(plan(rule('0.0.0.0/0', ['create']), rule(USERS, ['delete'])), 'fault')[0]).toMatch(/exactly the 198\.51\.100\.0\/24 rule/);
    expect(refused(plan(rule(VPN, ['create'])), 'fault')[0]).toMatch(/remove the users/);
    expect(refused(plan(rule(VPN, ['create']), rule(VPN, ['delete'])), 'fault').some((p) => /must not remove/.test(p))).toBe(true);
    expect(refused(plan(rc('module.lab.aws_security_group.app', ['update'], TAGS, TAGS)), 'fault').length).toBeGreaterThan(0);
  });
});

describe('recover', () => {
  test("allows exactly one new port-80 rule for the users' address", () => {
    expect(refused(plan(rule(USERS, ['create'])), 'recover')).toEqual([]);
  });
  test('refuses re-adding only the VPN, destroying anything, or changing anything else as well', () => {
    expect(refused(plan(rule(VPN, ['create'])), 'recover')[0]).toMatch(/users' address/);
    expect(refused(plan(rule(USERS, ['create']), rule(VPN, ['delete'])), 'recover')[0]).toMatch(/may only create port-80 rules/);
    expect(refused(plan(rule(USERS, ['create']), rc('module.lab.aws_instance.app', ['update'], TAGS, TAGS)), 'recover')[0]).toMatch(/may only create port-80 rules/);
  });
  test("allows restoring several of the squad's addresses at once", () => {
    expect(refused(plan(rule(USERS, ['create']), rule('203.0.113.20/32', ['create'])), 'recover')).toEqual([]);
  });
});

describe('reset (back to the baseline for the next class)', () => {
  test('allows exactly the removal of the VPN-range rule', () => {
    expect(refused(plan(rule(VPN, ['delete'])), 'reset')).toEqual([]);
  });
  test("refuses removing the users' rule, removing more, or creating anything", () => {
    expect(refused(plan(rule(USERS, ['delete'])), 'reset')).toHaveLength(1);
    expect(refused(plan(rule(VPN, ['delete']), rule(USERS, ['delete'])), 'reset')).toHaveLength(1);
    expect(refused(plan(rule(VPN, ['delete']), rule(USERS, ['create'])), 'reset')).toHaveLength(1);
  });
});

describe('squad ownership (cross-squad isolation)', () => {
  const ALPHA = { tags_all: { WarRoom: 'INC-004', WarRoomSquad: 'alpha' } };
  const BRAVO = { tags_all: { WarRoom: 'INC-004', WarRoomSquad: 'bravo' } };
  test("a squad's guard allows its own resources", () => {
    expect(check(plan(rc('module.lab.aws_instance.app', ['create'], null, ALPHA)), 'create', 'alpha').problems).toEqual([]);
    expect(check(plan(rc('module.lab.aws_instance.app', ['delete'], ALPHA, null)), 'destroy', 'alpha').problems).toEqual([]);
  });
  test("refuses creating, changing or destroying another squad's resources", () => {
    expect(check(plan(rc('module.lab.aws_instance.app', ['create'], null, BRAVO)), 'create', 'alpha').problems[0]).toMatch(/belongs to squad "bravo", not "alpha"/);
    expect(check(plan(rc('module.lab.aws_instance.app', ['delete'], BRAVO, null)), 'destroy', 'alpha').problems[0]).toMatch(/belongs to squad "bravo"/);
    const r = rc(`module.lab.aws_vpc_security_group_ingress_rule.http["${VPN}"]`, ['create'], null, { ...BRAVO, cidr_ipv4: VPN });
    expect(check(plan(r, rc(`module.lab.aws_vpc_security_group_ingress_rule.http["${USERS}"]`, ['delete'], { ...BRAVO, cidr_ipv4: USERS }, null)), 'fault', 'alpha')
      .problems.some((p) => /belongs to squad "bravo"/.test(p))).toBe(true);
  });
  test('a resource with no squad tag is refused when a squad is named', () => {
    expect(check(plan(rc('module.lab.aws_instance.app', ['delete'], TAGS, null)), 'destroy', 'alpha').problems[0]).toMatch(/<none>/);
  });
});

describe('noop and destroy', () => {
  test('noop passes only when nothing would change', () => {
    expect(refused(plan(rule(USERS, ['no-op'])), 'noop')).toEqual([]);
    expect(refused(plan(rule(USERS, ['delete'])), 'noop')).toHaveLength(1);
  });
  test('destroy allows deleting tagged lab resources only', () => {
    expect(refused(plan(rc('module.lab.aws_instance.app', ['delete'], TAGS, null), rc('module.lab.aws_iam_role_policy_attachment.ssm', ['delete'], { role: 'x' }, null)), 'destroy')).toEqual([]);
    expect(refused(plan(rc('module.lab.aws_instance.app', ['delete'], { tags_all: { Owner: 'someone-else' } }, null)), 'destroy')[0]).toMatch(/not tagged/);
    expect(refused(plan(rc('module.lab.aws_instance.app', ['create'], null, TAGS)), 'destroy')).toHaveLength(1);
    expect(refused(plan(), 'destroy')[0]).toMatch(/empty/);
  });
});
