/**
 * INC-003 injector — Sprint 3 DSO-W3: "the image is compromised".
 *
 * The incident is a BUILD-TIME secret exposure, not a runtime fault: a synthetic
 * TRAINING canary was baked into the container image during the build, so it is
 * present in the image's layers (and, for the vulnerable build, in the final
 * filesystem). The application keeps serving traffic normally — a healthy app is
 * NOT evidence of a secure image, which is the whole point of the exercise.
 *
 * What this injector does, and ONLY this:
 *   * runIncident(): READ a known path inside its OWN container and decide whether
 *     the running image is the vulnerable one (the canary file exists AND contains
 *     the obviously-synthetic marker). If so, raise a GENERIC operational security
 *     alert. It writes nothing, copies nothing, and reaches no network or registry.
 *   * reset(): return the alarm to idle so the exercise can be replayed (replaying
 *     the RED state is a rebuild of the vulnerable image, done with warroom.sh).
 *
 * SAFETY / honesty:
 *   * The marker it looks for is a fake training value that authenticates to
 *     nothing (see warroom/inc003/training-canary.env). The real secret value is
 *     NEVER stored in the incident record or returned to any caller — only the
 *     fact that credential material was detected, and a short redacted token.
 *   * The public incident brief (warroom/routes.js) is symptom-level only: it
 *     never names the Dockerfile line, the build context, .dockerignore, or how
 *     the secret got in. Students discover that from the evidence.
 *   * The deeper lesson — a secret deleted from the final filesystem is STILL
 *     recoverable from an earlier image layer — is proven locally and for real by
 *     warroom/inc003/verify.sh, which inspects `docker history` and the image
 *     filesystem. This injector does not fabricate that; it only raises the alarm.
 */
const fs = require('fs');
const config = require('./config');
const { getIncident, raiseIncident, setStatus } = require('./state');

const INC = config.inc003;

/**
 * Is the running image the vulnerable one? True iff the canary file exists and
 * contains the synthetic marker. Never throws, never returns the secret value.
 */
function detectCanary() {
  try {
    if (!fs.existsSync(INC.canaryPath)) return { present: false, path: INC.canaryPath };
    const body = fs.readFileSync(INC.canaryPath, 'utf8');
    return { present: body.includes(INC.marker), path: INC.canaryPath };
  } catch (_err) {
    // A read problem is not a detection; fail closed to "not detected" rather
    // than raising a false incident.
    return { present: false, path: INC.canaryPath };
  }
}

/** A short, non-reversible token for the audit trail — never the secret itself. */
function redactedToken() {
  // The first few characters of the marker, enough to correlate in a debrief,
  // not enough to reconstruct anything (and the marker is fake regardless).
  return `${INC.marker.slice(0, 12)}…`;
}

async function runIncident() {
  // Never double-fire on top of an already-active alarm.
  const current = await getIncident();
  if (current && current.status === 'active') {
    return { incident: 'INC-003', already_active: true };
  }

  const found = detectCanary();
  if (!found.present) {
    // No credential material in this image — nothing to alarm on. This is the
    // GREEN path: a corrected/remediated image reaches here and stays healthy.
    return { incident: 'INC-003', detected: false, alarm: 'not-raised' };
  }

  // A GENERIC, operational security alert. No root cause, no file, no secret
  // value — only that credential material is associated with the running image.
  const headline = 'Security monitoring detected credential material in the container image currently in use.';
  // Evidence is stored for the instructor debrief only; publicIncident() never
  // exposes it to learners. It records detection facts, never the secret value.
  const evidence = {
    incident: 'INC-003',
    severity: 'HIGH',
    status_label: 'INVESTIGATION REQUIRED',
    image_ref: INC.imageRef,
    credential_material_detected: true,
    detected_marker_token: redactedToken(),
    detector: 'image-filesystem-presence',
    note: 'Running application is healthy; image security state is considered compromised.',
  };
  await raiseIncident(headline, evidence);
  return {
    incident: 'INC-003',
    detected: true,
    severity: 'HIGH',
    image_ref: INC.imageRef,
    alarm: 'raised',
  };
}

async function reset() {
  // Return the alarm to idle. Replaying the RED state means rebuilding the
  // vulnerable image (warroom.sh), not writing a secret here.
  await setStatus('idle');
  return { incident: 'INC-003', reset: true };
}

module.exports = { runIncident, reset, detectCanary };
