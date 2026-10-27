/**
 * driver-real.js — how the control plane calls squad-lab.sh and reads its answers.
 * The exec is injected (recorded outputs), so NOTHING here reaches AWS. What is pinned:
 * the exact argv (no shell), the environment (squad, addresses, profile NAME, actor; no raw
 * credentials), strict parsing, and failing closed on refusals or anything unrecognised.
 */
const { createRealDriver, DriverError, SCRIPT } = require('../../warroom/inc004/squad/driver-real');

const OBS = {
  instance: { id: 'i-0abc', state: 'running', system: 'ok', instance: 'ok' }, ssm_online: true, app_health_inside: true,
  http_from_squad: 0, squad_cidrs: ['203.0.113.10/32'], probe_cidr: '203.0.113.10/32',
  rules: [{ cidr: '198.51.100.0/24', managed: true }], plan_noop: true, console_rules: false, world_open: false,
};

function recorder(replies) {
  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, env: opts.env, timeout: opts.timeout });
    const r = replies[args[1]] || { stdout: '' };
    return { code: r.code || 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
  return { exec, calls };
}

const make = (replies, extra = {}) => {
  const rec = recorder(replies);
  const d = createRealDriver({ squad: 'alpha', squadCidrs: ['203.0.113.10/32', '203.0.113.20/32'], accountId: '111111111111', profile: 'warroom-squad-alpha', exec: rec.exec, ...extra });
  return { d, calls: rec.calls };
};

describe('driver-real: invocation', () => {
  test('runs squad-lab.sh with an argument array (no shell) and only the squad context in the environment', async () => {
    process.env.AWS_SECRET_ACCESS_KEY = 'must-not-pass-through';
    const { d, calls } = make({ 'set-config': { stdout: 'CONFIG http_ingress_cidrs = ["203.0.113.10/32"]\n' } });
    await d.writeConfig(['203.0.113.10/32', '198.51.100.0/24'], 'carol@squad.test');
    delete process.env.AWS_SECRET_ACCESS_KEY;
    const c = calls[0];
    expect(c.file).toBe('bash');
    expect(c.args).toEqual([SCRIPT, 'set-config', '203.0.113.10/32,198.51.100.0/24']);
    expect(c.env).toMatchObject({ WARROOM_SQUAD_ID: 'alpha', WARROOM_SQUAD_CIDRS: '203.0.113.10/32,203.0.113.20/32',
      WARROOM_EXPECTED_ACCOUNT_ID: '111111111111', AWS_PROFILE: 'warroom-squad-alpha', WARROOM_ACTOR: 'carol@squad.test' });
    expect(c.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  test('the root authorization is passed only when configured, and bound to the account', async () => {
    const off = make({ evidence: { stdout: 'x' } });
    process.env.WARROOM_ALLOW_ROOT_FOR_LAB = 'dedicated-lab-111111111111';     // never inherited from the host
    await off.d.evidence('sg_rules');
    delete process.env.WARROOM_ALLOW_ROOT_FOR_LAB;
    expect(off.calls[0].env.WARROOM_ALLOW_ROOT_FOR_LAB).toBeUndefined();
    const on = make({ evidence: { stdout: 'x' } }, { allowRoot: true });
    await on.d.evidence('sg_rules');
    expect(on.calls[0].env.WARROOM_ALLOW_ROOT_FOR_LAB).toBe('dedicated-lab-111111111111');
  });

  test('member input that looks like shell stays one inert argument', async () => {
    const { d, calls } = make({ evidence: { stdout: 'x' } });
    await d.evidence('sg_rules; rm -rf / $(id)');
    expect(calls[0].args).toEqual([SCRIPT, 'evidence', 'sg_rules; rm -rf / $(id)']);
  });

  test('construction refuses a bad squad, account, address list or a profile that is not a plain name', () => {
    const base = { squad: 'alpha', squadCidrs: ['203.0.113.10/32'], accountId: '111111111111', profile: 'p' };
    expect(() => createRealDriver({ ...base, squad: 'Alpha!' })).toThrow();
    expect(() => createRealDriver({ ...base, accountId: '12' })).toThrow();
    expect(() => createRealDriver({ ...base, squadCidrs: [] })).toThrow();
    expect(() => createRealDriver({ ...base, profile: 'not a name: key=value' })).toThrow();
  });

  test('long operations get long timeouts; reads get short ones', async () => {
    const { d, calls } = make({ plan: { stdout: 'PLAN current-alpha-1 ALLOWED Plan: 1 to add\n' }, observe: { stdout: JSON.stringify(OBS) } });
    await d.plan('current');
    await d.observe();
    expect(calls[0].timeout).toBe(15 * 60e3);
    expect(calls[1].timeout).toBe(3 * 60e3);
  });
});

describe('driver-real: parsing and failing closed', () => {
  test('plan: ALLOWED, REFUSED and ERROR lines', async () => {
    const ok = make({ plan: { stdout: 'noise\nPLAN current-alpha-20261027T1Z ALLOWED Plan: 2 to add, 0 to change, 0 to destroy.\n' } });
    expect(await ok.d.plan('current')).toEqual({ name: 'current-alpha-20261027T1Z', allowed: true, summary: 'Plan: 2 to add, 0 to change, 0 to destroy.' });
    const no = make({ plan: { stdout: 'PLAN current-alpha-2 REFUSED module.lab.aws_instance.app: only port-80 rules\n' } });
    expect((await no.d.plan('current')).allowed).toBe(false);
    const err = make({ plan: { stdout: 'PLAN current-alpha-3 ERROR Error: Invalid value for variable\n' } });
    expect(await err.d.plan('current')).toMatchObject({ allowed: false, summary: 'Error: Invalid value for variable' });
    await expect(make({ plan: { stdout: 'nothing useful' } }).d.plan('current')).rejects.toBeInstanceOf(DriverError);
  });

  test('a REFUSED: line from the script (e.g. root identity) is always an error', async () => {
    const { d } = make({ plan: { code: 1, stderr: 'REFUSED: the root user is never a squad identity: use the squad\'s least-privilege profile\n' } });
    await expect(d.plan('baseline')).rejects.toThrow(/root user is never a squad identity/);
  });

  test('apply succeeds only on APPLIED for the same plan; a failed apply surfaces the AWS error', async () => {
    expect(await make({ apply: { stdout: 'APPLIED current-alpha-1 Apply complete! Resources: 2 added, 0 changed, 0 destroyed.\n' } }).d.apply('current-alpha-1'))
      .toMatch(/2 added/);
    await expect(make({ apply: { code: 3, stdout: 'APPLY current-alpha-1 FAILED Error: InvalidPermission.Duplicate: the specified rule already exists\n' } }).d.apply('current-alpha-1'))
      .rejects.toThrow(/InvalidPermission\.Duplicate/);
    await expect(make({ apply: { stdout: 'APPLIED current-alpha-9 ok\n' } }).d.apply('current-alpha-1')).rejects.toBeInstanceOf(DriverError);
  });

  test('inject-fault: ALLOWED / REFUSED', async () => {
    expect(await make({ 'inject-fault': { stdout: 'FAULT ALLOWED fault-alpha-1\n' } }).d.injectFault()).toEqual({ allowed: true, summary: 'fault-alpha-1' });
    expect((await make({ 'inject-fault': { stdout: 'FAULT REFUSED the users\' rules are not present\n' } }).d.injectFault()).allowed).toBe(false);
    await expect(make({ 'inject-fault': { stdout: '' } }).d.injectFault()).rejects.toBeInstanceOf(DriverError);
  });

  test('observe: the JSON contract, the not-yet-deployed case, and malformed output', async () => {
    expect(await make({ observe: { stdout: `starting\n${JSON.stringify(OBS)}\n` } }).d.observe()).toEqual(OBS);
    expect((await make({ observe: { stdout: '{"instance":null}' } }).d.observe())).toMatchObject({ instance: null, http_from_squad: 0, plan_noop: false });
    await expect(make({ observe: { stdout: '{"instance":{"id":"i"},"ssm_online":"yes"}' } }).d.observe()).rejects.toThrow(/ssm_online/);
    await expect(make({ observe: { stdout: 'not json' } }).d.observe()).rejects.toBeInstanceOf(DriverError);
  });

  test('tag and remaining', async () => {
    const t = make({ tag: { stdout: 'TAGGED WarRoomPhase=completed WarRoomScore=100\n' } });
    await t.d.tag({ WarRoomPhase: 'completed', WarRoomScore: '100' });
    expect(t.calls[0].args).toEqual([SCRIPT, 'tag', 'WarRoomPhase=completed', 'WarRoomScore=100']);
    expect(await make({ remaining: { stdout: '[]' } }).d.remaining()).toEqual([]);
    expect(await make({ remaining: { stdout: '["instance i-0abc"]' } }).d.remaining()).toEqual(['instance i-0abc']);
    await expect(make({ remaining: { stdout: '{"x":1}' } }).d.remaining()).rejects.toBeInstanceOf(DriverError);
  });
});

describe('driver-real: INC-005 drift scenario', () => {
  const drift = (replies) => make(replies, { scenario: 'drift' });

  test('the scenario is passed to the script; anything else is refused', async () => {
    const { d, calls } = drift({ 'inject-drift': { stdout: 'DRIFT DELETED sgr-0aaa 203.0.113.10/32\n' } });
    await d.injectDrift();
    expect(calls[0].args).toEqual([SCRIPT, 'inject-drift']);
    expect(calls[0].env.WARROOM_SCENARIO).toBe('drift');
    expect(() => make({}, { scenario: 'chaos' })).toThrow(/scenario/);
    const { d: d4, calls: c4 } = make({ preflight: { stdout: 'x' } });
    await d4.evidence('sg_rules').catch(() => {});
    expect(c4[0].env.WARROOM_SCENARIO).toBe('inc004');
  });

  test('injectDrift parses deleted / already-absent / refused / failed, and fails closed on anything else', async () => {
    expect(await drift({ 'inject-drift': { stdout: 'DRIFT DELETED sgr-0aaa 203.0.113.10/32\n' } }).d.injectDrift())
      .toEqual({ deleted: true, ruleId: 'sgr-0aaa', cidr: '203.0.113.10/32', already: false });
    expect(await drift({ 'inject-drift': { stdout: 'DRIFT DELETED sgr-0aaa 203.0.113.10/32 already-absent\n' } }).d.injectDrift())
      .toMatchObject({ deleted: true, already: true });
    const refused = await drift({ 'inject-drift': { stdout: 'DRIFT REFUSED rule sgr-0aaa is not the tcp/80 rule for 203.0.113.10/32\n' } }).d.injectDrift();
    expect(refused).toEqual({ deleted: false, summary: 'REFUSED: rule sgr-0aaa is not the tcp/80 rule for <squad-network-1>' });
    expect((await drift({ 'inject-drift': { stdout: 'DRIFT FAILED revoke-security-group-ingress sgr-0aaa\n' } }).d.injectDrift()).deleted).toBe(false);
    await expect(drift({ 'inject-drift': { stdout: 'something else\n' } }).d.injectDrift()).rejects.toBeInstanceOf(DriverError);
    await expect(drift({ 'inject-drift': { stderr: 'REFUSED: the desired configuration changed since deployment\n', code: 1 } }).d.injectDrift()).rejects.toThrow(/refused: the desired configuration changed/);
  });

  test('evidence, plan text and summaries never show an address or an account id', async () => {
    const { d } = drift({
      evidence: { stdout: 'sgr-1\ttcp\t80\t203.0.113.20/32\nurl http://192.0.2.55/api/health account 123456789012\n' },
      'show-plan': { stdout: '# module.lab.aws_vpc_security_group_ingress_rule.http["203.0.113.10/32"] will be created\n' },
      plan: { stdout: 'PLAN restore-alpha-1 REFUSED http["198.18.0.1/32"]: the only change allowed is the squad\'s own port-80 rule\n' },
    });
    const ev = await d.evidence('sg_rules');
    expect(ev).toMatch(/<squad-network-2>/);
    expect(ev).toMatch(/http:\/\/<ip>\/api\/health account \*{8}9012/);
    expect(await d.showPlan('restore-alpha-1')).toMatch(/http\["<squad-network-1>"\] will be created/);
    expect((await d.plan('restore')).summary).toMatch(/http\["<ip>"\]/);
    for (const s of [ev, await d.showPlan('restore-alpha-1')]) expect(s).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});
