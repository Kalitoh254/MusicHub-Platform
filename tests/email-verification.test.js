import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  sendMail: vi.fn()
}));

vi.mock('../server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery, connect: mocks.poolConnect }
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) }
}));

import { createAndSendEmailCode } from '../server/auth/email-verification.js';

describe('email verification code cooldown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EMAIL_OTP_SECRET = 'test-only-secret-with-at-least-32-characters';
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.EMAIL_FROM = 'MusicHub <noreply@example.test>';
    mocks.poolConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: vi.fn()
    });
    mocks.clientQuery.mockImplementation(async sql => {
      const query = String(sql);
      if (query.includes('SELECT id FROM auth_accounts')) {
        return { rowCount: 1, rows: [{ id: 'acct-1' }] };
      }
      if (query.includes('SELECT created_at FROM auth_email_verification_codes')) {
        return { rowCount: 1, rows: [{ created_at: new Date() }] };
      }
      return { rowCount: 1, rows: [] };
    });
  });

  it('checks cooldown while holding the account lock and does not insert another code', async () => {
    await expect(createAndSendEmailCode({
      id: 'acct-1',
      email: 'user@example.com',
      display_name: 'Test User'
    })).rejects.toMatchObject({ code: 'OTP_COOLDOWN' });

    const queries = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    const lockIndex = queries.findIndex(sql => sql.includes('SELECT id FROM auth_accounts'));
    const cooldownIndex = queries.findIndex(sql => sql.includes('SELECT created_at FROM auth_email_verification_codes'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(cooldownIndex).toBeGreaterThan(lockIndex);
    expect(queries).toContain('ROLLBACK');
    expect(queries.some(sql => sql.includes('INSERT INTO auth_email_verification_codes'))).toBe(false);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
