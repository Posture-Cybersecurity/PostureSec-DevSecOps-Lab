const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const {
  validateRegistrationInput,
  validateLoginInput,
  authenticateUser,
  registerUser,
} = require('../src/auth');

describe('auth input validation helpers', () => {
  test('registration rejects malformed email', () => {
    expect(validateRegistrationInput('not-an-email', 'correct-horse-battery-staple')).toEqual({
      ok: false,
      status: 400,
      error: 'A valid email is required',
    });
  });

  test('registration rejects short passwords', () => {
    expect(validateRegistrationInput('user@example.test', 'short')).toEqual({
      ok: false,
      status: 400,
      error: 'Password must be at least 12 characters',
    });
  });

  test('registration accepts valid input', () => {
    expect(validateRegistrationInput('user@example.test', 'correct-horse-battery-staple')).toEqual({
      ok: true,
    });
  });

  test('login rejects missing credentials', () => {
    expect(validateLoginInput('', 'correct-horse-battery-staple')).toEqual({
      ok: false,
      status: 400,
      error: 'Email and password are required',
    });
  });

  test('login accepts valid credentials shape', () => {
    expect(validateLoginInput('user@example.test', 'correct-horse-battery-staple')).toEqual({
      ok: true,
    });
  });
});

describe('registerUser helper', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('rejects invalid registration inputs before touching the DB', async () => {
    const result = await registerUser('bad-email', 'short');

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'A valid email is required',
    });
  });

  test('creates a user row and returns it for valid input', async () => {
    jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [{ id: 9, email: 'new@example.test', role: 'user', created_at: new Date() }],
    });

    const result = await registerUser('NEW@EXAMPLE.TEST', 'correct-horse-battery-staple');

    expect(result.ok).toBe(true);
    expect(result.user).toMatchObject({
      id: 9,
      email: 'new@example.test',
      role: 'user',
    });
  });
});

describe('authenticateUser helper', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('rejects a wrong password before creating a session', async () => {
    const hash = await bcrypt.hash('correct-horse-battery-staple', 10);
    jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [{ id: 7, email: 'me@example.test', role: 'user', password_hash: hash }],
    });

    const result = await authenticateUser('me@example.test', 'wrong-password');

    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid email or password' });
  });

  test('creates a session for valid credentials', async () => {
    const hash = await bcrypt.hash('correct-horse-battery-staple', 10);
    jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ id: 7, email: 'me@example.test', role: 'user', password_hash: hash }],
      })
      .mockResolvedValueOnce({});

    const result = await authenticateUser('me@example.test', 'correct-horse-battery-staple');

    expect(result.ok).toBe(true);
    expect(result.user).toMatchObject({ id: 7, email: 'me@example.test', role: 'user' });
    expect(result.session).toMatchObject({ id: expect.any(String), expiresAt: expect.any(Date) });
  });
});
