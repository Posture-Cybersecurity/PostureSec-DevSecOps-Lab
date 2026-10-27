/**
 * Incident API.
 *
 *   GET  /api/incident/status   the alarm the homepage banner reads (public)
 *   GET  /api/incident          the learner-facing incident brief (public):
 *                               symptoms and the questions to answer — never
 *                               the cause, the endpoint, or the accounts.
 *   POST /api/incident/trigger  fire the incident now (INSTRUCTOR token only)
 *   POST /api/incident/reset    restore the initial state (INSTRUCTOR token only)
 *
 * The instructor controls fail closed: with no WAR_ROOM_INSTRUCTOR_TOKEN set
 * they are disabled, and a wrong or missing token is refused.
 */
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const config = require('./config');
const { getIncident, publicIncident, setStatus } = require('./state');
// Dispatches to the configured incident's injector (INC-001 default, INC-002 API4).
const injector = require('./incidents');

function tokenOk(req) {
  const expected = config.instructorToken;
  if (!expected) return false; // no token configured => controls disabled
  const provided = (req.get('x-warroom-token')
    || (req.get('authorization') || '').replace(/^Bearer\s+/i, '')
    || '').trim();
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireInstructor(req, res, next) {
  if (!tokenOk(req)) {
    return res.status(403).json({ error: 'Instructor token required' });
  }
  next();
}

router.get('/status', async (_req, res) => {
  try {
    res.json(publicIncident(await getIncident()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read incident status' });
  }
});

router.get('/', async (_req, res) => {
  try {
    const row = await getIncident();
    const pub = publicIncident(row);
    // Symptom-level brief only — never a cause, endpoint or account. INC-001
    // (Sprint 1) keeps its exact wording; INC-002 (Sprint 2, availability) uses
    // its own symptom brief and process/proxy/OS evidence sources; INC-003
    // (Sprint 3, DSO-W3) is an image-security incident with image-focused
    // evidence. Every variant still makes the squad discover the root cause.
    const api4 = config.incident === 'INC-002';
    const inc003 = config.incident === 'INC-003';

    let activeBrief;
    if (inc003) {
      activeBrief =
        'Your team has successfully built and deployed the Sprint 3 application, and it '
        + 'is currently running normally. Security monitoring has detected sensitive '
        + 'credential material associated with the container image currently in use. The '
        + 'application appears healthy, but the security state of the image is considered '
        + 'compromised. Investigate the alert, determine whether the credential material is '
        + 'present in the final image and/or its layers, contain the exposure, remediate the '
        + 'build, rebuild the image, and prove the corrected image no longer contains it — '
        + 'confirm every step with evidence. A healthy application does not mean the image is secure.';
    } else if (api4) {
      activeBrief =
        'POSTURESec is experiencing intermittent availability issues. API response times '
        + 'are increasing and users are reporting timeouts. Investigate, contain, recover, '
        + 'and determine the root cause — confirm it with evidence.';
    } else {
      activeBrief =
        'Unexpected changes were observed to published content on this platform. '
        + 'Investigate what happened, establish who and what was affected, and confirm it with evidence.';
    }

    const investigate = inc003 ? [
      'What triggered the security alert?',
      'How did credential material come to be associated with the image?',
      'Is the credential present in the final image filesystem?',
      'Is the credential present in the image history / earlier layers?',
      'How do we contain the exposed credential?',
      'How do we remediate the build so it cannot recur?',
      'How do we prove the corrected image is clean, with a new digest?',
    ] : [
      'What happened?',
      'How did it happen?',
      'What data was exposed?',
      'How many users were affected?',
      'Can we reproduce it?',
      'How do we contain it?',
      'How do we fix it?',
    ];

    const evidence_sources = inc003 ? [
      'Container image metadata and history (docker image inspect / docker history)',
      'The image build configuration',
      'The image build context',
      'The container filesystem',
      'Image layers',
      'Security / secret scan output',
    ] : [
      'Application request logs (container stdout and the warroom_access_log table)',
      'The application database (users, sessions, posts, comments)',
      'The application source code',
      'Git history',
      ...(api4 ? [
        'Process / application state (PM2 or the container process, restarts)',
        'The reverse proxy (Nginx) state and its logs',
        'Host resource pressure (CPU, memory) during the window',
      ] : []),
    ];

    res.json({
      ...pub,
      brief: pub.active ? activeBrief : 'No active incident.',
      // INC-003 surfaces the operational alert fields (synthetic image ref,
      // severity, status) only while active — symptom-level, never a root cause.
      ...(inc003 && pub.active ? {
        severity: 'HIGH',
        status_label: 'INVESTIGATION REQUIRED',
        image_ref: config.inc003.imageRef,
      } : {}),
      investigate,
      evidence_sources,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read incident' });
  }
});

router.post('/trigger', requireInstructor, async (_req, res) => {
  try {
    const summary = await injector.runIncident();
    res.json({ ok: true, ...summary });
  } catch (err) {
    console.error('incident trigger failed:', err.message);
    res.status(500).json({ error: 'Trigger failed', detail: err.message });
  }
});

router.post('/reset', requireInstructor, async (_req, res) => {
  try {
    const out = await injector.reset();
    // A reset also disarms any pending auto-fire fuse, so cleanup cannot be
    // followed by a surprise incident. Re-running is a fresh boot (down/up).
    require('./timer').cancelIncidentTimer();
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('incident reset failed:', err.message);
    res.status(500).json({ error: 'Reset failed', detail: err.message });
  }
});

// Optional: let an instructor mark progress states for a debrief.
router.post('/status/:state', requireInstructor, async (req, res) => {
  const state = req.params.state;
  if (!['contained', 'resolved', 'active', 'idle'].includes(state)) {
    return res.status(400).json({ error: 'Unknown state' });
  }
  try {
    res.json({ ok: true, incident: publicIncident(await setStatus(state)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to set state' });
  }
});

module.exports = router;
