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

// Synthetic, obviously-fake accounts. Tagged so reset can find and remove
// exactly these and nothing a learner created. Never real people.
config.actors = {
  victim: { email: 'alice.victim@warroom.local', password: 'warroom-victim-passphrase-01' },
  attacker: { email: 'mallory.attacker@warroom.local', password: 'warroom-attacker-passphrase-01' },
};
config.syntheticEmailDomain = '@warroom.local';

module.exports = config;
