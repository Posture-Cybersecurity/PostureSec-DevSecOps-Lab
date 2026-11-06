/**
 * War Room (Sprint 1) — the squad's success criterion.
 *
 * This is the target the squad's fix must satisfy. It is RED on the vulnerable
 * starting state and GREEN once object-level authorization is enforced
 * server-side. It is gated behind WARROOM_REMEDIATION so it does not turn the
 * default `npm test` red before the exercise is solved:
 *
 *     WARROOM_REMEDIATION=1 npx jest tests/warroom_remediation.test.js
 *
 * or `npm run test:remediation`.
 *
 * POSITIVE   — an owner may act on their own post/comment.
 * NEGATIVE   — a user may NOT act on another user's post/comment (403).
 * SECURITY   — anonymous callers are refused (401); missing objects are 404.
 * REGRESSION — reads stay public; a fixed route still lets the owner through.
 */
process.env.WAR_ROOM_ENABLED = 'true';
process.env.WAR_ROOM_INCIDENT_DELAY_SECONDS = '86400';
process.env.PORT = process.env.WARROOM_TEST_PORT || '5098';
process.env.WAR_ROOM_SELF_URL = `http://127.0.0.1:${process.env.PORT}`;

const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');

const RUN = process.env.WARROOM_REMEDIATION === '1';
const d = RUN ? describe : describe.skip;

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
    await new Promise((resolve) => { server = app.listen(process.env.PORT, '127.0.0.1', resolve); });
  } catch (err) {
    console.error('DATABASE UNREACHABLE: ' + err.message);
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

d('object-level authorization on posts', () => {
  test('POSITIVE: an owner may edit and delete their own post', async () => {
    need();
    const owner = await registerAndLogin('owner-a@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'Mine', content: 'Body' });
    const id = created.body.id;
    expect((await request(server).put(`/api/posts/${id}`).set('Cookie', owner.cookie)
      .send({ title: 'Mine v2', content: 'Body v2' })).status).toBe(200);
    expect((await request(server).delete(`/api/posts/${id}`).set('Cookie', owner.cookie)).status).toBe(200);
  });

  test('NEGATIVE: a different user may NOT edit another user\'s post', async () => {
    need();
    const owner = await registerAndLogin('owner-b@warroom.test');
    const other = await registerAndLogin('other-b@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'Owned', content: 'Secret-ish' });
    const id = created.body.id;

    const res = await request(server).put(`/api/posts/${id}`).set('Cookie', other.cookie)
      .send({ title: 'Hijacked', content: 'Overwritten' });
    expect(res.status).toBe(403);

    // And the content is untouched — the refusal actually protected the object.
    const still = await request(server).get(`/api/posts/${id}`);
    expect(still.body.title).toBe('Owned');
  });

  test('NEGATIVE: a different user may NOT delete another user\'s post', async () => {
    need();
    const owner = await registerAndLogin('owner-c@warroom.test');
    const other = await registerAndLogin('other-c@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'Keep', content: 'Body' });
    const id = created.body.id;
    expect((await request(server).delete(`/api/posts/${id}`).set('Cookie', other.cookie)).status).toBe(403);
    expect((await request(server).get(`/api/posts/${id}`)).status).toBe(200); // still there
  });

  test('SECURITY: anonymous callers are refused (401), missing objects are 404', async () => {
    need();
    const owner = await registerAndLogin('owner-d@warroom.test');
    const created = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'X', content: 'Y' });
    const id = created.body.id;
    expect((await request(server).put(`/api/posts/${id}`).send({ title: 'a', content: 'b' })).status).toBe(401);
    expect((await request(server).put('/api/posts/999999').set('Cookie', owner.cookie)
      .send({ title: 'a', content: 'b' })).status).toBe(404);
    expect((await request(server).delete('/api/posts/999999').set('Cookie', owner.cookie)).status).toBe(404);
  });
});

d('object-level authorization on comments', () => {
  test('NEGATIVE: a different user may NOT delete another user\'s comment', async () => {
    need();
    const owner = await registerAndLogin('owner-e@warroom.test');
    const other = await registerAndLogin('other-e@warroom.test');
    const post = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'P', content: 'C' });
    const comment = await request(server).post('/api/comments').set('Cookie', owner.cookie)
      .send({ post_id: post.body.id, content: 'my comment' });
    const res = await request(server).delete(`/api/comments/${comment.body.id}`).set('Cookie', other.cookie);
    expect(res.status).toBe(403);
  });

  test('POSITIVE: an owner may delete their own comment', async () => {
    need();
    const owner = await registerAndLogin('owner-f@warroom.test');
    const post = await request(server).post('/api/posts').set('Cookie', owner.cookie)
      .send({ title: 'P', content: 'C' });
    const comment = await request(server).post('/api/comments').set('Cookie', owner.cookie)
      .send({ post_id: post.body.id, content: 'mine' });
    expect((await request(server).delete(`/api/comments/${comment.body.id}`).set('Cookie', owner.cookie)).status).toBe(200);
  });
});
