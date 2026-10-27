#!/usr/bin/env node
/**
 * INC-004 plan guard: refuse any Terraform plan that does more than the named
 * operation is allowed to do to the War Room's EC2 lab. Reads the output of
 * `terraform show -json <plan>`.
 *
 *   node plan-guard.js <plan.json> <mode> [squad] [--tag=INC-00N] [--cidrs=a.b.c.d/32,...]
 *     create   first apply: only creates, only the EC2 stack's types, all tagged INC-004
 *     fault    only port-80 rules change: create exactly the VPN range rule, destroy the users' rule(s)
 *     recover  only port-80 rules are created (the squad's addresses, never the VPN range); nothing destroyed or changed
 *     reset    back to the baseline for the next class: only the VPN-range rule is destroyed
 *     noop     no changes at all (drift check)
 *     destroy  only deletes, only the EC2 stack's types, every taggable one tagged INC-004
 *     drift    INC-005 restore after console drift: EXACTLY one create — the squad's own port-80
 *              rule (one of --cidrs, tcp 80) — and nothing else changed, replaced or destroyed
 *
 * --tag sets the WarRoom tag value checked (default INC-004); --cidrs is the squad's approved list.
 *
 * Every resource must live in module.lab (the class's deploy/aws-ec2 stack). With [squad], every
 * created or destroyed taggable resource must also carry WarRoomSquad=<squad>: one squad can never
 * apply to, or destroy, another squad's lab.
 * Exit 0 = allowed; 1 = refused (reasons printed); 2 = usage error.
 */
const fs = require('fs');

const MODULE = 'module.lab';
const RULE = 'module.lab.aws_vpc_security_group_ingress_rule.http';
const VPN = '198.51.100.0/24';
const ALLOWED_TYPES = new Set([
  'aws_security_group', 'aws_vpc_security_group_ingress_rule', 'aws_vpc_security_group_egress_rule',
  'aws_iam_role', 'aws_iam_role_policy_attachment', 'aws_iam_instance_profile', 'aws_instance',
]);
const TAG = { key: 'WarRoom', value: 'INC-004' };
const MODES = ['create', 'fault', 'recover', 'reset', 'noop', 'destroy', 'drift'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRule = (rc) => rc.address.startsWith(`${RULE}[`);

function tagged(values, tag) {
  const tags = values && (values.tags_all || values.tags);
  return Boolean(tags && tags[TAG.key] === tag);
}

function check(plan, mode, squad, { tag = TAG.value, cidrs = [] } = {}) {
  const problems = [];
  const changes = (plan.resource_changes || []).filter((rc) => rc.mode === 'managed');
  const acting = changes.filter((rc) => !same(rc.change.actions, ['no-op']));
  const creates = acting.filter((rc) => same(rc.change.actions, ['create']));
  const deletes = acting.filter((rc) => same(rc.change.actions, ['delete']));

  for (const rc of changes) {
    if (!ALLOWED_TYPES.has(rc.type)) problems.push(`${rc.address}: type ${rc.type} is not part of the EC2 lab stack`);
    if (rc.module_address !== MODULE) problems.push(`${rc.address}: outside ${MODULE}`);
  }

  if (mode === 'noop' && acting.length) problems.push(`expected no changes, found ${acting.length}`);

  if (squad) {
    for (const rc of acting) {
      const v = rc.change.after || rc.change.before || {};
      const tags = v.tags_all || v.tags;
      if (tags && tags.WarRoomSquad !== squad) problems.push(`${rc.address}: belongs to squad "${tags.WarRoomSquad || '<none>'}", not "${squad}"`);
    }
  }

  if (mode === 'create') {
    for (const rc of acting) {
      if (!same(rc.change.actions, ['create'])) problems.push(`${rc.address}: ${rc.change.actions.join('/')} (create-only plan)`);
      const after = rc.change.after || {};
      if (('tags_all' in after || 'tags' in after) && !tagged(after, tag)) problems.push(`${rc.address}: missing tag ${TAG.key}=${tag}`);
    }
  }

  if (mode === 'fault') {
    for (const rc of acting) {
      if (!isRule(rc)) problems.push(`${rc.address}: only port-80 ingress rules may change in the fault`);
      if (!same(rc.change.actions, ['create']) && !same(rc.change.actions, ['delete'])) problems.push(`${rc.address}: ${rc.change.actions.join('/')}`);
    }
    if (creates.length !== 1 || creates[0].index !== VPN) problems.push(`the fault must create exactly the ${VPN} rule`);
    if (deletes.length < 1) problems.push("the fault must remove the users' rule");
    if (deletes.some((rc) => rc.index === VPN)) problems.push(`the fault must not remove the ${VPN} rule`);
  }

  if (mode === 'recover') {
    if (!creates.length || creates.length !== acting.length || !creates.every(isRule)) {
      problems.push(`recovery may only create port-80 rules and change nothing else (found ${acting.length} change(s), ${creates.length} rule create(s))`);
    }
    if (creates.some((rc) => rc.index === VPN)) problems.push(`recovery must add the users' addresses, not ${VPN}`);
  }

  if (mode === 'reset') {
    if (acting.length !== 1 || deletes.length !== 1 || !isRule(deletes[0]) || deletes[0].index !== VPN) {
      problems.push(`reset must destroy exactly the ${VPN} rule and change nothing else (found ${acting.length} change(s))`);
    }
  }

  if (mode === 'destroy') {
    if (!acting.length) problems.push('destroy plan is empty');
    for (const rc of acting) {
      if (!same(rc.change.actions, ['delete'])) problems.push(`${rc.address}: ${rc.change.actions.join('/')} (delete-only plan)`);
      const before = rc.change.before || {};
      if (('tags_all' in before || 'tags' in before) && !tagged(before, tag)) problems.push(`${rc.address}: not tagged ${TAG.key}=${tag}; refusing to delete it`);
    }
  }

  if (mode === 'drift') {
    // The desired configuration did not change; AWS did. Restoring it is one create, nothing else.
    const rc = creates[0];
    const after = (rc && rc.change.after) || {};
    if (acting.length !== 1 || creates.length !== 1) {
      problems.push(`restore must be exactly 1 create and nothing else (found ${acting.length} change(s): ${acting.map((c) => `${c.address} ${c.change.actions.join('/')}`).join(', ') || 'none'})`);
    } else if (!isRule(rc) || !cidrs.includes(rc.index)) {
      problems.push(`${rc.address}: the only change allowed is the squad's own port-80 rule`);
    } else if (after.ip_protocol !== 'tcp' || after.from_port !== 80 || after.to_port !== 80 || after.cidr_ipv4 !== rc.index) {
      problems.push(`${rc.address}: must be tcp 80 from ${rc.index}`);
    } else if (!tagged(after, tag)) {
      problems.push(`${rc.address}: missing tag ${TAG.key}=${tag}`);
    }
  }

  const counts = {};
  for (const rc of acting) { const k = rc.change.actions.join('/'); counts[k] = (counts[k] || 0) + 1; }
  return { problems, counts, total: changes.length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (k) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : undefined; };
  const [file, mode, squad] = args.filter((x) => !x.startsWith('--'));
  const tag = flag('tag') || TAG.value;
  const cidrs = (flag('cidrs') || '').split(',').filter(Boolean);
  if (!file || !MODES.includes(mode)) {
    console.error(`usage: node plan-guard.js <plan.json> <${MODES.join('|')}> [squad] [--tag=INC-00N] [--cidrs=...]`);
    process.exit(2);
  }
  let plan;
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    console.error(`cannot read plan JSON: ${err.message}`);
    process.exit(2);
  }
  if (squad !== undefined && !/^[a-z0-9][a-z0-9-]{1,14}$/.test(squad)) {
    console.error('squad must be 2-15 lowercase letters, digits, hyphens');
    process.exit(2);
  }
  if (!/^INC-00[45]$/.test(tag)) { console.error('--tag must be INC-004 or INC-005'); process.exit(2); }
  if (mode === 'drift' && !cidrs.length) { console.error("drift mode needs --cidrs (the squad's approved addresses)"); process.exit(2); }
  const { problems, counts, total } = check(plan, mode, squad, { tag, cidrs });
  console.log(`plan-guard [${mode}${squad ? ` squad=${squad}` : ''} ${tag}]: ${total} managed resources; changes ${JSON.stringify(counts)}`);
  if (problems.length) {
    console.error(`REFUSED (${problems.length}):\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('ALLOWED');
}

module.exports = { check, ALLOWED_TYPES };
