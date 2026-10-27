/**
 * INC-005 "Console Hotfix Drift" squad API — mounted under /api/incident when
 * WAR_ROOM_INCIDENT=INC-005. Every member call needs a session (401) and is attributed.
 *
 *   GET  /workspace          the squad's shared view (phase, timeline, evidence, plan, checks, score)
 *   POST /live/start         deploy the squad lab                             (202)
 *   POST /live/evidence      { id }  one read-only view (never blocked by a running operation)
 *   POST /live/plan          guarded saved plan of the unchanged configuration (202)
 *   POST /live/inspect       { plan }  the saved plan's text; records who inspected it (read-only)
 *   POST /live/apply         { plan }  apply the squad's current saved plan     (202)
 *   POST /live/cleanup       guarded destroy of the squad lab                  (202)
 *   GET  /debrief            INSTRUCTOR: the full squad record
 *   POST /live/override      INSTRUCTOR emergency: { action: trigger_now | pause | resume | destroy }
 *
 * Only steps that change AWS/Terraform take the squad lock; a second one meanwhile gets one 409
 * naming who is running what. Reads never wait for the lock. No configuration edit, no review
 * gate and no report: the platform verifies and scores from objective evidence.
 */
const express = require('express');
const path = require('path');
const { requireAuth } = require('../middleware/authenticate');
const drift = require('./injector_tf_drift');
const { background, fail } = require('./routes_tf_ec2_live');

const S = require(path.join(__dirname, '../../../warroom/inc004/squad/scenario-drift'));

const EVIDENCE = Object.entries(S.EVIDENCE).map(([id, label]) => ({ id, label }));
const CHECKS = Object.entries(S.CHECKS).map(([id, label]) => ({ id, label }));
const member = (req) => req.user.email;
const str = (v, max = 80) => (typeof v === 'string' && v.length <= max ? v : null);
const bg = (kind, fn) => (req, res) => background(res, member(req), kind, fn(req), drift.squad()).catch((e) => fail(res, e));

module.exports = function tfDriftRoutes(requireInstructor) {
  const router = express.Router();

  router.get('/workspace', requireAuth, async (_req, res) => {
    try { res.json({ ...(await drift.squad().view()), evidence_views: EVIDENCE, check_labels: CHECKS }); } catch (e) { fail(res, e); }
  });

  router.post('/live/start', requireAuth, bg('start', (req) => (r) => r.start(member(req))));
  router.post('/live/plan', requireAuth, bg('plan', (req) => (r) => r.plan(member(req))));
  router.post('/live/cleanup', requireAuth, bg('cleanup', (req) => (r) => r.cleanup(member(req))));
  router.post('/live/apply', requireAuth, (req, res) => {
    const plan = str(req.body && req.body.plan);
    if (!plan) return res.status(400).json({ error: 'plan: the name of the squad\'s current saved plan' });
    return bg('apply', () => (r) => r.apply(member(req), plan))(req, res);
  });

  router.post('/live/evidence', requireAuth, async (req, res) => {
    const id = str(req.body && req.body.id, 40);
    if (!id || !Object.prototype.hasOwnProperty.call(S.EVIDENCE, id)) return res.status(400).json({ error: 'unknown evidence view' });
    try { const r = await drift.squad().evidence(member(req), id); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  router.post('/live/inspect', requireAuth, async (req, res) => {
    const plan = str(req.body && req.body.plan);
    if (!plan) return res.status(400).json({ error: 'plan: the name of the squad\'s current saved plan' });
    try { const r = await drift.squad().inspect(member(req), plan); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  router.get('/debrief', requireInstructor, async (_req, res) => {
    try { res.json(await drift.squad().state()); } catch (e) { fail(res, e); }
  });

  router.post('/live/override', requireInstructor, async (req, res) => {
    const action = str(req.body && req.body.action, 20);
    if (!['trigger_now', 'pause', 'resume', 'destroy'].includes(action)) return res.status(400).json({ error: 'action: trigger_now | pause | resume | destroy' });
    try { const r = await drift.squad().override('instructor', action); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  return router;
};
