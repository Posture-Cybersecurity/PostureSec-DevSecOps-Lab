/**
 * INC-005 "Console Hotfix Drift" injector — this War Room instance is ONE squad's control plane
 * for its REAL EC2 lab, on the same squad platform as INC-004 live (same settings: config.inc004,
 * same row-locked store code, same real driver in its drift scenario). Engine contract
 * { runIncident, reset } plus:
 *
 *   startLoop()  the platform loop (timer.js calls it instead of the boot fuse): readiness → drift
 *                ONCE → checks → verification → score → cleanup, with no instructor step.
 *   squad()      the squad runner members' requests go through.
 *
 * State: ONE row per squad in warroom_inc005_drift (JSONB). The fake driver is never chosen
 * here; tests inject one with useDriverForTests().
 */
const path = require('path');
const config = require('./config');
const { pool } = require('../db');
const { getIncident, raiseIncident, setStatus } = require('./state');
const { dbStore, ensureTables } = require('./injector_tf_ec2_live');

const SQUAD_DIR = path.join(__dirname, '../../../warroom/inc004/squad');
const C = require(path.join(SQUAD_DIR, 'drift-controller'));
const { driftRunner } = require(path.join(SQUAD_DIR, 'drift-runner'));

const TABLE = 'warroom_inc005_drift';
const HEADLINE = 'SEV-2: PostureBlogging is unreachable from the squad\'s network.';
const L = config.inc004;
let runner = null;
let loop = null;
let injected = null;            // { driver, clock } — tests only

function settings() {
  const problems = [];
  if (!/^[a-z0-9][a-z0-9-]{1,14}$/.test(L.squad)) problems.push('WAR_ROOM_SQUAD');
  if (!L.squadCidrs.length) problems.push('WAR_ROOM_INC004_SQUAD_CIDRS');
  if (!injected) {
    if (!/^[0-9]{12}$/.test(L.accountId)) problems.push('WAR_ROOM_INC004_ACCOUNT_ID');
    if (!L.awsProfile) problems.push('WAR_ROOM_INC004_AWS_PROFILE');
  }
  if (problems.length) throw new Error(`INC-005 is not configured: ${problems.join(', ')}`);
}

function squad() {
  if (runner) return runner;
  settings();
  const clock = injected ? injected.clock : Date.now;
  const driver = injected ? injected.driver : require(path.join(SQUAD_DIR, 'driver-real')).createRealDriver({
    squad: L.squad, squadCidrs: L.squadCidrs, accountId: L.accountId, profile: L.awsProfile, allowRoot: L.allowRoot, scenario: 'drift',
  });
  // INC-005's drift delay is fixed (5 min after verified readiness): INC-004's fuse setting does not apply.
  const initial = () => C.create(L.squad, clock(), {
    graceSeconds: L.graceSeconds, maxLifetimeSeconds: L.maxLifetimeSeconds,
  });
  runner = driftRunner({ store: dbStore(L.squad, initial, TABLE), driver, clock, onEvent: logEvent, ...(injected ? injected.timers : {}) });
  return runner;
}

/** Server log of the fuse and every injection attempt (masked); the banner follows a successful one. */
function logEvent(event, data) {
  const mask = (s) => String(s).replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g, '<ip>');
  console.log(`[warroom] INC-005 ${L.squad} ${event} ${mask(JSON.stringify(data || {}))}`);
  if (event === 'inject_ok') mirrorAlarm().catch((err) => console.error('[warroom] INC-005 alarm failed:', err.message));
}

/** Mirror the squad's phase onto the shared alarm row the banner reads. */
async function mirrorAlarm() {
  const v = await squad().view();
  let alarm = await getIncident();
  // A new run on this control plane: clear an alarm an earlier run left resolved, so the incident
  // raises a fresh one (with its own time). Only before the incident, never during it.
  if (['booting', 'ready'].includes(v.phase) && alarm && alarm.status !== 'idle') {
    await pool.query(`UPDATE warroom_incident SET status = 'idle', headline = NULL, triggered_at = NULL,
        contained_at = NULL, resolved_at = NULL, evidence = '{}'::jsonb, updated_at = NOW() WHERE id = $1`, [config.incidentId]);
    alarm = await getIncident();
  }
  if (['incident', 'recovering'].includes(v.phase) && (!alarm || alarm.status === 'idle')) {
    await raiseIncident(HEADLINE, { incident: 'INC-005', squad: v.squad, live: true });
  } else if (v.phase === 'completed' && alarm && alarm.status === 'active') {
    await setStatus('resolved');
  }
  return v.phase;
}

async function tickOnce() {
  const r = await squad().tick();
  await mirrorAlarm();
  return r;
}

function startLoop() {
  if (loop) return loop;
  squad();                                                  // fail fast on missing settings
  console.log(`[warroom] INC-005 drift: squad ${L.squad} platform loop every ${L.tickSeconds}s`);
  loop = setInterval(() => {
    tickOnce().catch((err) => console.error('[warroom] INC-005 tick failed:', err.message));
  }, L.tickSeconds * 1000);
  if (typeof loop.unref === 'function') loop.unref();
  // A restarted control plane re-arms a pending fuse from the stored ready time at once.
  squad().armFuse().catch((err) => console.error('[warroom] INC-005 fuse arm failed:', err.message));
  return loop;
}

function stopLoop() {
  if (loop) { clearInterval(loop); loop = null; }
  if (runner) runner.stop();
}

// Engine contract — the instructor's emergency controls, never the normal path.
async function runIncident() {
  return { incident: 'INC-005', live: true, ...(await squad().override('instructor', 'trigger_now')) };
}
async function reset() {
  const r = await squad().override('instructor', 'pause');
  return { incident: 'INC-005', live: true, reset: true, note: 'paused; the squad lab is NOT destroyed (use override destroy)', ...r };
}

/** Tests only: run against an injected (fake) driver, clock and (optionally) fuse timers { schedule, cancel }. */
function useDriverForTests(driver, clock, timers = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('useDriverForTests is not available in production');
  stopLoop();
  injected = { driver, clock, timers };
  runner = null;
}

module.exports = {
  runIncident, reset, startLoop, stopLoop, tickOnce, squad, mirrorAlarm, useDriverForTests, TABLE,
  ensureTables: () => ensureTables(TABLE),
};
