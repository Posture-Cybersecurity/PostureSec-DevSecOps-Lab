'use strict';

const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const composeFile = path.join(projectRoot, 'docker-compose.yml');
const baseUrl = (process.env.POSTURESEC_BASE_URL || 'http://127.0.0.1').replace(/\/+$/, '');
const startupTimeoutMs = 120_000;

function runCompose(args, { quiet = false } = {}) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw new Error(`Could not run Docker Compose: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = quiet ? (result.stderr || result.stdout).trim() : '';
    throw new Error(
      `docker compose ${args.join(' ')} failed with exit code ${result.status}` +
      (details ? `: ${details}` : '')
    );
  }

  return result;
}

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let data;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  return { response, text, data };
}

function expectStatus(result, expectedStatus, label) {
  if (result.response.status !== expectedStatus) {
    throw new Error(
      `${label}: expected HTTP ${expectedStatus}, got ${result.response.status}` +
      (result.text ? ` — ${result.text}` : '')
    );
  }
}

async function waitFor(label, probe) {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await probe();
      console.log(`PASS ${label}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  throw new Error(
    `Timed out waiting for ${label}` +
    (lastError ? `; last error: ${lastError.message}` : '')
  );
}

async function waitForApi() {
  await waitFor('API health check', async () => {
    const result = await request('/api/health');
    expectStatus(result, 200, 'API health check');
    if (result.data?.status !== 'ok') {
      throw new Error(`Unexpected health response: ${result.text}`);
    }
  });
}

async function main() {
  console.log('Starting PostureSec composed stack...');
  runCompose(['up', '-d', '--build']);

  await waitFor('UI responds with the application', async () => {
    const result = await request('/');
    expectStatus(result, 200, 'UI request');
    if (!result.response.headers.get('content-type')?.includes('text/html') ||
        !result.text.includes('id="root"')) {
      throw new Error('UI response is not the PostureSec HTML application');
    }
  });
  await waitForApi();

  const uniqueId = randomUUID();
  const email = `smoke-${uniqueId}@example.test`;
  const password = `Smoke-${uniqueId}-Aa9!`;

  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password },
  });
  expectStatus(registration, 201, 'Register smoke-test user');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  expectStatus(login, 200, 'Log in smoke-test user');
  const setCookie = login.response.headers.get('set-cookie');
  const cookie = setCookie?.split(';', 1)[0];
  if (!cookie?.startsWith('psec_session=')) {
    throw new Error('Login response did not include a PostureSec session cookie');
  }

  const title = `PostureSec persistence smoke test ${uniqueId}`;
  const content = `Database persistence probe ${uniqueId}`;
  const created = await request('/api/posts', {
    method: 'POST',
    cookie,
    body: { title, content, author: 'Smoke Test' },
  });
  expectStatus(created, 201, 'Create persistence probe post');
  if (!created.data?.id) {
    throw new Error(`Create post response did not include an id: ${created.text}`);
  }
  console.log(`PASS database write created post ${created.data.id}`);

  console.log('Recreating the database container without removing its named volume...');
  runCompose(['up', '-d', '--force-recreate', 'db']);
  await waitFor('database readiness after container recreation', async () => {
    const result = runCompose(
      ['exec', '-T', 'db', 'pg_isready', '-U', 'posturesec_user', '-d', 'posturesec_db'],
      { quiet: true }
    );
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout).trim() || 'PostgreSQL is not ready');
    }
  });
  await waitForApi();

  const persisted = await request(`/api/posts/${encodeURIComponent(created.data.id)}`);
  expectStatus(persisted, 200, 'Read persistence probe after database recreation');
  if (persisted.data?.id !== created.data.id ||
      persisted.data?.title !== title ||
      persisted.data?.content !== content) {
    throw new Error('The post retrieved after database recreation did not match the write');
  }
  console.log('PASS database write persisted across database-container recreation');
  console.log(`Smoke test passed. Stack remains running at ${baseUrl}`);
}

main().catch((error) => {
  console.error(`\nPostureSec smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
