/**
 * INC-004 LIVE squad API — mounted under /api/incident only when WAR_ROOM_INC004_MODE=live.
 * Every member call needs a session (401) and is attributed to that member.
 *
 *   GET  /workspace          the squad's shared view (phase, timeline, evidence, config, plan, checks, score)
 *   POST /live/start         deploy the squad lab                        (202: runs in the background)
 *   POST /live/evidence      { id }  one read-only view; returns its output
 *   POST /live/config        { cidrs: [...] }  change the squad's Terraform ingress configuration
 *   POST /live/plan          guarded plan of the current configuration   (202)
 *   POST /live/review        { plan }  the plan's text; records the reviewer
 *   POST /live/apply         { plan }  apply the squad's current plan      (202)
 *   POST /live/report        { hypothesis, summary }  the squad's report (once)
 *   POST /live/cleanup       guarded destroy of the squad lab             (202)
 *   GET  /debrief            INSTRUCTOR: the full squad record
 *   POST /live/override      INSTRUCTOR emergency: { action: trigger_now | pause | resume | destroy }
 *
 * 202 operations hold the squad's operation lock while they run; a second member gets 409 with
 * who is running what. Failures are recorded in the squad timeline, never thrown at the client.
 */
const express = require('express');
const { requireAuth } = require('../middleware/authenticate');
const live = require('./injector_tf_ec2_live');
const path = require('path');

const S = require(path.join(__dirname, '../../../warroom/inc004/squad/scenario-live'));
const { Busy, LockLost } = require(path.join(__dirname, '../../../warroom/inc004/squad/runner'));

const EVIDENCE = Object.entries(S.EVIDENCE).map(([id, label]) => ({ id, label }));
const HYPOTHESES = Object.entries(S.HYPOTHESES).map(([id, label]) => ({ id, label }));
const member = (req) => req.user.email;
const str = (v, max = 80) => (typeof v === 'string' && v.length <= max ? v : null);

function fail(res, err) {
  if (err instanceof Busy || err instanceof LockLost) return res.status(409).json({ error: err.message });
  console.error('INC-004 live request failed:', err.message);
  return res.status(502).json({ error: 'The lab operation failed; see the squad timeline.' });
}

/** Start a long operation: wait only for the lock, then return 202 while it runs. (Also used by INC-005.) */
async function background(res, by, kind, fn, runner = live.squad()) {
  const v = await runner.view();
  if (v.busy) return res.status(409).json({ error: `another operation is running: ${v.busy.by} is running "${v.busy.kind}"` });
  const op = fn(runner);
  // If the lock is taken by someone else in the meantime, fn rejects with Busy immediately.
  const early = await Promise.race([op.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r('running'), 50))]);
  if (early instanceof Busy) return res.status(409).json({ error: early.message });
  if (early && early !== 'running') return fail(res, early);
  if (early === 'running') {
    op.catch(async (err) => {
      console.error(`INC-004 live ${kind} failed:`, err.message);
      await runner.note(by, `${kind}_failed`, err.message).catch(() => {});
    });
  }
  return res.status(202).json({ accepted: true, operation: kind, by, view: await runner.view() });
}

module.exports = function tfEc2LiveRoutes(requireInstructor) {
  const router = express.Router();

  router.get('/workspace', requireAuth, async (_req, res) => {
    try { res.json({ ...(await live.squad().view()), evidence_views: EVIDENCE, hypotheses: HYPOTHESES }); } catch (e) { fail(res, e); }
  });

  router.post('/live/start', requireAuth, (req, res) => background(res, member(req), 'start', (r) => r.start(member(req))).catch((e) => fail(res, e)));
  router.post('/live/plan', requireAuth, (req, res) => background(res, member(req), 'plan', (r) => r.plan(member(req))).catch((e) => fail(res, e)));
  router.post('/live/cleanup', requireAuth, (req, res) => background(res, member(req), 'cleanup', (r) => r.cleanup(member(req))).catch((e) => fail(res, e)));
  router.post('/live/apply', requireAuth, (req, res) => {
    const plan = str(req.body && req.body.plan);
    if (!plan) return res.status(400).json({ error: 'plan: the name of the squad\'s current plan' });
    return background(res, member(req), 'apply', (r) => r.apply(member(req), plan)).catch((e) => fail(res, e));
  });

  router.post('/live/evidence', requireAuth, async (req, res) => {
    const id = str(req.body && req.body.id, 40);
    if (!id || !Object.prototype.hasOwnProperty.call(S.EVIDENCE, id)) return res.status(400).json({ error: 'unknown evidence view' });
    try { const r = await live.squad().evidence(member(req), id); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  router.post('/live/config', requireAuth, async (req, res) => {
    const cidrs = req.body && req.body.cidrs;
    if (!Array.isArray(cidrs) || !cidrs.every((c) => typeof c === 'string')) return res.status(400).json({ error: 'cidrs: a list of CIDR strings' });
    try { const r = await live.squad().setConfig(member(req), cidrs); res.status(r.ok ? 200 : 400).json(r); } catch (e) { fail(res, e); }
  });

  router.post('/live/review', requireAuth, async (req, res) => {
    const plan = str(req.body && req.body.plan);
    if (!plan) return res.status(400).json({ error: 'plan: the name of the squad\'s current plan' });
    try { const r = await live.squad().review(member(req), plan); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  router.post('/live/report', requireAuth, async (req, res) => {
    try { const r = await live.squad().report(member(req), req.body || {}); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  router.get('/debrief', requireInstructor, async (_req, res) => {
    try { res.json(await live.squad().state()); } catch (e) { fail(res, e); }
  });

  router.post('/live/override', requireInstructor, async (req, res) => {
    const action = str(req.body && req.body.action, 20);
    if (!['trigger_now', 'pause', 'resume', 'destroy'].includes(action)) return res.status(400).json({ error: 'action: trigger_now | pause | resume | destroy' });
    try { const r = await live.squad().override('instructor', action); res.status(r.ok ? 200 : 409).json(r); } catch (e) { fail(res, e); }
  });

  return router;
};
module.exports.background = background;
module.exports.fail = fail;
