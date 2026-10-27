/**
 * The squad IAM policy (warroom/inc004/iam/squad-policy.json) — offline checks only. It has NOT
 * been created in AWS or evaluated by IAM: that is step 2 (iam simulate-custom-policy, read-only)
 * and step 4 (a real run as a squad identity). What is pinned here: least privilege by
 * construction, squad scoping through the principal tag, and coverage of every AWS CLI call the
 * squad script makes.
 */
const fs = require('fs');
const path = require('path');

const POLICY = require('../../warroom/inc004/iam/squad-policy.json');
const SCRIPT = fs.readFileSync(path.join(__dirname, '../../warroom/inc004/squad/squad-lab.sh'), 'utf8');
const SQUAD = '${aws:PrincipalTag/WarRoomSquad}';
const allows = POLICY.Statement.filter((s) => s.Effect === 'Allow');
const actions = (s) => [].concat(s.Action || []);
const allowed = (action) => allows.some((s) => actions(s).some((a) => a === action || (a.endsWith('*') && action.startsWith(a.slice(0, -1)))));
const scopedToSquad = (s) => JSON.stringify(s.Condition || {}).includes(SQUAD) || [].concat(s.Resource).some((r) => r.includes(SQUAD));

test('it fits in a customer-managed policy (6144 characters)', () => {
  expect(JSON.stringify(POLICY).length).toBeLessThan(6144);
});

test('no Allow grants a whole service or everything', () => {
  for (const s of allows) {
    for (const a of actions(s)) {
      expect(a).not.toBe('*');
      expect(a).not.toMatch(/^[a-z0-9-]+:\*$/);
    }
  }
});

test('no IAM write, no user/key/policy creation, no role creation; PassRole only for the squad role, only to EC2', () => {
  for (const a of ['iam:CreateRole', 'iam:AttachRolePolicy', 'iam:PutRolePolicy', 'iam:UpdateAssumeRolePolicy', 'iam:CreateUser',
    'iam:CreateAccessKey', 'iam:CreatePolicy', 'iam:CreateInstanceProfile', 'iam:AddRoleToInstanceProfile', 'sts:AssumeRole']) {
    expect(allowed(a)).toBe(false);
  }
  const pass = allows.find((s) => actions(s).includes('iam:PassRole'));
  expect(pass.Resource).toBe(`arn:aws:iam::*:role/postureblog-ec2-warroom-${SQUAD}-ssm`);
  expect(pass.Condition).toEqual({ StringEquals: { 'iam:PassedToService': 'ec2.amazonaws.com' } });
  const deny = POLICY.Statement.find((s) => s.Sid === 'DenyEverythingElseIncludingIamWrites');
  expect(deny.Effect).toBe('Deny');
  expect(deny.NotAction).not.toContain('iam:*');
});

test('every mutating EC2 permission is scoped to the squad (except the documented create-time exceptions)', () => {
  const EXCEPTIONS = new Set(['LaunchUsingImageSubnetAndNetworkInterface', 'CreateSecurityGroupInTheVpc', 'TagOnlyWhileCreating']);
  for (const s of allows) {
    const mutating = actions(s).filter((a) => a.startsWith('ec2:') && !/^ec2:(Describe|Get)/.test(a));
    if (!mutating.length || EXCEPTIONS.has(s.Sid)) continue;
    expect({ sid: s.Sid, scoped: scopedToSquad(s) }).toEqual({ sid: s.Sid, scoped: true });
  }
  // The exceptions carry no squad resource: an image, subnet, ENI, the VPC, or tags at creation time only.
  expect(allows.find((s) => s.Sid === 'TagOnlyWhileCreating').Condition.StringEquals['ec2:CreateAction']).toEqual(
    ['RunInstances', 'CreateSecurityGroup', 'AuthorizeSecurityGroupIngress', 'AuthorizeSecurityGroupEgress']);
});

test('instances must be t3.small, tagged for the squad and the War Room; SSM only on the squad\'s own instance', () => {
  const run = allows.find((s) => s.Sid === 'LaunchOnlyOwnSquadT3SmallInstanceAndVolume');
  expect(run.Condition.StringEqualsIfExists['ec2:InstanceType']).toBe('t3.small');
  expect(run.Condition.StringEquals).toEqual({ 'aws:RequestTag/WarRoomSquad': SQUAD, 'aws:RequestTag/WarRoom': 'INC-004' });
  const ssm = allows.find((s) => s.Sid === 'RunCommandsOnOwnSquadInstanceOnly');
  expect(ssm.Condition.StringEquals['ssm:resourceTag/WarRoomSquad']).toBe(SQUAD);
  const tags = allows.find((s) => s.Sid === 'ProgressTagsOnOwnSquadInstanceOnly');
  expect(tags.Condition['ForAllValues:StringEquals']['aws:TagKeys']).toEqual(['WarRoomPhase', 'WarRoomScore']);
});

test('everything outside us-east-1 is denied', () => {
  const d = POLICY.Statement.find((s) => s.Sid === 'NeverOutsideUsEast1');
  expect(d).toMatchObject({ Effect: 'Deny', Condition: { StringNotEquals: { 'aws:RequestedRegion': 'us-east-1' } } });
});

test('coverage: every AWS CLI call in squad-lab.sh is permitted by the policy', () => {
  const calls = [...SCRIPT.matchAll(/\baws (sts|ec2|ssm|cloudtrail|resourcegroupstaggingapi) ([a-z-]+)/g)].map((m) => [m[1], m[2]]);
  expect(calls.length).toBeGreaterThan(8);
  const toIam = ([svc, cmd]) => `${svc === 'resourcegroupstaggingapi' ? 'tag' : svc}:${cmd.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`;
  const missing = [...new Set(calls.map(toIam))].filter((a) => !allowed(a));
  expect(missing).toEqual([]);
});
