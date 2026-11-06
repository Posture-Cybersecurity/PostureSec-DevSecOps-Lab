/**
 * INC-005 AWS SG module tests. The EC2 client is mocked (aws-sdk-client-mock),
 * so no real AWS calls are made. Proves the module validates the dedicated SG
 * before mutating and only ever touches tcp/80 on that one group.
 */
process.env.WARROOM_SG_ID = 'sg-abc123';
process.env.WARROOM_AWS_ACCOUNT = '637551066935';
process.env.WARROOM_AWS_REGION = 'us-east-1';
process.env.WARROOM_SG_HTTP_CIDR = '0.0.0.0/0';

const { mockClient } = require('aws-sdk-client-mock');
const {
  EC2Client, DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand,
} = require('@aws-sdk/client-ec2');
const awsSg = require('../src/warroom/aws_sg');

const ec2 = mockClient(EC2Client);

const HTTP_PERM = { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0' }] };
const sg = (overrides = {}) => ({
  GroupId: 'sg-abc123',
  OwnerId: '637551066935',
  Tags: [{ Key: 'warroom:incident', Value: 'INC-005' }],
  IpPermissions: [],
  ...overrides,
});

beforeEach(() => ec2.reset());

describe('describeDedicated validation', () => {
  test('returns the SG when id, account and tag match', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg()] });
    await expect(awsSg.describeDedicated()).resolves.toMatchObject({ GroupId: 'sg-abc123' });
  });

  test('rejects a wrong account owner', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ OwnerId: '000000000000' })] });
    await expect(awsSg.describeDedicated()).rejects.toThrow(/account/);
  });

  test('rejects a missing identity tag', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ Tags: [] })] });
    await expect(awsSg.describeDedicated()).rejects.toThrow(/identity tag/);
  });

  test('rejects when the SG does not exist', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [] });
    await expect(awsSg.describeDedicated()).rejects.toThrow(/not found/);
  });
});

describe('revoke / authorize are scoped and idempotent', () => {
  test('revoke removes tcp/80 when present', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ IpPermissions: [HTTP_PERM] })] });
    ec2.on(RevokeSecurityGroupIngressCommand).resolves({});
    const r = await awsSg.revokeHttpIngress();
    expect(r).toMatchObject({ changed: true, state: 'revoked', sgId: 'sg-abc123' });
    const call = ec2.commandCalls(RevokeSecurityGroupIngressCommand)[0].args[0].input;
    expect(call.GroupId).toBe('sg-abc123');
    expect(call.IpPermissions[0]).toMatchObject({ IpProtocol: 'tcp', FromPort: 80, ToPort: 80 });
  });

  test('revoke sends NO description in the Ip range (so AWS matches the 4-tuple)', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ IpPermissions: [HTTP_PERM] })] });
    ec2.on(RevokeSecurityGroupIngressCommand).resolves({ Return: true });
    await awsSg.revokeHttpIngress();
    const perm = ec2.commandCalls(RevokeSecurityGroupIngressCommand)[0].args[0].input.IpPermissions[0];
    expect(perm.IpRanges[0]).toEqual({ CidrIp: '0.0.0.0/0' }); // no Description key
  });

  test('revoke throws when AWS reports the rule as unmatched', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ IpPermissions: [HTTP_PERM] })] });
    ec2.on(RevokeSecurityGroupIngressCommand).resolves({ Return: true, UnknownIpPermissions: [HTTP_PERM] });
    await expect(awsSg.revokeHttpIngress()).rejects.toThrow(/did not match/);
  });

  test('revoke is a no-op when tcp/80 is already absent', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ IpPermissions: [] })] });
    const r = await awsSg.revokeHttpIngress();
    expect(r).toMatchObject({ changed: false, state: 'already-absent' });
    expect(ec2.commandCalls(RevokeSecurityGroupIngressCommand)).toHaveLength(0);
  });

  test('authorize adds tcp/80 when missing', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ IpPermissions: [] })] });
    ec2.on(AuthorizeSecurityGroupIngressCommand).resolves({});
    const r = await awsSg.authorizeHttpIngress();
    expect(r).toMatchObject({ changed: true, state: 'authorized' });
    expect(ec2.commandCalls(AuthorizeSecurityGroupIngressCommand)[0].args[0].input.GroupId).toBe('sg-abc123');
  });

  test('authorize is a no-op when tcp/80 already present', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ IpPermissions: [HTTP_PERM] })] });
    const r = await awsSg.authorizeHttpIngress();
    expect(r).toMatchObject({ changed: false, state: 'already-present' });
    expect(ec2.commandCalls(AuthorizeSecurityGroupIngressCommand)).toHaveLength(0);
  });
});

describe('verifyHttpIngressState', () => {
  test('reports open/closed accurately', async () => {
    ec2.on(DescribeSecurityGroupsCommand).resolves({ SecurityGroups: [sg({ IpPermissions: [HTTP_PERM] })] });
    await expect(awsSg.verifyHttpIngressState()).resolves.toEqual({ sgId: 'sg-abc123', http_open: true });
  });
});
