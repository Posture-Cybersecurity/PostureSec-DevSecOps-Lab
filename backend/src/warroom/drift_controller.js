/**
 * INC-004 drift controller.
 *
 * Ties the Terraform engine (tf_exec) to the plan guard (plan_guard) to drive
 * the student remediation workflow:
 *
 *   detect()      -> is the expected infrastructure baseline drifted? which
 *                    resource? why? what is the remediation?
 *   remediate()   -> generate a plan, run it through the guard, bind it by
 *                    digest. Apply ONLY if the guard passes.
 *   verify()      -> confirm the baseline is restored (plan is a clean no-op on
 *                    the drift target).
 *
 * The expected baseline is "the dedicated HTTP ingress rule exists". Drift is a
 * plan that wants to CREATE exactly that rule (it is missing in reality). The
 * controller distinguishes this intended drift from unrelated infrastructure
 * changes: anything beyond the one bound rule address is reported as
 * out-of-scope and will make the guard reject the plan.
 */
const config = require('./config');
const tf = require('./tf_exec');
const guard = require('./plan_guard');

const log = (stage, data) => console.log(`[warroom][inc004] ${stage}: ${JSON.stringify(data)}`);

const RULE = () => config.inc005.ruleAddress;

/** Run a fresh plan and classify the change on the drift target + any others. */
async function planAndClassify() {
  const planRes = await tf.plan();
  // `terraform plan -out` exits 0 whether or not there are changes; a non-zero
  // exit is a real error (bad creds, bad config), surfaced honestly.
  if (!planRes.ok) return { ok: false, error: planRes.stderr || planRes.stdout };
  const shown = await tf.showPlanJson();
  if (!shown.ok) return { ok: false, error: shown.error };

  const changes = (shown.json.resource_changes || [])
    .map((c) => ({ address: c.address, action: guard.classify(c.change && c.change.actions) }))
    .filter((c) => c.action !== 'no-op' && c.action !== 'read');

  const target = changes.find((c) => c.address === RULE());
  const others = changes.filter((c) => c.address !== RULE());
  return { ok: true, json: shown.json, changes, target, others };
}

async function detect() {
  const p = await planAndClassify();
  if (!p.ok) return { ok: false, error: p.error };

  const drifted = Boolean(p.target && p.target.action === 'create');
  const result = {
    ok: true,
    drift_detected: drifted,
    affected_resource: drifted ? RULE() : null,
    explanation: drifted
      ? 'The dedicated public HTTP (TCP/80) ingress rule is absent from the live security '
        + 'group but present in the Terraform configuration. Public access is unavailable until '
        + 'the rule is recreated.'
      : 'Live infrastructure matches the expected baseline for the drift target.',
    remediation: drifted
      ? `Generate a plan and apply the single guarded create of ${RULE()}.`
      : null,
    unrelated_changes: p.others, // out-of-scope drift the guard will refuse
  };
  log('detect', { drift: drifted, unrelated: p.others.length });
  return result;
}

/**
 * Generate + guard a remediation plan. Returns the guard verdict and, if it
 * passes, the digest that binds the approved plan. Applies nothing.
 */
async function remediate() {
  const p = await planAndClassify();
  if (!p.ok) return { ok: false, error: p.error };

  const verdict = guard.guardPlan(p.json, guard.remediationPolicy(RULE()));
  const digest = guard.planDigest(tf.readPlanBytes());
  log('guard', { ok: verdict.ok, violations: verdict.violations, digest });

  if (!verdict.ok) {
    return { ok: false, guard: verdict, applied: false, reason: 'plan rejected by guard' };
  }

  // The plan is approved. Bind the exact bytes and apply them; a plan whose
  // bytes changed since approval would be re-guarded on the next call, never
  // silently applied.
  const before = tf.readPlanBytes();
  const applyRes = await tf.applySavedPlan();
  const after = guard.planDigest(before);
  if (after !== digest) {
    return { ok: false, applied: false, reason: 'plan changed after approval (stale plan)' };
  }
  log('apply', { ok: applyRes.ok, code: applyRes.code });
  return { ok: applyRes.ok, guard: verdict, digest, applied: applyRes.ok, output: applyRes.stdout.slice(-400), error: applyRes.ok ? null : (applyRes.stderr || applyRes.stdout) };
}

async function verify() {
  const p = await planAndClassify();
  if (!p.ok) return { ok: false, error: p.error };
  const restored = !p.target; // no create needed on the target => rule exists again
  log('verify', { restored });
  return {
    ok: true,
    restored,
    explanation: restored
      ? 'The expected baseline is restored: a fresh plan requires no change to the drift target.'
      : 'The drift target still requires a change; baseline not yet restored.',
  };
}

module.exports = { detect, remediate, verify, planAndClassify };
