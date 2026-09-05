/**
 * Comments — creation and the 500-character limit.
 *
 * Mirrors the harness in auth.test.js: a real Postgres is required (start it
 * with `docker compose up -d db`), and every test runs against a truncated
 * database so ids and counts are predictable.
 */
const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');
const { SESSION_COOKIE } = require('../src/auth');

let dbUp = false;
const PW = 'correct-horse-battery-staple';

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

beforeEach(async () => {
  if (!dbUp) return;
  await pool.query('TRUNCATE comments, posts, sessions, users RESTART IDENTITY CASCADE');
});

const need = () => {
  if (!dbUp) throw new Error('Postgres is not running — see the message above.');
};

const cookieFrom = (res) => {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  return raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) || null;
};

async function signedInCookie(email) {
  await request(app).post('/api/auth/register').send({ email, password: PW }).expect(201);
  const res = await request(app).post('/api/auth/login').send({ email, password: PW }).expect(200);
  return cookieFrom(res);
}

async function createPost(cookie) {
  const res = await request(app)
    .post('/api/posts')
    .set('Cookie', cookie)
    .send({ title: 'A security post', content: 'Something worth discussing.' })
    .expect(201);
  return res.body.id;
}

describe('comment character limit', () => {
  test('creates a comment within the character limit', async () => {
    need();
    const cookie = await signedInCookie('commenter@example.test');
    const postId = await createPost(cookie);

    const content = 'a'.repeat(200);
    const res = await request(app)
      .post('/api/comments')
      .set('Cookie', cookie)
      .send({ post_id: postId, content });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe(content);
  });
});
