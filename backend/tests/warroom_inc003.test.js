/**
 * War Room INC-003 (Sprint 3 / DSO-W3 — "the image is compromised").
 *
 * Two layers of test:
 *   - Pure, always-run: the canary DETECTOR and safety guards. No DB, no Docker.
 *   - DB-gated (skipped cleanly without Postgres): the HTTP incident surface —
 *     activation, the operational alert, and the hard rule that NO root cause or
 *     secret value ever reaches a learner-facing response.
 *
 * The image-layer forensics (RED→GREEN, secret recoverable from layers) are a
 * separate, real check: warroom/inc003/verify.sh. They are not duplicated here.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Select INC-003 and point the detector at a temp canary BEFORE requiring config.
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT = 'INC-003';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '86400'; // never auto-fire during tests
process.env.WAR_ROOM_INSTRUCTOR_TOKEN = 'inc003-test-token';
process.env.PORT = process.env.WARROOM_INC003_TEST_PORT || '5097';

const TMP = path.join(os.tmpdir(), `inc003-canary-${process.pid}.env`);
process.env.WAR_ROOM_INC003_CANARY_PATH = TMP;

const MARKER = 'WARROOM_FAKE_SECRET_a1b2c3d4e5f6';
const FORBIDDEN = ['.dockerignore', 'COPY ', 'Dockerfile', `${MARKER}_training_only`];

const config = require('../src/warroom/config');
const injector = require('../src/warroom/injector_image_compromised');

afterAll(() => { try { fs.unlinkSync(TMP); } catch (_e) {} });

describe('INC-003 canary detector (pure, no DB)', () => {
  test('config selects INC-003 and a synthetic, clearly-fake marker', () => {
    expect(config.incidentId).toBe('INC-003');
    expect(config.inc003.marker).toBe(MARKER);
    // Guard: the training value must never look like a real credential.
    expect(config.inc003.marker.toUpperCase()).toContain('FAKE');
    expect(config.inc003.imageRef).not.toMatch(/ghcr\.io|amazonaws|\.azurecr\./);
  });

  test('detects the canary when the file exists and contains the marker', () => {
    fs.writeFileSync(TMP, `WARROOM_FAKE_SECRET=${MARKER}_training_only_not_a_real_key\n`);
    expect(injector.detectCanary().present).toBe(true);
  });

  test('does NOT detect when the file is absent', () => {
    try { fs.unlinkSync(TMP); } catch (_e) {}
    expect(injector.detectCanary().present).toBe(false);
  });

  test('does NOT detect when the file exists but lacks the marker', () => {
    fs.writeFileSync(TMP, 'SOME_OTHER_CONFIG=value\n');
    expect(injector.detectCanary().present).toBe(false);
  });

  test('no real-credential patterns anywhere in the INC-003 source/config', () => {
    const files = [
      '../src/warroom/injector_image_compromised.js',
      '../src/warroom/config.js',
    ].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
    expect(files).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);          // GitHub PAT
    expect(files).not.toMatch(/AKIA[0-9A-Z]{16}/);              // AWS key
    expect(files).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY/); // private key
  });
});

// ---------------------------------------------------------------------------
// HTTP incident surface — needs Postgres (the incident state table). Skips
// cleanly without it, exactly like the other war-room suites.
// ---------------------------------------------------------------------------
const request = require('supertest');
let dbUp = false;
let app;
let server;

beforeAll(async () => {
  try {
    const { initDB } = require('../src/db');
    await initDB();
    // The app only creates the war-room tables inside its start() path, which a
    // require() does not run — so create them explicitly for the test, exactly as
    // the server boot would.
    await require('../src/warroom/state').initWarRoom();
    app = require('../src/index');
    server = app.listen(0);
    dbUp = true;
  } catch (_e) {
    dbUp = false;
  }
});
afterAll((done) => { if (server) server.close(done); else done(); });

const dbTest = (name, fn) => test(name, async () => {
  if (!dbUp) { console.warn(`[skip:no-db] ${name}`); return; }
  await fn();
});

describe('INC-003 HTTP surface (DB-gated)', () => {
  const tok = { 'x-warroom-token': 'inc003-test-token' };

  dbTest('vulnerable image: trigger raises the alert, no root cause leaks', async () => {
    fs.writeFileSync(TMP, `WARROOM_FAKE_SECRET=${MARKER}_training_only_not_a_real_key\n`);
    const trig = await request(server).post('/api/incident/trigger').set(tok);
    expect(trig.status).toBe(200);
    expect(trig.body.detected).toBe(true);

    const status = await request(server).get('/api/incident/status');
    expect(status.body.active).toBe(true);
    expect(status.body.headline).toBeTruthy();

    const brief = await request(server).get('/api/incident');
    expect(brief.body.brief).toMatch(/credential material/i);
    expect(brief.body.severity).toBe('HIGH');
    // The whole learner-facing payload must never reveal the cause or the value.
    const blob = JSON.stringify({ ...status.body, ...brief.body });
    for (const bad of FORBIDDEN) expect(blob).not.toContain(bad);
    expect(blob).not.toContain(`${MARKER}_training_only`);

    await request(server).post('/api/incident/reset').set(tok);
  });

  dbTest('remediated image: trigger detects nothing, no alarm raised', async () => {
    await request(server).post('/api/incident/reset').set(tok);
    try { fs.unlinkSync(TMP); } catch (_e) {}            // corrected image: no canary
    const trig = await request(server).post('/api/incident/trigger').set(tok);
    expect(trig.status).toBe(200);
    expect(trig.body.detected).toBe(false);
    const status = await request(server).get('/api/incident/status');
    expect(status.body.active).toBe(false);
  });

  dbTest('instructor controls are token-gated', async () => {
    const noTok = await request(server).post('/api/incident/trigger');
    expect(noTok.status).toBe(403);
  });
});
