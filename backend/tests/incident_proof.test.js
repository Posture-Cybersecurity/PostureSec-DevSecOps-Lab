process.env.PORT = process.env.WARROOM_TEST_PORT || '5100';

const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');

const PW = 'correct-horse-battery-staple';
let dbUp = false;
let server;

const cookieFrom = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('psec_session=')) || null;

async function registerAndLogin(email) {
  await request(server).post('/api/auth/register').send({ email, password: PW });
  const res = await request(server).post('/api/auth/login').send({ email, password: PW });
  return { cookie: cookieFrom(res), id: res.body.id };
}

beforeAll(async () => {
  try {
    await initDB();
    dbUp = true;
    await new Promise((resolve) => {
      server = app.listen(process.env.PORT, '127.0.0.1', resolve);
    });
  } catch (err) {
    console.error('DATABASE UNREACHABLE:', err.message);
  }
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (dbUp) await pool.end();
});

beforeEach(async () => {
  if (!dbUp) return;
  await pool.query('TRUNCATE comments, posts, sessions, users RESTART IDENTITY CASCADE');
});

const need = () => { if (!dbUp) throw new Error('Postgres is not running'); };

describe('incident proof: object-level authorization', () => {
  test('positive: owner can update own post', async () => {
    need();
    const owner = await registerAndLogin('owner-a@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'Mine', content: 'Body' });

    expect(created.status).toBe(201);

    const updated = await request(server).put(`/api/posts/${created.body.id}`).set('Cookie', owner.cookie)
      .send({ title: 'Mine v2', content: 'Body v2' });

    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('Mine v2');
  });

  test('negative: different user cannot modify someone else\'s post', async () => {
    need();
    const owner = await registerAndLogin('owner-b@warroom.test');
    const other = await registerAndLogin('other-b@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'Owned', content: 'Secret-ish' });

    const res = await request(server).put(`/api/posts/${created.body.id}`).set('Cookie', other.cookie)
      .send({ title: 'Hijacked', content: 'Overwritten' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');

    const still = await request(server).get(`/api/posts/${created.body.id}`);
    expect(still.body.title).toBe('Owned');
  });

  test('security: unauthenticated caller is refused', async () => {
    need();
    const owner = await registerAndLogin('owner-c@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'X', content: 'Y' });

    const anon = await request(server).put(`/api/posts/${created.body.id}`).send({ title: 'a', content: 'b' });
    expect(anon.status).toBe(401);
    expect(anon.body.error).toMatch(/Authentication required/i);
  });

  test('regression: public reads and normal blogging still work', async () => {
    need();
    const owner = await registerAndLogin('owner-d@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'Read me', content: 'Visible' });

    const list = await request(server).get('/api/posts');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);

    const readBack = await request(server).get(`/api/posts/${created.body.id}`);
    expect(readBack.status).toBe(200);
    expect(readBack.body.title).toBe('Read me');
  });
});
