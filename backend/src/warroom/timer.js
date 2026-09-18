/**
 * The five-minute fuse.
 *
 * Armed once, from the server's listen callback, only when the exercise is
 * enabled. After WAR_ROOM_INCIDENT_DELAY_SECONDS it fires the incident exactly
 * once. Deterministic, local-only, and cancellable (the handle is returned so
 * the process — or a test — can clear it).
 */
const config = require('./config');
const injector = require('./injector');

function armIncidentTimer() {
  if (!config.enabled) return null;
  const ms = config.delaySeconds * 1000;
  console.log(`[warroom] armed: INC-001 will fire in ${config.delaySeconds}s (squad=${config.squad})`);
  const handle = setTimeout(async () => {
    try {
      const summary = await injector.runIncident();
      console.log(`[warroom] INC-001 fired: ${JSON.stringify(summary)}`);
    } catch (err) {
      console.error('[warroom] scheduled incident failed:', err.message);
    }
  }, ms);
  // Do not keep the event loop alive on account of the fuse alone.
  if (typeof handle.unref === 'function') handle.unref();
  return handle;
}

module.exports = { armIncidentTimer };
