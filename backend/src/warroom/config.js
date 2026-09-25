/**
 * War Room (Sprint 1) configuration — INSTRUCTOR SCAFFOLDING, opt-in.
 *
 * None of this changes the blogging application's behaviour unless
 * WAR_ROOM_ENABLED is true. The exercise is deterministic, local-only and
 * reversible: a timer fires a controlled synthetic incident against the app's
 * OWN api using two synthetic accounts, honest request logging records what
 * actually happened, and the homepage raises a generic alarm. The underlying
 * weakness is NOT described anywhere a learner can read — they discover it from
 * the evidence and the source.
 *
 * Fail closed: the instructor-only controls (immediate trigger, reset) require
 * WAR_ROOM_INSTRUCTOR_TOKEN. If it is unset, those controls are disabled.
 */
const num = (name, def, min, max) => {
  const raw = (process.env[name] || '').trim();
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
};

const config = {
  // The whole scaffolding is inert unless this is explicitly on.
  enabled: (process.env.WAR_ROOM_ENABLED || '').trim().toLowerCase() === 'true',

  // Delay from boot to the automatic incident. Default 5 minutes; 30s for a
  // rehearsal. Clamped to a sane band so a typo cannot arm it for a week.
  delaySeconds: num('WAR_ROOM_INCIDENT_DELAY_SECONDS', 300, 5, 86400),

  // Instructor-only controls are refused without this. No default: absence
  // means "disabled", never "open".
  instructorToken: (process.env.WAR_ROOM_INSTRUCTOR_TOKEN || '').trim(),

  // Which squad this instance belongs to (for evidence only; isolation is
  // enforced by separate containers/databases, not by this label).
  squad: (process.env.WAR_ROOM_SQUAD || 'local').trim().slice(0, 40),

  // The app's own base URL, so the injector makes REAL requests over the real
  // HTTP stack (and is captured by the real logging middleware).
  selfBaseUrl: (process.env.WAR_ROOM_SELF_URL || `http://127.0.0.1:${process.env.PORT || 5000}`).trim(),

  incidentId: 'INC-001',
};

// Which incident this instance runs. Default INC-001 (Sprint 1) so NOTHING about
// the existing exercise changes unless INC-002 is explicitly selected.
const _INCIDENTS = ['INC-001', 'INC-002'];
const _sel = (process.env.WAR_ROOM_INCIDENT || 'INC-001').trim().toUpperCase();
config.incident = _INCIDENTS.includes(_sel) ? _sel : 'INC-001';
config.incidentId = config.incident;

// INC-002 (API4 — Unrestricted Resource Consumption) injector bounds. Every
// value is a HARD, clamped safety limit. The injector ONLY targets THIS
// application (config.selfBaseUrl) on this ONE endpoint — it is not a general
// load generator, accepts no arbitrary URL, and stops itself at these bounds.
config.api4 = {
  endpoint: '/api/posts',                                            // fixed; never client-supplied
  maxPosts: num('WAR_ROOM_API4_MAX_POSTS', 300, 1, 2000),            // synthetic-record ceiling
  postSizeBytes: num('WAR_ROOM_API4_POST_BYTES', 40000, 500, 90000), // < the 100kb express.json cap
  concurrency: num('WAR_ROOM_API4_CONCURRENCY', 8, 1, 32),           // parallel in-flight requests
  ratePerSec: num('WAR_ROOM_API4_RATE_PER_SEC', 20, 1, 200),         // request-rate ceiling
  maxRuntimeSec: num('WAR_ROOM_API4_MAX_RUNTIME_SECONDS', 45, 5, 300), // HARD auto-stop
  maxRequests: num('WAR_ROOM_API4_MAX_REQUESTS', 5000, 10, 50000),   // absolute request ceiling
  perRequestTimeoutMs: num('WAR_ROOM_API4_REQ_TIMEOUT_MS', 10000, 500, 30000),
};

// Synthetic, obviously-fake accounts. Tagged so reset can find and remove
// exactly these and nothing a learner created. Never real people.
config.actors = {
  victim: { email: 'alice.victim@warroom.local', password: 'warroom-victim-passphrase-01' },
  attacker: { email: 'mallory.attacker@warroom.local', password: 'warroom-attacker-passphrase-01' },
};
config.syntheticEmailDomain = '@warroom.local';

module.exports = config;
