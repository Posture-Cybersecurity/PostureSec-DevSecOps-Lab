/**
 * Incident registry — selects the injector for the configured incident.
 *
 * INC-001 (Sprint 1 — authorization/BOLA) is the DEFAULT, so the existing
 * exercise is byte-for-byte unchanged unless WAR_ROOM_INCIDENT=INC-002 is set.
 * INC-002 is the Sprint 2 API4 (Unrestricted Resource Consumption) incident.
 *
 * Both injectors expose the same { runIncident, reset } interface, so the timer
 * and the instructor routes call through here without knowing which is active.
 */
const config = require('./config');

const registry = {
  'INC-001': () => require('./injector'),        // Sprint 1 — unchanged
  'INC-002': () => require('./injector_api4'),    // Sprint 2 — API4
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
