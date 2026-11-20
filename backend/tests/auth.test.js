/**
 * Authentication must work correctly.
 *
 * Everything asserted here is about WHO the caller is: registration, login,
 * session lifetime, revocation, cookie flags and role.
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

async function registerAndLogin(email) {
  await request(app).post('/api/auth/register').send({ email, password: PW }).expect(201);
  const res = await request(app).post('/api/auth/login').send({ email, password: PW }).expect(200);
  return { cookie: cookieFrom(res), user: res.body };
}

describe('registration', () => {
  test('creates a user and never returns the password hash', async () => {
    need();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'ada@example.test', password: PW });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('ada@example.test');
    expect(res.body.role).toBe('user');
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|\$2[aby]\$/i);
  });

  test('rejects a short password', async () => {
    need();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.test', password: 'tooshort' });
    expect(res.status).toBe(400);
  });

  test('rejects a malformed email', async () => {
    need();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: PW });
    expect(res.status).toBe(400);
  });

  test('rejects a duplicate email', async () => {
    need();
    await request(app).post('/api/auth/register').send({ email: 'dup@example.test', password: PW });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.test', password: PW });
    expect(res.status).toBe(409);
  });

  test('stores a bcrypt hash, never the plaintext', async () => {
    need();
    await request(app).post('/api/auth/register').send({ email: 'h@example.test', password: PW });
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', ['h@example.test']);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(rows[0].password_hash).not.toContain(PW);
  });
});

describe('login and session creation', () => {
  test('valid credentials issue a session cookie', async () => {
    need();
    const { cookie } = await registerAndLogin('login@example.test');
    expect(cookie).toBeTruthy();
  });

  test('the session id is opaque and high-entropy', async () => {
    need();
    const email = 'entropy@example.test';
    await request(app).post('/api/auth/register').send({ email, password: PW }).expect(201);
    await request(app).post('/api/auth/login').send({ email, password: PW }).expect(200);
    await request(app).post('/api/auth/login').send({ email, password: PW }).expect(200);

    const { rows } = await pool.query('SELECT id, user_id FROM sessions ORDER BY created_at');
    expect(rows).toHaveLength(2);

    // 32 bytes rendered as hex.
    rows.forEach((r) => expect(r.id).toMatch(/^[0-9a-f]{64}$/));

    // Opaque means "not derived from the subject": two sessions for the SAME
    // user must be unrelated. Substring-matching the user id would be a
    // meaningless assertion — random hex contains most digits by chance.
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows[0].user_id).toBe(rows[1].user_id);

    // And no shared prefix, which a counter or timestamp-derived id would show.
    expect(rows[0].id.slice(0, 8)).not.toBe(rows[1].id.slice(0, 8));
  });

  test('a wrong password is refused, and no session is created', async () => {
    need();
    await request(app).post('/api/auth/register').send({ email: 'wp@example.test', password: PW });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wp@example.test', password: 'wrong-password-entirely' });
    expect(res.status).toBe(401);
    expect(cookieFrom(res)).toBeNull();
    const { rows } = await pool.query('SELECT * FROM sessions');
    expect(rows).toHaveLength(0);
  });

  test('an unknown account is refused with the same message — no enumeration', async () => {
    need();
    await request(app).post('/api/auth/register').send({ email: 'known@example.test', password: PW });
    const wrongPw = await request(app)
      .post('/api/auth/login').send({ email: 'known@example.test', password: 'nope-nope-nope' });
    const noUser = await request(app)
      .post('/api/auth/login').send({ email: 'ghost@example.test', password: 'nope-nope-nope' });
    expect(wrongPw.status).toBe(noUser.status);
    expect(wrongPw.body.error).toBe(noUser.body.error);
  });
});

describe('cookie security', () => {
  test('the session cookie is HttpOnly, SameSite=Strict and scoped to /', async () => {
    need();
    const { cookie } = await registerAndLogin('cookie@example.test');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  test('Secure is set only in production', async () => {
    need();
    // NODE_ENV is not 'production' under test, so the lab works over plain http.
    const { cookie } = await registerAndLogin('sec@example.test');
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });
});

describe('authentication middleware', () => {
  test('/api/auth/me is 401 without a session', async () => {
    need();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('/api/auth/me returns the caller with a valid session', async () => {
    need();
    const { cookie } = await registerAndLogin('me@example.test');
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@example.test');
  });

  test('a forged session id is rejected', async () => {
    need();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${'f'.repeat(64)}`);
    expect(res.status).toBe(401);
  });

  test('writing requires authentication', async () => {
    need();
    const res = await request(app).post('/api/posts').send({ title: 'x', content: 'y' });
    expect(res.status).toBe(401);
  });

  test('reading does not require authentication', async () => {
    need();
    expect((await request(app).get('/api/posts')).status).toBe(200);
  });
});

describe('logout and revocation', () => {
  test('logout revokes the session server-side, not just in the browser', async () => {
    need();
    const { cookie } = await registerAndLogin('logout@example.test');
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);

    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);

    // The decisive assertion: replaying the same cookie must now fail. This is
    // what a stateless token could not give us without extra machinery.
    const replay = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(replay.status).toBe(401);

    const { rows } = await pool.query('SELECT revoked_at FROM sessions');
    expect(rows[0].revoked_at).not.toBeNull();
  });

  test('an expired session is refused', async () => {
    need();
    const { cookie } = await registerAndLogin('exp@example.test');
    await pool.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute'");
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  test('logging out one session does not affect another', async () => {
    need();
    const email = 'two@example.test';
    await request(app).post('/api/auth/register').send({ email, password: PW }).expect(201);
    const one = cookieFrom(await request(app).post('/api/auth/login').send({ email, password: PW }));
    const two = cookieFrom(await request(app).post('/api/auth/login').send({ email, password: PW }));

    await request(app).post('/api/auth/logout').set('Cookie', one).expect(200);
    expect((await request(app).get('/api/auth/me').set('Cookie', one)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', two)).status).toBe(200);
  });
});

describe('roles', () => {
  test('new users default to the user role', async () => {
    need();
    const { user } = await registerAndLogin('role@example.test');
    expect(user.role).toBe('user');
  });

  test('the role travels with the session', async () => {
    need();
    const { cookie } = await registerAndLogin('admin@example.test');
    await pool.query("UPDATE users SET role = 'admin' WHERE email = 'admin@example.test'");
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.body.role).toBe('admin');
  });
});
