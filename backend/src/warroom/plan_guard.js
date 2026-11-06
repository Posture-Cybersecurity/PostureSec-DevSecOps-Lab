/**
 * INC-004 Terraform plan guard.
 *
 * A plan is only safe to apply if it does EXACTLY what the exercise expects and
 * nothing else. This guard works on the structured plan JSON
 * (`terraform show -json <planfile>`) — never on scraped human output — and:
 *
 *   * reads every resource_changes[].change.actions,
 *   * rejects any create/update/delete/replace that is not explicitly allowed,
 *   * rejects any resource address that is not in the allow-list,
 *   * requires each allowed change to be present with the expected action,
 *   * binds the verdict to a digest of the exact plan bytes, so a plan that is
 *     modified or swapped after approval cannot be applied (stale-plan guard).
 *
 * It decides nothing about AWS directly; it only reasons about the plan.
 */
const crypto = require('crypto');

// Map a terraform actions array to a single verb we reason about.
function classify(actions) {
  const a = Array.isArray(actions) ? actions : [];
  if (a.length === 2 && a.includes('create') && a.includes('delete')) return 'replace';
  if (a.length === 1) return a[0]; // create | update | delete | no-op | read
  if (a.length === 0) return 'no-op';
  return a.join('+'); // anything unexpected, reported verbatim
}

/**
 * @param {object} planJson  parsed `terraform show -json <plan>` output
 * @param {Array<{address:string, action:string}>} allow  the ONLY changes permitted
 * @returns {{ok:boolean, violations:string[], matched:object[], actions:object[]}}
 */
function guardPlan(planJson, allow) {
  const violations = [];
  if (!planJson || typeof planJson !== 'object') {
    return { ok: false, violations: ['plan JSON missing or unparseable'], matched: [], actions: [] };
  }
  const changes = Array.isArray(planJson.resource_changes) ? planJson.resource_changes : [];
  const allowList = Array.isArray(allow) ? allow : [];

  // Every effecting change in the plan, with its verb.
  const actions = changes
    .map((c) => ({ address: c.address, action: classify(c.change && c.change.actions) }))
    .filter((c) => c.action !== 'no-op' && c.action !== 'read');

  // 1) Nothing outside the allow-list may change.
  for (const c of actions) {
    const permitted = allowList.find((p) => p.address === c.address && p.action === c.action);
    if (!permitted) {
      violations.push(`unexpected ${c.action} on ${c.address}`);
    }
  }

  // 2) Every allowed change must actually be present (no silent substitution).
  const matched = [];
  for (const p of allowList) {
    const hit = actions.find((c) => c.address === p.address && c.action === p.action);
    if (hit) matched.push(p);
    else violations.push(`required ${p.action} on ${p.address} is absent from the plan`);
  }

  // 3) Exactly the allowed changes, no more, no fewer.
  if (actions.length !== allowList.length) {
    violations.push(`plan changes ${actions.length} resource(s); exactly ${allowList.length} allowed`);
  }

  return { ok: violations.length === 0, violations, matched, actions };
}

/** The allow-list for INC-005 remediation: one create of the HTTP ingress rule. */
function remediationPolicy(ruleAddress) {
  return [{ address: ruleAddress, action: 'create' }];
}

/** Digest the exact plan bytes so an approved plan cannot be swapped before apply. */
function planDigest(planFileBuffer) {
  return crypto.createHash('sha256').update(planFileBuffer).digest('hex');
}

module.exports = { guardPlan, remediationPolicy, classify, planDigest };
