/**
 * The five-minute fuse.
 *
 * Armed once, from the server's listen callback, only when the exercise is
 * enabled. After WAR_ROOM_INCIDENT_DELAY_SECONDS it fires the incident exactly
 * once. Deterministic, local-only, and cancellable (the handle is returned so
 * the process — or a test — can clear it).
 */
const config = require('./config');
const incidents = require('./incidents');

// The single live fuse handle, kept at module scope so arming is idempotent (a
// re-arm never leaves two fuses) and a reset can cancel a pending one.
let _handle = null;

function armIncidentTimer() {
  if (!config.enabled) return null;
  // Idempotent: clear any existing fuse first, so this can never schedule two.
  if (_handle) { clearTimeout(_handle); _handle = null; }
  const ms = config.delaySeconds * 1000;
  console.log(`[warroom] armed: ${config.incident} will fire in ${config.delaySeconds}s (squad=${config.squad})`);
  _handle = setTimeout(async () => {
    _handle = null; // one-shot: it has fired
    try {
      const summary = await incidents.runIncident();
      console.log(`[warroom] ${config.incident} fired: ${JSON.stringify(summary)}`);
    } catch (err) {
      console.error('[warroom] scheduled incident failed:', err.message);
    }
  }, ms);
  // Do not keep the event loop alive on account of the fuse alone.
  if (typeof _handle.unref === 'function') _handle.unref();
  return _handle;
}

/** Disarm a pending auto-fire (no-op if none is scheduled). Called by reset so a
 * cleanup also cancels a fuse that has not fired yet. Re-running the exercise is
 * a fresh boot (warroom.sh down/up), which arms a new fuse. */
function cancelIncidentTimer() {
  if (_handle) { clearTimeout(_handle); _handle = null; return true; }
  return false;
}

module.exports = { armIncidentTimer, cancelIncidentTimer };
