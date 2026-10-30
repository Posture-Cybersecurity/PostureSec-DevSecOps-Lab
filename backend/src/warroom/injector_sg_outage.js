/**
 * INC-005 injector — timed public-HTTP outage.
 *
 * When the fuse fires, the dedicated security group's public TCP/80 ingress
 * rule is revoked through the AWS SDK (aws_sg.js), so the hosted application
 * becomes unreachable from the internet while continuing to run. A GENERIC
 * availability alarm is raised — no root cause, no mention of the security
 * group or the missing rule. Students discover that from the evidence and from
 * Terraform drift, then restore it through the guarded remediation.
 *
 * Same { runIncident, reset } interface as every other injector, so the timer
 * and instructor routes dispatch to it unchanged. reset() re-opens the rule
 * (instructor-only) and returns the alarm to idle.
 *
 * Honesty: nothing is simulated. If the SG is not configured or the SDK call
 * fails, the incident is NOT recorded as fired — the error is surfaced.
 */
const config = require('./config');
const sg = require('./aws_sg');
const { getIncident, raiseIncident, setStatus } = require('./state');

async function runIncident() {
  const current = await getIncident();
  if (current && current.status === 'active') {
    return { incident: 'INC-005', already_active: true };
  }

  // Revoke only the dedicated public HTTP rule. aws_sg validates the target.
  const res = await sg.revokeHttpIngress();

  const headline = 'Availability monitoring detected a loss of public HTTP reachability for the hosted application.';
  const evidence = {
    incident: 'INC-005',
    severity: 'HIGH',
    status_label: 'INVESTIGATION REQUIRED',
    availability: 'public HTTP (TCP/80) unreachable from the internet',
    security_group: res.sgId,
    sdk_action: res.state, // 'revoked' | 'already-absent'
    note: 'Application process and database remain healthy; external reachability is lost.',
  };
  await raiseIncident(headline, evidence);
  return { incident: 'INC-005', injected: true, sdk: res };
}

async function reset() {
  // Instructor reset: re-open the public HTTP rule and return the alarm to idle.
  const res = await sg.authorizeHttpIngress();
  await setStatus('idle');
  return { incident: 'INC-005', reset: true, sdk: res };
}

module.exports = { runIncident, reset };
