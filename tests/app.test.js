import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../server/db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() }
}));

vi.mock('../server/auth/local.js', () => ({
  registerAccount: vi.fn(),
  authenticateAccount: vi.fn(),
  createSession: vi.fn(),
  revokeCurrentSession: vi.fn(),
  requireLocalAuth: (req, res, next) => {
    req.account = {
      id: 'acct-1',
      email: 'user@example.com',
      display_name: 'Test User',
      role: 'user',
      email_verified: false
    };
    next();
  },
  clearSessionCookie: vi.fn()
}));

vi.mock('../server/auth/email-verification.js', () => ({
  createVerificationToken: vi.fn().mockResolvedValue(null),
  sendVerificationEmail: vi.fn(),
  verifyEmailToken: vi.fn()
}));

import app from '../server/app.js';
import {
  registerAccount,
  authenticateAccount,
  createSession,
  revokeCurrentSession
} from '../server/auth/local.js';
import {
  createVerificationToken,
  sendVerificationEmail,
  verifyEmailToken
} from '../server/auth/email-verification.js';

const origin = 'http://localhost:5173';
const account = {
  id: 'acct-1',
  email: 'user@example.com',
  display_name: 'Test User',
  role: 'user',
  email_verified: false
};

afterEach(() => vi.clearAllMocks());

describe('MusicHub authentication API', () => {
  it('rejects invalid registration input', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: 'invalid', password: 'short', displayName: 'A' });

    expect(response.status).toBe(400);
    expect(registerAccount).not.toHaveBeenCalled();
  });

  it('registers a valid account and creates a session', async () => {
    registerAccount.mockResolvedValue(account);

    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        email: account.email,
        password: 'long-enough-password',
        displayName: account.display_name
      });

    expect(response.status).toBe(201);
    expect(response.body.account).toEqual({
      id: account.id,
      email: account.email,
      name: account.display_name,
      role: account.role,
      emailVerified: false
    });
    expect(response.body.verificationEmailSent).toBe(false);
    expect(createSession).toHaveBeenCalledWith(account.id, expect.anything());
  });

  it('returns conflict when the email already exists', async () => {
    registerAccount.mockRejectedValue({
      code: '23505',
      constraint: 'auth_accounts_email_unique'
    });

    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        email: account.email,
        password: 'long-enough-password',
        displayName: account.display_name
      });

    expect(response.status).toBe(409);
  });

  it('rejects invalid login credentials', async () => {
    authenticateAccount.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: account.email, password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('returns the authenticated account from /me', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.account).toMatchObject({
      id: account.id,
      email: account.email
    });
  });

  it('logs out and revokes the current session', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', origin);

    expect(response.status).toBe(204);
    expect(revokeCurrentSession).toHaveBeenCalled();
  });

  it('rejects malformed email verification tokens', async () => {
    const response = await request(app)
      .post('/api/v1/auth/verify-email/confirm')
      .set('Origin', origin)
      .send({ token: 'bad' });

    expect(response.status).toBe(400);
    expect(verifyEmailToken).not.toHaveBeenCalled();
  });

  it('rejects expired or invalid verification tokens', async () => {
    verifyEmailToken.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/v1/auth/verify-email/confirm')
      .set('Origin', origin)
      .send({ token: 'A'.repeat(43) });

    expect(response.status).toBe(400);
    expect(verifyEmailToken).toHaveBeenCalled();
  });

  it('accepts a valid email verification token', async () => {
    verifyEmailToken.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/v1/auth/verify-email/confirm')
      .set('Origin', origin)
      .send({ token: 'B'.repeat(43) });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
  });

  it('rejects writes without an allowed origin', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: 'wrong-password' });

    expect(response.status).toBe(403);
    expect(authenticateAccount).not.toHaveBeenCalled();
  });
});
