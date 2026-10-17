import { randomBytes, createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool } from '../db/pool.js';

const TOKEN_MS = 24 * 60 * 60 * 1000;
const hashToken = token => createHash('sha256').update(token).digest('hex');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

export async function createVerificationToken(accountId) {
  const token = randomBytes(32).toString('base64url');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query(
      `SELECT id FROM auth_accounts
       WHERE id = $1 AND email_verified = false AND disabled_at IS NULL
       FOR UPDATE`,
      [accountId]
    );
    if (!account.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      'DELETE FROM auth_email_verification_tokens WHERE account_id = $1 AND used_at IS NULL',
      [accountId]
    );
    await client.query(
      `INSERT INTO auth_email_verification_tokens (account_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [accountId, hashToken(token), new Date(Date.now() + TOKEN_MS)]
    );
    await client.query('COMMIT');
    return token;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function sendVerificationEmail({ email, displayName, token }) {
  const host = process.env.SMTP_HOST;
  const from = process.env.EMAIL_FROM;
  const origin = (process.env.APP_ORIGIN || '').split(',')[0].trim();
  if (!host || !from || !origin) {
    throw new Error('Email delivery is not configured');
  }

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid SMTP port configuration');
  }

  const transportOptions = {
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' ||
      (!process.env.SMTP_SECURE && port === 465)
  };
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transportOptions.auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    };
  }

  const link = new URL('/', origin);
  link.searchParams.set('verifyEmail', token);
  const name = displayName || 'MusicHub member';
  const transporter = nodemailer.createTransport(transportOptions);

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Verify your MusicHub email',
    text: `Hello ${name},\n\nVerify your MusicHub email using this link (valid for 24 hours):\n${link.href}\n\nIf you did not create this account, you can ignore this email.`,
    html: `<p>Hello ${escapeHtml(name)},</p>
      <p>Confirm your email address to complete your MusicHub account setup.</p>
      <p><a href="${escapeHtml(link.href)}">Verify my email</a></p>
      <p>This link expires in 24 hours and can only be used once.</p>
      <p>If you did not create this account, you can ignore this email.</p>`
  });
}

export async function verifyEmailToken(token) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT t.account_id
       FROM auth_email_verification_tokens t
       JOIN auth_accounts a ON a.id = t.account_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL
         AND t.expires_at > now() AND a.email_verified = false
         AND a.disabled_at IS NULL
       FOR UPDATE OF t`,
      [hashToken(token)]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    const accountId = result.rows[0].account_id;
    await client.query(
      'UPDATE auth_accounts SET email_verified = true, updated_at = now() WHERE id = $1',
      [accountId]
    );
    await client.query(
      'UPDATE auth_email_verification_tokens SET used_at = now() WHERE account_id = $1 AND used_at IS NULL',
      [accountId]
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
