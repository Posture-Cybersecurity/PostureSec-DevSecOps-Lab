/**
 * A worked example of the test harness.
 *
 * Kept deliberately small: it exists so you can see how a test reaches the API
 * (Supertest drives the exported Express app directly — no server to start) and
 * how the suite behaves when Postgres is not running.
 *
 * Several tasks ask you to prove a change with a test. Model them on this.
 */
const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');

let dbUp = false;

beforeAll(async () => {
  try {
    await initDB();
    dbUp = true;
  } catch (err) {
    console.error(
      '\n  DATABASE UNREACHABLE — these tests cannot run.\n' +
      '  Start it first:  docker compose up -d db\n' +
      `  Driver said: ${err.message}\n`
    );
  }
});

afterAll(async () => {
  if (dbUp) await pool.end();
});

describe('GET /api/health', () => {
  test('reports the API is operational', async () => {
    if (!dbUp) throw new Error('Postgres is not running — see the message above.');
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
