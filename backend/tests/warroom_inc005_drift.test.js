/**
 * INC-004 drift-controller tests. The Terraform engine (tf_exec) is mocked, so
 * these exercise the detect -> guard -> apply -> verify logic without AWS.
 */
jest.mock('../src/warroom/tf_exec');
const tf = require('../src/warroom/tf_exec');
const drift = require('../src/warroom/drift_controller');

const RULE = 'aws_vpc_security_group_ingress_rule.http';
const change = (address, actions) => ({ address, change: { actions } });

beforeEach(() => {
  jest.clearAllMocks();
  tf.plan.mockResolvedValue({ ok: true });
  tf.readPlanBytes.mockReturnValue(Buffer.from('plan'));
  tf.applySavedPlan.mockResolvedValue({ ok: true, code: 0, stdout: 'Apply complete!' });
});

describe('detect()', () => {
  test('reports drift when the HTTP rule needs creating', async () => {
    tf.showPlanJson.mockResolvedValue({ ok: true, json: { resource_changes: [change(RULE, ['create'])] } });
    const d = await drift.detect();
    expect(d.drift_detected).toBe(true);
    expect(d.affected_resource).toBe(RULE);
    expect(d.unrelated_changes).toHaveLength(0);
  });

  test('reports no drift when nothing changes on the target', async () => {
    tf.showPlanJson.mockResolvedValue({ ok: true, json: { resource_changes: [change(RULE, ['no-op'])] } });
    const d = await drift.detect();
    expect(d.drift_detected).toBe(false);
  });

  test('surfaces unrelated drift separately', async () => {
    tf.showPlanJson.mockResolvedValue({ ok: true, json: { resource_changes: [
      change(RULE, ['create']), change('aws_instance.warroom', ['update']),
    ] } });
    const d = await drift.detect();
    expect(d.drift_detected).toBe(true);
    expect(d.unrelated_changes).toEqual([{ address: 'aws_instance.warroom', action: 'update' }]);
  });
});

describe('remediate()', () => {
  test('applies when the guard approves the single create', async () => {
    tf.showPlanJson.mockResolvedValue({ ok: true, json: { resource_changes: [change(RULE, ['create'])] } });
    const r = await drift.remediate();
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(true);
    expect(tf.applySavedPlan).toHaveBeenCalledTimes(1);
  });

  test('refuses to apply when the plan contains an unrelated delete', async () => {
    tf.showPlanJson.mockResolvedValue({ ok: true, json: { resource_changes: [
      change(RULE, ['create']), change('aws_instance.warroom', ['delete']),
    ] } });
    const r = await drift.remediate();
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    expect(tf.applySavedPlan).not.toHaveBeenCalled();
  });
});

describe('verify()', () => {
  test('restored when a fresh plan needs no change on the target', async () => {
    tf.showPlanJson.mockResolvedValue({ ok: true, json: { resource_changes: [] } });
    const v = await drift.verify();
    expect(v.restored).toBe(true);
  });
});
