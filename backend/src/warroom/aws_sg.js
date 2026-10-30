/**
 * INC-005 AWS security-group control (AWS SDK v3, @aws-sdk/client-ec2).
 *
 * The ONLY infrastructure mutation in the exercise: revoke / re-authorise the
 * one public TCP/80 ingress rule on the ONE dedicated lab security group.
 *
 * Hard safety rules baked in here (not in the caller):
 *   * Operates only on config.inc005.sgId — never an id, port, protocol or CIDR
 *     supplied by a request. The frontend cannot choose a target.
 *   * Before any mutation it re-validates the target: the SG exists, is in the
 *     expected account, and carries the expected identity tag.
 *   * Mutations are exactly tcp/<httpPort>/<httpCidr>; nothing else is touched.
 *   * Credentials come from the default chain (EC2 instance profile / temporary
 *     credentials). No static keys are read or accepted here.
 */
const { EC2Client, DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand } = require('@aws-sdk/client-ec2');
const config = require('./config');

const C = () => config.inc005;

// One client, region-pinned, default credential chain (no explicit credentials).
let _client = null;
function client() {
  if (!_client) _client = new EC2Client({ region: C().region });
  return _client;
}
// Test seam only.
function _setClient(c) { _client = c; }

// No Description here: AWS matches a revoke on the protocol/port/CIDR 4-tuple,
// and a Description in the request makes the rule come back UNMATCHED (in
// UnknownIpPermissions) instead of being revoked. Keep it to the 4-tuple so
// revoke and authorize both match the terraform-created rule exactly.
function httpPermission() {
  return {
    IpProtocol: 'tcp',
    FromPort: C().httpPort,
    ToPort: C().httpPort,
    IpRanges: [{ CidrIp: C().httpCidr }],
  };
}

/** Describe the dedicated SG and assert it is the right one. Throws on mismatch. */
async function describeDedicated() {
  if (!C().sgId) throw new Error('WARROOM_SG_ID is not configured; refusing to operate');
  const out = await client().send(new DescribeSecurityGroupsCommand({ GroupIds: [C().sgId] }));
  const sg = (out.SecurityGroups || [])[0];
  if (!sg) throw new Error(`dedicated security group ${C().sgId} not found`);

  if (C().account && sg.OwnerId && sg.OwnerId !== C().account) {
    throw new Error(`security group owner ${sg.OwnerId} != expected account ${C().account}`);
  }
  const tags = Object.fromEntries((sg.Tags || []).map((t) => [t.Key, t.Value]));
  if (C().requireTagKey && tags[C().requireTagKey] !== C().requireTagValue) {
    throw new Error(`security group ${C().sgId} missing identity tag `
      + `${C().requireTagKey}=${C().requireTagValue}`);
  }
  return sg;
}

/** Is the public HTTP ingress rule present on the dedicated SG? */
function hasHttpIngress(sg) {
  return (sg.IpPermissions || []).some((p) =>
    p.IpProtocol === 'tcp' && p.FromPort === C().httpPort && p.ToPort === C().httpPort
    && (p.IpRanges || []).some((r) => r.CidrIp === C().httpCidr));
}

/** Revoke the public TCP/80 rule (the incident). Idempotent: no-op if absent. */
async function revokeHttpIngress() {
  const sg = await describeDedicated();
  if (!hasHttpIngress(sg)) return { changed: false, state: 'already-absent', sgId: C().sgId };
  const res = await client().send(new RevokeSecurityGroupIngressCommand({
    GroupId: C().sgId, IpPermissions: [httpPermission()],
  }));
  // AWS returns Return:true even when nothing matched; a non-empty
  // UnknownIpPermissions means the rule was NOT revoked — surface that honestly.
  if ((res.UnknownIpPermissions || []).length > 0) {
    throw new Error(`revoke did not match the tcp/${C().httpPort} ${C().httpCidr} rule on ${C().sgId}`);
  }
  return { changed: true, state: 'revoked', sgId: C().sgId };
}

/** Re-authorise the public TCP/80 rule (instructor reset). Idempotent. */
async function authorizeHttpIngress() {
  const sg = await describeDedicated();
  if (hasHttpIngress(sg)) return { changed: false, state: 'already-present', sgId: C().sgId };
  await client().send(new AuthorizeSecurityGroupIngressCommand({
    GroupId: C().sgId, IpPermissions: [httpPermission()],
  }));
  return { changed: true, state: 'authorized', sgId: C().sgId };
}

/** Current state of the public HTTP rule on the dedicated SG. */
async function verifyHttpIngressState() {
  const sg = await describeDedicated();
  return { sgId: C().sgId, http_open: hasHttpIngress(sg) };
}

module.exports = {
  describeDedicated, hasHttpIngress, revokeHttpIngress, authorizeHttpIngress,
  verifyHttpIngressState, httpPermission, _setClient,
};
