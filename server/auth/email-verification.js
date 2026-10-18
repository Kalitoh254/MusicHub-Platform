import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool } from '../db/pool.js';

const CODE_MS = 10 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(accountId, code) {
  const secret = process.env.EMAIL_OTP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('EMAIL_OTP_SECRET must contain at least 32 characters');
  }
  return createHmac('sha256', secret)
    .update(`${accountId}:${code}`)
    .digest('hex');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

async function sendCodeEmail({ email, displayName, code }) {
  const host = process.env.SMTP_HOST;
  const from = process.env.EMAIL_FROM;
  if (!host || !from) throw new Error('SMTP email is not configured');

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid SMTP port');
  }

  const options = {
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' ||
      (!process.env.SMTP_SECURE && port === 465)
  };
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    options.auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    };
  }

  const name = displayName || 'MusicHub member';
  await nodemailer.createTransport(options).sendMail({
    from,
    to: email,
    subject: 'Your MusicHub verification code',
    text: `Hello ${name},\n\nYour MusicHub verification code is ${code}. It expires in 10 minutes and can only be used once.\n\nIf you did not create this account, ignore this email.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Your MusicHub verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes and can only be used once.</p><p>If you did not create this account, ignore this email.</p>`
  });
}

export async function createAndSendEmailCode(account) {
  const code = String(randomInt(100000, 1000000));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id FROM auth_accounts
       WHERE id = $1 AND email_verified = false AND disabled_at IS NULL
       FOR UPDATE`,
      [account.id]
    );
    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    const recent = await client.query(
      `SELECT created_at FROM auth_email_verification_codes
       WHERE account_id = $1 AND created_at > now() - interval '60 seconds'
       ORDER BY created_at DESC LIMIT 1`,
      [account.id]
    );
    if (recent.rowCount) {
      const error = new Error('Please wait before requesting another code.');
      error.code = 'OTP_COOLDOWN';
      throw error;
    }
    await client.query(
      `UPDATE auth_email_verification_codes SET used_at = now()
       WHERE account_id = $1 AND used_at IS NULL`,
      [account.id]
    );
    await client.query(
      `INSERT INTO auth_email_verification_codes
       (account_id, code_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [account.id, hashCode(account.id, code), new Date(Date.now() + CODE_MS)]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  try {
    await sendCodeEmail({ ...account, code });
    return true;
  } catch (error) {
    await pool.query(
      `UPDATE auth_email_verification_codes SET used_at = now()
       WHERE account_id = $1 AND used_at IS NULL`,
      [account.id]
    ).catch(() => {});
    throw error;
  }
}

export async function verifyEmailCode(email, code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT c.id, c.account_id, c.code_hash, c.attempts
       FROM auth_email_verification_codes c
       JOIN auth_accounts a ON a.id = c.account_id
       WHERE a.email_normalized = lower(trim($1))
         AND a.email_verified = false AND a.disabled_at IS NULL
         AND c.used_at IS NULL AND c.expires_at > now()
         AND c.attempts < $2
       ORDER BY c.created_at DESC
       LIMIT 1 FOR UPDATE OF c`,
      [email, MAX_ATTEMPTS]
    );
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }

    const item = found.rows[0];
    const expectedHash = Buffer.from(hashCode(item.account_id, code), 'hex');
    const storedHash = Buffer.from(item.code_hash, 'hex');
    if (expectedHash.length !== storedHash.length ||
        !timingSafeEqual(expectedHash, storedHash)) {
      await client.query(
        `UPDATE auth_email_verification_codes
         SET attempts = attempts + 1,
             used_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE used_at END
         WHERE id = $1`,
        [item.id, MAX_ATTEMPTS]
      );
      await client.query('COMMIT');
      return false;
    }

    await client.query(
      'UPDATE auth_accounts SET email_verified = true, updated_at = now() WHERE id = $1',
      [item.account_id]
    );
    await client.query(
      `UPDATE auth_email_verification_codes SET used_at = now()
       WHERE account_id = $1 AND used_at IS NULL`,
      [item.account_id]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
