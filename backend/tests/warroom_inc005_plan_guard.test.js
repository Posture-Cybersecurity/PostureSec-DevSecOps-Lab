/**
 * INC-004 plan-guard unit tests. Pure logic over plan JSON — no AWS, no terraform.
 * Proves the guard admits ONLY the one intended create and rejects everything else.
 */
const guard = require('../src/warroom/plan_guard');

const RULE = 'aws_vpc_security_group_ingress_rule.http';
const policy = guard.remediationPolicy(RULE);

const change = (address, actions) => ({ address, change: { actions } });
const plan = (...changes) => ({ resource_changes: changes });

describe('plan_guard.classify', () => {
  test('maps action arrays to verbs', () => {
    expect(guard.classify(['create'])).toBe('create');
    expect(guard.classify(['delete'])).toBe('delete');
    expect(guard.classify(['update'])).toBe('update');
    expect(guard.classify(['no-op'])).toBe('no-op');
    expect(guard.classify(['create', 'delete'])).toBe('replace');
    expect(guard.classify([])).toBe('no-op');
  });
});

describe('plan_guard.guardPlan — INC-005 remediation', () => {
  test('ACCEPTS exactly one create of the HTTP rule (no-ops ignored)', () => {
    const p = plan(
      change(RULE, ['create']),
      change('aws_security_group.warroom', ['no-op']),
      change('aws_instance.warroom', ['no-op']),
    );
    const v = guard.guardPlan(p, policy);
    expect(v.ok).toBe(true);
    expect(v.violations).toHaveLength(0);
    expect(v.matched).toEqual(policy);
  });

  test('REJECTS a delete of unrelated infrastructure', () => {
    const v = guard.guardPlan(plan(
      change(RULE, ['create']),
      change('aws_instance.warroom', ['delete']),
    ), policy);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toMatch(/unexpected delete on aws_instance.warroom/);
  });

  test('REJECTS an extra create on a different address', () => {
    const v = guard.guardPlan(plan(
      change(RULE, ['create']),
      change('aws_vpc_security_group_ingress_rule.ssh', ['create']),
    ), policy);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toMatch(/ssh/);
  });

  test('REJECTS a plan missing the required create', () => {
    const v = guard.guardPlan(plan(
      change('aws_security_group.warroom', ['update']),
    ), policy);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toMatch(/required create on .*http is absent/);
  });

  test('REJECTS a replace of the rule (not a plain create)', () => {
    const v = guard.guardPlan(plan(change(RULE, ['create', 'delete'])), policy);
    expect(v.ok).toBe(false);
    expect(v.violations.join(' ')).toMatch(/unexpected replace/);
  });

  test('REJECTS an update to the security group itself', () => {
    const v = guard.guardPlan(plan(
      change(RULE, ['create']),
      change('aws_security_group.warroom', ['update']),
    ), policy);
    expect(v.ok).toBe(false);
  });

  test('REJECTS unparseable plan', () => {
    expect(guard.guardPlan(null, policy).ok).toBe(false);
  });
});

describe('plan_guard.planDigest', () => {
  test('is stable for identical bytes and differs otherwise', () => {
    const a = guard.planDigest(Buffer.from('plan-bytes'));
    const b = guard.planDigest(Buffer.from('plan-bytes'));
    const c = guard.planDigest(Buffer.from('plan-bytez'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
