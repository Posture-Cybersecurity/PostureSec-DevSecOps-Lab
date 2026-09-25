/**
 * War Room (Sprint 2) — INC-002 AUTO-FIRE (the automatic student path).
 *
 * The incident must fire on its own ~5 minutes after boot, with no instructor
 * action. Proven deterministically with fake timers + a mocked injector — NO
 * real 5-minute wait, no DB, no HTTP. The bounded injector itself and the
 * manual-override path are covered by warroom_api4.test.js.
 */
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT = 'INC-002';
delete process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS; // exercise the DEFAULT (~5 min)

const incidents = require('../src/warroom/incidents');
const config = require('../src/warroom/config');
const { armIncidentTimer, cancelIncidentTimer } = require('../src/warroom/timer');

let spy;
beforeEach(() => {
  jest.useFakeTimers();
  spy = jest.spyOn(incidents, 'runIncident').mockResolvedValue({ skipped: false });
});
afterEach(() => {
  cancelIncidentTimer();
  jest.clearAllTimers();
  jest.useRealTimers();
  spy.mockRestore();
});

// 1 + 2 + 4: auto-fire is enabled, selects INC-002, default delay ~5 min.
test('auto-fire is enabled, targets INC-002, default delay is ~5 minutes', () => {
  expect(config.enabled).toBe(true);
  expect(config.incident).toBe('INC-002');
  expect(config.incidentId).toBe('INC-002');
  expect(config.delaySeconds).toBe(300); // ~5 min default (WAR_ROOM_INCIDENT_DELAY_SECONDS unset)
});

// 3 + 5 + 6: does NOT fire immediately; fires the (bounded) injector after the delay.
test('does not fire immediately, and fires the injector after the delay', async () => {
  armIncidentTimer();
  expect(spy).not.toHaveBeenCalled();          // not immediate
  jest.advanceTimersByTime(299 * 1000);
  expect(spy).not.toHaveBeenCalled();          // still not, just before 300s
  await jest.advanceTimersByTimeAsync(2 * 1000);
  expect(spy).toHaveBeenCalledTimes(1);        // fired once, after ~300s
});

// 8: arming is idempotent — no duplicate fuses even if armed twice.
test('arming twice schedules exactly one fuse (no duplicate timers)', async () => {
  armIncidentTimer();
  armIncidentTimer();
  expect(jest.getTimerCount()).toBe(1);
  await jest.advanceTimersByTimeAsync(301 * 1000);
  expect(spy).toHaveBeenCalledTimes(1);         // one fire, not two
});

// 7: reset/cancel disarms a pending fuse — it never fires afterwards.
test('cancel (reset) disarms a pending fuse', async () => {
  armIncidentTimer();
  expect(cancelIncidentTimer()).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(600 * 1000);
  expect(spy).not.toHaveBeenCalled();
  expect(cancelIncidentTimer()).toBe(false);    // nothing left to cancel
});

// 7 (wiring): the /reset route disarms the fuse.
test('the /reset route calls cancelIncidentTimer', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/warroom/routes.js'), 'utf8');
  expect(src).toMatch(/cancelIncidentTimer\(\)/);
});

// 9 + 10: delay is clamped; injector safety bounds remain intact.
test('delay is clamped to safe defaults and injector clamps are intact', () => {
  const withEnv = (v) => {
    jest.resetModules();
    const saved = process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS;
    process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = v;
    const c = require('../src/warroom/config');
    if (saved === undefined) delete process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS;
    else process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = saved;
    return c;
  };
  expect(withEnv('1').delaySeconds).toBe(300);        // below min(5) -> default
  expect(withEnv('999999').delaySeconds).toBe(300);   // above max -> default
  expect(withEnv('30').delaySeconds).toBe(30);        // in-range rehearsal value honored
  const c = withEnv('300');
  expect(c.api4.maxPosts).toBeLessThanOrEqual(2000);
  expect(c.api4.concurrency).toBeLessThanOrEqual(32);
  expect(c.api4.ratePerSec).toBeLessThanOrEqual(200);
  expect(c.api4.maxRuntimeSec).toBeLessThanOrEqual(300);
  expect(c.api4.maxRequests).toBeLessThanOrEqual(50000);
  expect(c.api4.endpoint).toBe('/api/posts');
  jest.resetModules();
});

// 11: INC-001 (Sprint 1) default is unchanged when INC-002 is not selected.
test('INC-001 remains the default when WAR_ROOM_INCIDENT is not INC-002', () => {
  jest.resetModules();
  const saved = process.env.WAR_ROOM_INCIDENT;
  delete process.env.WAR_ROOM_INCIDENT;
  const c = require('../src/warroom/config');
  expect(c.incident).toBe('INC-001');
  expect(c.incidentId).toBe('INC-001');
  if (saved !== undefined) process.env.WAR_ROOM_INCIDENT = saved;
  jest.resetModules();
});
