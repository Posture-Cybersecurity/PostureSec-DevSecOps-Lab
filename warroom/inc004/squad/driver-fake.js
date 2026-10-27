/**
 * In-memory stand-in for driver-real.js — TESTS ONLY. Never selected by the War Room
 * backend in normal operation (it must be injected explicitly).
 *
 * A fake ACCOUNT holds several squads' labs; a fake DRIVER is bound to exactly one squad and
 * can only ever touch that squad's lab, as the real one is (names, tags, state, plan guard).
 * Each lab models, separately:
 *   config   the squad's Terraform configuration (squad.auto.tfvars)
 *   state    what Terraform state records
 *   aws      what AWS actually has (rules may exist that state does not know: console rules)
 * plus an instance healthy `bootSeconds` after creation, and the guard's decisions.
 * Every operation yields to the event loop first, so concurrent callers really interleave.
 */
const VPN = '198.51.100.0/24';
const yieldNow = () => new Promise((r) => setImmediate(r));

function createFakeAccount() {
  const labs = {};
  return {
    labs,
    lab: (squad, cidrs) => (labs[squad] = labs[squad] || {
      squad, config: [...cidrs], state: null, aws: { rules: [], instance: null, tags: {} },
      tf: { running: 0, max: 0, total: 0 },          // Terraform runs against THIS squad's state
    }),
    snapshot: (squad) => JSON.stringify(labs[squad] || null),
  };
}

function createFakeDriver({ account = createFakeAccount(), squad, squadCidrs, probeCidr = squadCidrs[0], clock, bootSeconds = 300 }) {
  const L = account.lab(squad, squadCidrs);
  const d = { calls: [], plans: {}, seq: 0, account, lab: L };
  const call = (n, a) => d.calls.push(a === undefined ? n : `${n}:${a}`);
  const now = () => clock();

  async function terraform(fn) {      // counts concurrent Terraform runs against this squad's state
    const t = L.tf;
    t.running += 1; t.total += 1; t.max = Math.max(t.max, t.running);
    try { await yieldNow(); await yieldNow(); return fn(); } finally { t.running -= 1; }
  }

  const diff = () => {
    const st = L.state ? L.state.cidrs : [];
    return { create: L.config.filter((c) => !st.includes(c)), destroy: st.filter((c) => !L.config.includes(c)) };
  };
  const save = (kind, allowed, summary, effect) => {
    const name = `${kind}-${squad}-${++d.seq}`;
    d.plans[name] = { allowed, summary, effect };
    return { name, allowed, summary };
  };

  d.plan = (kind) => terraform(() => {
    call('plan', kind);
    if (kind === 'baseline') {
      if (L.state) return save(kind, false, 'already deployed', null);
      return save(kind, true, '7 to add, 0 to change, 0 to destroy', () => {
        L.state = { cidrs: [...L.config], instance: `i-${squad}-1` };
        L.aws.rules = L.config.map((c) => ({ cidr: c, managed: true }));
        L.aws.instance = { id: `i-${squad}-1`, created: now() };
      });
    }
    if (kind === 'destroy') {
      if (!L.state) return save(kind, false, 'nothing to destroy', null);
      return save(kind, true, '0 to add, 0 to change, 7 to destroy (all tagged WarRoomSquad=' + squad + ')', () => {
        L.state = null; L.aws.rules = []; L.aws.instance = null;      // the SG goes, console rules with it
      });
    }
    const { create, destroy } = diff();                                // kind === 'current' (guard: recover)
    if (!create.length && !destroy.length) return save(kind, false, 'No changes. (nothing to recover)', null);
    if (!create.length || destroy.length || create.includes(VPN)) {
      return save(kind, false, `REFUSED by plan-guard [recover squad=${squad}]: +${create.join(',')} -${destroy.join(',')}`, null);
    }
    return save(kind, true, `${create.length} to add, 0 to change, 0 to destroy`, () => {
      const dup = create.find((c) => L.aws.rules.some((r) => r.cidr === c));
      if (dup) throw new Error(`InvalidPermission.Duplicate: the specified rule "${dup} TCP 80" already exists`);
      L.state.cidrs.push(...create);
      L.aws.rules.push(...create.map((c) => ({ cidr: c, managed: true })));
    });
  });

  d.showPlan = async (name) => { call('showPlan', name); return `plan ${name}: ${d.plans[name] ? d.plans[name].summary : '(applied)'}`; };

  d.apply = (name) => terraform(() => {
    call('apply', name);
    const p = d.plans[name];
    if (!p || !p.allowed) throw new Error(`refusing to apply ${name}: not an allowed saved plan`);
    delete d.plans[name];                                              // a saved plan applies once
    p.effect();
  });

  d.writeConfig = async (cidrs) => { call('writeConfig', cidrs.join(',')); L.config = [...cidrs]; };

  // The squad's "pipeline" commits CHG-1042 into the configuration and applies it (guard: fault).
  d.injectFault = () => terraform(() => {
    call('injectFault');
    if (!L.state || !squadCidrs.some((c) => L.state.cidrs.includes(c))) return { allowed: false, summary: 'REFUSED by plan-guard [fault]: the users\' rules are not present' };
    L.config = [VPN];
    L.state.cidrs = [VPN];
    L.aws.rules = L.aws.rules.filter((r) => !r.managed).concat([{ cidr: VPN, managed: true }]);
    return { allowed: true, summary: '1 to add, 0 to change, ' + squadCidrs.length + ' to destroy' };
  });

  d.observe = async () => {
    call('observe');
    await yieldNow();
    const inst = L.aws.instance;
    const booted = Boolean(inst && now() - inst.created >= bootSeconds * 1000);
    const reachable = booted && L.aws.rules.some((r) => r.cidr === probeCidr || r.cidr === '0.0.0.0/0');
    const { create, destroy } = diff();
    return {
      instance: inst ? { id: inst.id, state: 'running', system: booted ? 'ok' : 'initializing', instance: booted ? 'ok' : 'initializing' } : null,
      ssm_online: booted,
      app_health_inside: booted,
      http_from_squad: reachable ? 200 : 0,
      squad_cidrs: [...squadCidrs],
      probe_cidr: probeCidr,
      rules: L.aws.rules.map((r) => ({ ...r })),
      plan_noop: Boolean(L.state) && !create.length && !destroy.length,
      console_rules: L.aws.rules.some((r) => !r.managed),
      world_open: L.aws.rules.some((r) => r.cidr === '0.0.0.0/0'),
    };
  };

  d.evidence = async (id) => { call('evidence', id); return `[${id}] ${JSON.stringify(await d.observe())}`; };
  d.tag = async (tags) => { call('tag', Object.keys(tags).join('+')); Object.assign(L.aws.tags, tags); };
  d.remaining = async () => { call('remaining'); return [...(L.aws.instance ? ['instance'] : []), ...L.aws.rules.map((r) => `rule ${r.cidr}`)]; };

  // ---- what a squad MEMBER may do by hand, outside the platform (the tempting shortcuts) ----
  d.byHand = {
    consoleAddRule: (cidr) => { L.aws.rules.push({ cidr, managed: false }); },
    consoleRemoveUnmanaged: () => { L.aws.rules = L.aws.rules.filter((r) => r.managed); },
    replaceInstance: () => { L.aws.instance = { id: `i-${squad}-${++d.seq}`, created: now() }; L.state.instance = L.aws.instance.id; },
  };
  return d;
}

module.exports = { createFakeAccount, createFakeDriver, VPN };
