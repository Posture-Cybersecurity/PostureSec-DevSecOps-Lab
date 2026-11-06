#!/usr/bin/env node
/**
 * Instructor CLI — talks to a RUNNING app through the same instructor endpoints
 * an instructor could curl. It never reaches into the database directly, so it
 * respects exactly the controls the server enforces.
 *
 *   node src/warroom/cli.js status     show the current alarm state
 *   node src/warroom/cli.js trigger    fire INC-001 immediately
 *   node src/warroom/cli.js reset      restore the initial state
 *
 * Configuration comes from the environment:
 *   WAR_ROOM_SELF_URL           (default http://127.0.0.1:5000)
 *   WAR_ROOM_INSTRUCTOR_TOKEN   required for trigger/reset
 */
const config = require('./config');

const base = config.selfBaseUrl.replace(/\/$/, '');

async function main() {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  const headers = { 'Content-Type': 'application/json' };
  if (config.instructorToken) headers['x-warroom-token'] = config.instructorToken;

  const routes = {
    status: ['GET', '/api/incident/status'],
    trigger: ['POST', '/api/incident/trigger'],
    reset: ['POST', '/api/incident/reset'],
  };
  if (!routes[cmd]) {
    console.error(`Unknown command "${cmd}". Use: status | trigger | reset`);
    process.exit(2);
  }
  if ((cmd === 'trigger' || cmd === 'reset') && !config.instructorToken) {
    console.error('WAR_ROOM_INSTRUCTOR_TOKEN is not set — trigger/reset are disabled.');
    process.exit(3);
  }
  const [method, path] = routes[cmd];
  try {
    const res = await fetch(`${base}${path}`, { method, headers });
    const body = await res.json().catch(() => ({}));
    console.log(JSON.stringify(body, null, 2));
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error(`Could not reach ${base}: ${err.message}`);
    process.exit(4);
  }
}

main();
