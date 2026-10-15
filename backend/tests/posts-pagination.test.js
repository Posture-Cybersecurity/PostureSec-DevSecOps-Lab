const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');

let dbUp = false;

beforeAll(async () => {
  await initDB();
  dbUp = true;
});

afterAll(async () => {
  if (dbUp) await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE comments, posts RESTART IDENTITY CASCADE');
  await pool.query(`
    INSERT INTO posts (title, content, author, created_at)
    SELECT 'Post ' || n, 'Content ' || n, 'Author',
           TIMESTAMP '2026-01-01 00:00:00' + n * INTERVAL '1 minute'
    FROM generate_series(1, 25) AS n
  `);
});

describe('GET /api/posts pagination', () => {
  test('returns the default page with complete metadata and correct comment counts', async () => {
    await pool.query(
      `INSERT INTO comments (post_id, content)
       SELECT 25, 'Comment ' || n FROM generate_series(1, 2) AS n`
    );

    const res = await request(app)
      .get('/api/posts')
      .set('X-Forwarded-For', '192.0.2.10');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 10,
      totalCount: 25,
      totalPages: 3,
    });
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data[0].id).toBe(25);
    expect(res.body.data[0].comment_count).toBe('2');
  });

  test('applies the requested page using the calculated database offset', async () => {
    const res = await request(app)
      .get('/api/posts?page=2&limit=10')
      .set('X-Forwarded-For', '192.0.2.15');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      page: 2,
      limit: 10,
      totalCount: 25,
      totalPages: 3,
    });
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data[0].id).toBe(15);
    expect(res.body.data[9].id).toBe(6);
  });

  test('applies the requested page and permits the maximum page size', async () => {
    const res = await request(app)
      .get('/api/posts?page=1&limit=50')
      .set('X-Forwarded-For', '192.0.2.11');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      page: 1,
      limit: 50,
      totalCount: 25,
      totalPages: 1,
    });
    expect(res.body.data).toHaveLength(25);
  });

  test('rejects page sizes above the maximum', async () => {
    const res = await request(app)
      .get('/api/posts?limit=51')
      .set('X-Forwarded-For', '192.0.2.14');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit must not exceed 50/);
  });

  test('rejects invalid or unsafe pagination values', async () => {
    for (const query of ['?page=0', '?page=1.5', '?page=9007199254740992', '?limit=-1']) {
      const res = await request(app)
        .get(`/api/posts${query}`)
        .set('X-Forwarded-For', '192.0.2.12');
      expect(res.status).toBe(400);
    }
  });

  test('rate limits bursts for the same client', async () => {
    const responses = await Promise.all(
      Array.from({ length: 65 }, () =>
        request(app)
          .get('/api/posts')
          .set('X-Forwarded-For', '192.0.2.13')
      )
    );

    expect(responses.some((res) => res.status === 429)).toBe(true);
    expect(responses.filter((res) => res.status === 200).length).toBeLessThanOrEqual(60);
  });
});
