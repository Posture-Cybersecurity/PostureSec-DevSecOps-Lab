const request = require('supertest');
const { pool, initDB } = require('../src/db');
const app = require('../src/index');

const ownerCookie = 'psec_session=owner-session';
const otherCookie = 'psec_session=other-session';

let postId;
let commentId;

beforeAll(async () => {
  await initDB();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE comments, posts, sessions, users RESTART IDENTITY CASCADE');

  const owner = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ('owner@example.test', 'unused')
     RETURNING id`
  );
  const other = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ('other@example.test', 'unused')
     RETURNING id`
  );

  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ('owner-session', $1, NOW() + INTERVAL '1 hour'),
            ('other-session', $2, NOW() + INTERVAL '1 hour')`,
    [owner.rows[0].id, other.rows[0].id]
  );

  const post = await pool.query(
    `INSERT INTO posts (title, content, author, owner_id)
     VALUES ('Owner post', 'Original content', 'Owner', $1)
     RETURNING id`,
    [owner.rows[0].id]
  );
  postId = post.rows[0].id;

  const comment = await pool.query(
    `INSERT INTO comments (post_id, content, owner_id)
     VALUES ($1, 'Owner comment', $2)
     RETURNING id`,
    [postId, owner.rows[0].id]
  );
  commentId = comment.rows[0].id;
});

describe('object ownership', () => {
  test('a different user cannot update a post', async () => {
    await request(app)
      .put(`/api/posts/${postId}`)
      .set('Cookie', otherCookie)
      .send({ title: 'Tampered', content: 'Changed by another user' })
      .expect(404);

    const { rows } = await pool.query('SELECT title, content FROM posts WHERE id = $1', [postId]);
    expect(rows[0]).toEqual({ title: 'Owner post', content: 'Original content' });
  });

  test('the post owner can update their post', async () => {
    await request(app)
      .put(`/api/posts/${postId}`)
      .set('Cookie', ownerCookie)
      .send({ title: 'Updated', content: 'Changed by owner' })
      .expect(200);

    const { rows } = await pool.query('SELECT title, content FROM posts WHERE id = $1', [postId]);
    expect(rows[0]).toEqual({ title: 'Updated', content: 'Changed by owner' });
  });

  test('a different user cannot delete a post', async () => {
    await request(app)
      .delete(`/api/posts/${postId}`)
      .set('Cookie', otherCookie)
      .expect(404);

    const { rowCount } = await pool.query('SELECT id FROM posts WHERE id = $1', [postId]);
    expect(rowCount).toBe(1);
  });

  test('the post owner can delete their post', async () => {
    await request(app)
      .delete(`/api/posts/${postId}`)
      .set('Cookie', ownerCookie)
      .expect(200);

    const { rowCount } = await pool.query('SELECT id FROM posts WHERE id = $1', [postId]);
    expect(rowCount).toBe(0);
  });

  test('a different user cannot delete a comment', async () => {
    await request(app)
      .delete(`/api/comments/${commentId}`)
      .set('Cookie', otherCookie)
      .expect(404);

    const { rowCount } = await pool.query('SELECT id FROM comments WHERE id = $1', [commentId]);
    expect(rowCount).toBe(1);
  });

  test('the comment owner can delete their comment', async () => {
    await request(app)
      .delete(`/api/comments/${commentId}`)
      .set('Cookie', ownerCookie)
      .expect(200);

    const { rowCount } = await pool.query('SELECT id FROM comments WHERE id = $1', [commentId]);
    expect(rowCount).toBe(0);
  });
});
