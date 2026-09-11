// Dev-server configuration contract.
//
// THE DEFECT THIS PINS. `vite.config.js` read `process.env.LAB_FRONTEND_PORT`
// directly. Vite does not copy .env files into process.env — it parses them
// itself and exposes only `VITE_`-prefixed keys to client code — so a
// frontend/.env holding LAB_FRONTEND_PORT=3900 was silently ignored and the
// learner default of 3000 won. The values were correct; the delivery mechanism
// was not, and the failure was silent: the dev server started happily on the
// wrong port, pointing at the wrong API.
//
// Run with `npm test` in frontend/. Uses Node's built-in test runner, so it
// adds no dependency to a teaching repository.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadEnv } from 'vite';

import config, { LEARNER_DEFAULTS, resolveLabServer } from './vite.config.js';

const CONFIG_DIR = fileURLToPath(new URL('.', import.meta.url));

/** A throwaway directory holding one .env, so the test never depends on
 *  whether this particular clone happens to have one. */
function envDirContaining(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'lab-vite-env-'));
  writeFileSync(join(dir, '.env'), contents);
  return dir;
}

// ----------------------------------------------------- learner defaults

test('a learner who sets nothing gets 3000 and localhost:5000', () => {
  const { port, apiTarget } = resolveLabServer({});
  assert.equal(port, 3000);
  assert.equal(apiTarget, 'http://localhost:5000');
});

test('the learner defaults are the documented ones', () => {
  assert.equal(LEARNER_DEFAULTS.port, 3000);
  assert.equal(LEARNER_DEFAULTS.apiTarget, 'http://localhost:5000');
});

test('a blank or unparseable value falls back rather than binding port 0', () => {
  for (const bad of ['', '   ', 'not-a-number', undefined, null]) {
    assert.equal(resolveLabServer({ LAB_FRONTEND_PORT: bad }).port, 3000);
  }
  for (const bad of ['', undefined, null]) {
    assert.equal(resolveLabServer({ LAB_API_TARGET: bad }).apiTarget,
      'http://localhost:5000');
  }
});

// -------------------------------------------------- instructor overrides

test('instructor values are honoured when present', () => {
  const { port, apiTarget } = resolveLabServer({
    LAB_FRONTEND_PORT: '3900',
    LAB_API_TARGET: 'http://localhost:5900',
  });
  assert.equal(port, 3900);
  assert.equal(apiTarget, 'http://localhost:5900');
});

test('each override is independent of the other', () => {
  assert.deepEqual(resolveLabServer({ LAB_FRONTEND_PORT: '3900' }),
    { port: 3900, apiTarget: 'http://localhost:5000' });
  assert.deepEqual(resolveLabServer({ LAB_API_TARGET: 'http://localhost:5900' }),
    { port: 3000, apiTarget: 'http://localhost:5900' });
});

// ------------------------------------------- the .env delivery mechanism

test('values in a .env file reach the config (the bug that was fixed)', () => {
  const dir = envDirContaining(
    'LAB_FRONTEND_PORT=3900\nLAB_API_TARGET=http://localhost:5900\n');
  const env = loadEnv('development', dir, '');
  assert.deepEqual(resolveLabServer(env),
    { port: 3900, apiTarget: 'http://localhost:5900' });
});

test('the empty prefix is required — the default VITE_ would not match', () => {
  const dir = envDirContaining('LAB_FRONTEND_PORT=3900\n');
  // This is precisely why loadEnv must be called with '' rather than left on
  // its default: with the default prefix these names are invisible.
  assert.equal(loadEnv('development', dir).LAB_FRONTEND_PORT, undefined);
  assert.equal(loadEnv('development', dir, '').LAB_FRONTEND_PORT, '3900');
});

// ------------------------------------------------------ the real config

test('the config is mode-aware, so it can load an env at all', () => {
  assert.equal(typeof config, 'function',
    'config must take ({ mode }) — a static object cannot call loadEnv');
});

test('the real config resolves from the loaded env, not from process.env', () => {
  const resolved = config({ mode: 'development', command: 'serve' });
  const expected = resolveLabServer(loadEnv('development', CONFIG_DIR, ''));
  assert.equal(resolved.server.port, expected.port);
  assert.equal(resolved.server.proxy['/api'].target, expected.apiTarget);
  assert.equal(resolved.preview.port, expected.port,
    'preview must follow the same port as the dev server');
});

test('the dev server still fails loudly rather than sliding to a free port', () => {
  const resolved = config({ mode: 'development', command: 'serve' });
  assert.equal(resolved.server.strictPort, true);
  assert.equal(resolved.preview.strictPort, true);
});

// ---------------------------------------------------- regression guards

test('the config no longer reads process.env for these keys', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(CONFIG_DIR, 'vite.config.js'), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/process\.env\.LAB_/.test(code),
    'reading process.env.LAB_* is the bug: .env never reaches process.env');
  assert.ok(/loadEnv\(/.test(code), 'the config must use Vite loadEnv');
});

test('the instructor values are never exposed to the browser', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(CONFIG_DIR, 'vite.config.js'), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  // These are dev-server settings. Putting them in `define`, or renaming them
  // to VITE_*, would ship an instructor's local topology to every browser.
  assert.ok(!/define\s*:/.test(code), 'nothing here belongs in define');
  assert.ok(!/VITE_LAB_/.test(code), 'do not expose these as client variables');
  assert.ok(!/envPrefix/.test(code), 'client exposure must stay on the default');
});

test('no instructor port is hardcoded as a default', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(CONFIG_DIR, 'vite.config.js'), 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  for (const instructorOnly of ['3900', '5900', '55900']) {
    assert.ok(!code.includes(instructorOnly),
      `${instructorOnly} must come from the environment, never from the file`);
  }
});
