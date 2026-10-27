/**
 * INC-004 squad and instructor API — mounted under /api/incident ONLY when
 * WAR_ROOM_INCIDENT=INC-004, so every other incident's API is unchanged.
 *
 *   GET  /api/incident/workspace   the squad's view: actions, hypotheses, revealed
 *                                  evidence, timeline (signed-in user)
 *   POST /api/incident/actions     { action }                (signed-in user)
 *   POST /api/incident/report      { hypothesis, summary }   (signed-in user)
 *   GET  /api/incident/debrief     full record + scoring key (INSTRUCTOR token)
 *
 * Every squad call needs a session (401 otherwise) and is attributed to that
 * user in the audit trail. Inputs are allow-listed; errors never leak detail.
 */
const express = require('express');
const { requireAuth } = require('../middleware/authenticate');
const inc = require('./injector_tf_ec2');
const S = require('./tf_ec2/scenario');

const ACTION_LIST = Object.entries(S.ACTIONS).map(([id, a]) => ({ id, kind: a.kind, label: a.label }));
const HYPOTHESIS_LIST = Object.entries(S.HYPOTHESES).map(([id, label]) => ({ id, label }));
const isAction = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(S.ACTIONS, v);

module.exports = function tfEksRoutes(requireInstructor) {
  const router = express.Router();

  const fail = (res, label) => (err) => {
    console.error(`INC-004 ${label} failed:`, err.message);
    res.status(500).json({ error: `Failed to ${label}` });
  };

  router.get('/workspace', requireAuth, async (_req, res) => {
    try {
      const view = await inc.view();
      if (!view) return res.status(409).json({ error: 'No active incident' });
      res.json({ ...view, actions: ACTION_LIST, hypotheses: HYPOTHESIS_LIST });
    } catch (err) { fail(res, 'read the workspace')(err); }
  });

  router.post('/actions', requireAuth, async (req, res) => {
    const action = req.body && req.body.action;
    if (!isAction(action)) return res.status(400).json({ error: 'Unknown action' });
    try {
      const { result, view } = await inc.perform(req.user, action);
      res.status(result.code).json(result.ok ? { ...result, view } : { error: result.message });
    } catch (err) { fail(res, 'perform the action')(err); }
  });

  router.post('/report', requireAuth, async (req, res) => {
    try {
      const { result, view } = await inc.report(req.user, req.body);
      res.status(result.code).json(result.ok ? { ...result, view } : { error: result.message });
    } catch (err) { fail(res, 'submit the report')(err); }
  });

  router.get('/debrief', requireInstructor, async (_req, res) => {
    try {
      const d = await inc.debrief();
      if (!d) return res.status(404).json({ error: 'No attempt recorded yet' });
      res.json(d);
    } catch (err) { fail(res, 'read the debrief')(err); }
  });

  return router;
};
