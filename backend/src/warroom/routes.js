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
    // its own symptom brief and adds process/proxy/OS evidence sources. Both
    // still make the squad discover the root cause.
    const api4 = config.incident === 'INC-002';
    const activeBrief = api4
      ? 'POSTURESec is experiencing intermittent availability issues. API response times '
        + 'are increasing and users are reporting timeouts. Investigate, contain, recover, '
        + 'and determine the root cause — confirm it with evidence.'
      : 'Unexpected changes were observed to published content on this platform. '
        + 'Investigate what happened, establish who and what was affected, and confirm it with evidence.';
    res.json({
      ...pub,
      brief: pub.active ? activeBrief : 'No active incident.',
      investigate: [
        'What happened?',
        'How did it happen?',
        'What data was exposed?',
        'How many users were affected?',
        'Can we reproduce it?',
        'How do we contain it?',
        'How do we fix it?',
      ],
      evidence_sources: [
        'Application request logs (container stdout and the warroom_access_log table)',
        'The application database (users, sessions, posts, comments)',
        'The application source code',
        'Git history',
        ...(api4 ? [
          'Process / application state (PM2 or the container process, restarts)',
          'The reverse proxy (Nginx) state and its logs',
          'Host resource pressure (CPU, memory) during the window',
        ] : []),
      ],
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
