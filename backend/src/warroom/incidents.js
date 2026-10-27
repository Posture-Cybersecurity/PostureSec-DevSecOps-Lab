/**
 * Incident registry — selects the injector for the configured incident.
 *
 * INC-001 (Sprint 1 — authorization/BOLA) is the DEFAULT, so the existing
 * exercise is byte-for-byte unchanged unless WAR_ROOM_INCIDENT=INC-002 is set.
 * INC-002 is the Sprint 2 API4 (Unrestricted Resource Consumption) incident.
 *
 * INC-003 is the Sprint 3 DSO-W3 ("the image is compromised") incident.
 *
 * INC-004 is "The Terraform Apply That Broke Production — EC2 Edition": a
 * deterministic simulation of the lab's own deploy/aws-ec2 stack, whose evidence
 * can be captured from the dedicated War Room EC2 lab (warroom/inc004/). No
 * squad action reaches AWS.
 *
 * INC-005 is "Console Hotfix Drift" (DSO-W5 on the EC2 stack): always a squad's REAL lab, on the
 * same squad platform as INC-004 live (warroom/inc004/squad, drift scenario). Settings: config.inc004.
 *
 * Every injector exposes the same { runIncident, reset } interface, so the timer
 * and the instructor routes call through here without knowing which is active.
 */
const config = require('./config');

const registry = {
  'INC-001': () => require('./injector'),                    // Sprint 1 — unchanged
  'INC-002': () => require('./injector_api4'),                // Sprint 2 — API4
  'INC-003': () => require('./injector_image_compromised'),   // Sprint 3 — DSO-W3 image secret
  // Terraform apply that broke production (EC2): simulation by default, or a squad's real lab.
  'INC-004': () => (config.inc004.mode === 'live' ? require('./injector_tf_ec2_live') : require('./injector_tf_ec2')),
  'INC-005': () => require('./injector_tf_drift'),                // console hotfix drift (real lab)
};

function active() {
  const load = registry[config.incidentId] || registry['INC-001'];
  return load();
}

module.exports = {
  active,
  runIncident: (...args) => active().runIncident(...args),
  reset: (...args) => active().reset(...args),
};
