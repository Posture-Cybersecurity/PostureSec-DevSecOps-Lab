/**
 * In-memory stand-in for driver-real.js in the INC-005 drift scenario — TESTS ONLY (excluded from
 * the control-plane image; never selected by the backend unless injected explicitly).
 *
 * Each squad's lab models three things separately, which is what drift is about:
 *   config  the desired configuration (never changed by the incident; `intact` = hash unchanged)
 *   state   what Terraform state records: { rules: { cidr: ruleId }, instance }
 *   aws     what AWS really has: rules [{ id, cidr }] (a rule absent from state = a console rule)
 * Plans are computed from the three, and the drift guard's rule is applied to them: a restore is
 * allowed only if it is exactly one create of the squad's own rule.
 * A `gate` lets a test hold observe() open, to prove long checks do not hold the squad lock.
 */
const { maskWith } = require('./driver-real');
const yieldNow = () => new Promise((r) => setImmediate(r));

function createFakeAccount() {
  const labs = {};
  return {
    labs,
    lab: (squad, cidrs) => (labs[squad] = labs[squad] || {
      squad, config: { cidrs: [...cidrs], intact: true }, state: null, aws: { rules: [], instance: null },
      extraDrift: null, tf: { running: 0, max: 0, total: 0 }, seq: 0,
    }),
  };
}

function createFakeDriftDriver({ account = createFakeAccount(), squad, squadCidrs, probeCidr = squadCidrs[0], clock, bootSeconds = 300 }) {
  const L = account.lab(squad, squadCidrs);
  const d = { kind: 'fake', calls: [], plans: {}, account, lab: L, mask: maskWith(squadCidrs), gate: null, failInject: 0 };
  const call = (n, a) => d.calls.push(a === undefined ? n : `${n}:${a}`);
  const id = (p) => `${p}-${squad}-${(++L.seq).toString(16).padStart(4, '0')}`;
  const ruleId = () => `sgr-${(++L.seq).toString(16).padStart(8, '0')}`;

  async function terraform(fn) {
    const t = L.tf;
    t.running += 1; t.total += 1; t.max = Math.max(t.max, t.running);
    try { await yieldNow(); await yieldNow(); return fn(); } finally { t.running -= 1; }
  }

  // What a fresh plan of the desired configuration would do.
  function changes() {
    if (!L.state) return { creates: [], other: [] };
    const live = new Set(L.aws.rules.map((r) => r.id));
    const creates = L.config.cidrs.filter((c) => !L.state.rules[c] || !live.has(L.state.rules[c]));
    const other = [];
    if (L.aws.instance && L.aws.instance.id !== L.state.instance) other.push('module.lab.aws_instance.app update');
    if (L.extraDrift) other.push(L.extraDrift);
    return { creates, other };
  }
  const save = (kind, allowed, summary, effect) => {
    const name = id(kind);
    d.plans[name] = { allowed, summary, effect };
    return { name, allowed, summary };
  };

  d.plan = (kind) => terraform(() => {
    call('plan', kind);
    if (kind === 'baseline') {
      if (L.state) return save(kind, false, 'already deployed', null);
      return save(kind, true, 'Plan: 7 to add, 0 to change, 0 to destroy.', () => {
        const inst = { id: `i-${squad}-${++L.seq}`, created: clock() };
        L.aws.instance = inst;
        L.aws.rules = L.config.cidrs.map((c) => ({ id: ruleId(), cidr: c }));
        L.state = { instance: inst.id, rules: Object.fromEntries(L.aws.rules.map((r) => [r.cidr, r.id])) };
      });
    }
    if (kind === 'destroy') {
      if (!L.state) return save(kind, false, 'nothing to destroy', null);
      return save(kind, true, 'Plan: 0 to add, 0 to change, 7 to destroy.', () => { L.state = null; L.aws = { rules: [], instance: null }; });
    }
    if (kind !== 'restore') throw new Error(`fake: unknown plan kind ${kind}`);
    if (!L.config.intact) throw new Error('REFUSED: the desired configuration changed since deployment; refusing to plan');
    const { creates, other } = changes();
    const all = [...creates.map((c) => `http["${c}"] create`), ...other];
    if (all.length !== 1 || !creates.length || !squadCidrs.includes(creates[0])) {
      return save(kind, false, d.mask(`restore must be exactly 1 create and nothing else (found ${all.length} change(s): ${all.join(', ') || 'none'})`), null);
    }
    return save(kind, true, 'Plan: 1 to add, 0 to change, 0 to destroy.', () => {
      const cidr = creates[0];
      if (L.aws.rules.some((r) => r.cidr === cidr)) throw new Error(`InvalidPermission.Duplicate: the specified rule "peer: ${d.mask(cidr)}, TCP, from port: 80" already exists`);
      const r = { id: ruleId(), cidr };
      L.aws.rules.push(r);
      L.state.rules[cidr] = r.id;
    });
  });

  d.showPlan = async (name) => { call('showPlan', name); return `plan ${name}: ${d.plans[name] ? d.plans[name].summary : '(applied)'}`; };

  d.apply = (name) => terraform(() => {
    call('apply', name);
    const p = d.plans[name];
    if (!p || !p.allowed) throw new Error(`refusing to apply ${name}: not an allowed saved plan`);
    delete d.plans[name];
    p.effect();
  });

  // The console hotfix: the state's rule for the probe's address is deleted in AWS, state untouched.
  d.injectDrift = async () => {
    call('injectDrift');
    await yieldNow();
    if (d.failInject > 0) { d.failInject -= 1; return { deleted: false, summary: 'FAILED: revoke-security-group-ingress (simulated AWS error)' }; }
    if (!L.state) return { deleted: false, summary: 'REFUSED: no deployed lab in this squad\'s state' };
    const target = L.state.rules[probeCidr];
    if (!target) return { deleted: false, summary: 'REFUSED: no single Terraform-managed squad rule covers the control plane\'s address' };
    const before = L.aws.rules.length;
    L.aws.rules = L.aws.rules.filter((r) => r.id !== target);
    return { deleted: true, ruleId: target, cidr: probeCidr, already: before === L.aws.rules.length };
  };

  d.observe = async () => {
    call('observe');
    if (d.gate) await d.gate;
    await yieldNow();
    const inst = L.aws.instance;
    const booted = Boolean(inst && clock() - inst.created >= bootSeconds * 1000);
    const managedIds = new Set(L.state ? Object.values(L.state.rules) : []);
    const rules = L.aws.rules.map((r) => ({ cidr: r.cidr, managed: managedIds.has(r.id) }));
    const { creates, other } = changes();
    return {
      instance: inst ? { id: inst.id, state: 'running', system: booted ? 'ok' : 'initializing', instance: booted ? 'ok' : 'initializing' } : null,
      ssm_online: booted,
      app_health_inside: booted,
      http_from_squad: booted && L.aws.rules.some((r) => r.cidr === probeCidr || r.cidr === '0.0.0.0/0') ? 200 : 0,
      squad_cidrs: [...squadCidrs],
      probe_cidr: probeCidr,
      rules,
      plan_noop: Boolean(L.state) && !creates.length && !other.length,
      config_intact: L.config.intact,
      console_rules: rules.some((r) => !r.managed),
      world_open: rules.some((r) => r.cidr === '0.0.0.0/0'),
    };
  };

  d.evidence = async (eid) => { call('evidence', eid); return d.mask(`[${eid}] ${JSON.stringify(await d.observe())}`); };
  d.remaining = async () => { call('remaining'); return [...(L.aws.instance ? ['instance'] : []), ...L.aws.rules.map((r) => `rule ${r.id}`)]; };

  // What someone might do by hand, outside the platform.
  d.byHand = {
    consoleAddRule: (cidr) => { L.aws.rules.push({ id: ruleId(), cidr }); },
    replaceInstance: () => { L.aws.instance = { id: `i-${squad}-${++L.seq}`, created: clock() - bootSeconds * 1000 }; },
    driftSomethingElse: (what) => { L.extraDrift = what; },
    tamperConfig: () => { L.config.intact = false; },
  };
  return d;
}

module.exports = { createFakeAccount, createFakeDriftDriver };
