import { Router } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import {
  registerAccount, authenticateAccount, createSession,
  revokeCurrentSession, requireLocalAuth, clearSessionCookie
} from '../auth/local.js';
import {
  createAndSendEmailCode, verifyEmailCode
} from '../auth/email-verification.js';

const router = Router();
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' }
});
const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 5,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many verification requests. Try again later.' }
});
const confirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10,
  standardHeaders: 'draft-8', legacyHeaders: false
});

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
function safeAccount(account) {
  return {
    id: account.id, email: account.email, name: account.display_name,
    role: account.role, emailVerified: account.email_verified
  };
}
function logDeliveryFailure(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const reason = /EMAIL_OTP_SECRET/.test(message)
    ? 'otp_secret_invalid'
    : /SMTP email is not configured|Invalid SMTP port/.test(message)
      ? 'smtp_configuration_invalid'
      : 'transport_or_provider_error';

  console.error('Verification code delivery failed', {
    reason,
    code: typeof error?.code === 'string' ? error.code : undefined,
    command: typeof error?.command === 'string' ? error.command : undefined,
    responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined,
    syscall: typeof error?.syscall === 'string' ? error.syscall : undefined,
    hostname: typeof error?.hostname === 'string' ? error.hostname : undefined,
    smtpHostConfigured: Boolean(process.env.SMTP_HOST),
    smtpPortConfigured: Boolean(process.env.SMTP_PORT),
    smtpUserConfigured: Boolean(process.env.SMTP_USER),
    smtpPasswordConfigured: Boolean(process.env.SMTP_PASS),
    emailFromConfigured: Boolean(process.env.EMAIL_FROM),
    otpSecretConfigured: Boolean(process.env.EMAIL_OTP_SECRET && process.env.EMAIL_OTP_SECRET.length >= 32)
  });
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!validEmail(email) || typeof password !== 'string' ||
        password.length < 12 || password.length > 128 ||
        typeof displayName !== 'string' ||
        displayName.trim().length < 2 || displayName.trim().length > 80) {
      return res.status(400).json({
        error: 'Provide a valid email, a display name of 2–80 characters, and a password of 12–128 characters.'
      });
    }

    const account = await registerAccount({ email, password, displayName });
    let verificationEmailSent = false;
    try {
      verificationEmailSent = await createAndSendEmailCode(account);
    } catch (error) {
      logDeliveryFailure(error);
    }
    clearSessionCookie(res);
    return res.status(201).json({
      account: safeAccount(account),
      verificationEmailSent,
      verificationRequired: true
    });
  } catch (error) {
    if (error.code === '23505' &&
        error.constraint === 'auth_accounts_email_unique') {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validEmail(email) || typeof password !== 'string' || password.length > 128) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const account = await authenticateAccount(email, password);
    if (!account) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!account.email_verified) {
      clearSessionCookie(res);
      return res.status(403).json({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        error: 'Verify your email address before signing in.'
      });
    }
    await createSession(account.id, res);
    res.json({ account: safeAccount(account) });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-email/resend', resendLimiter, async (req, res, next) => {
  try {
    const email = req.body?.email;
    if (validEmail(email)) {
      const result = await pool.query(
        `SELECT id, email, display_name FROM auth_accounts
         WHERE email_normalized = lower(trim($1))
           AND email_verified = false AND disabled_at IS NULL`,
        [email]
      );
      if (result.rows[0]) {
        try {
          await createAndSendEmailCode(result.rows[0]);
        } catch (error) {
          if (error.code !== 'OTP_COOLDOWN') logDeliveryFailure(error);
        }
      }
    }
    res.status(202).json({
      message: 'If the account exists and needs verification, a code will be sent.'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-email/confirm', confirmLimiter, async (req, res, next) => {
  try {
    const { email, code } = req.body || {};
    if (!validEmail(email) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the email address and six-digit verification code.' });
    }
    const verified = await verifyEmailCode(email, code);
    if (!verified) {
      return res.status(400).json({ error: 'The code is invalid, expired, or already used.' });
    }
    res.json({ verified: true, message: 'Email verified successfully. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

router.post('/google', authLimiter, async (req, res, next) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const credential = req.body?.credential;
  if (!clientId) return res.status(503).json({ error: 'Google sign-in is not configured.' });
  if (typeof credential !== 'string' || credential.length > 12000)
    return res.status(401).json({ error: 'Invalid Google credential.' });

  let payload;
  try {
    ({ payload } = await jwtVerify(credential, googleJwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: clientId
    }));
  } catch {
    return res.status(401).json({ error: 'Google sign-in could not be verified.' });
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string' ||
      typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255)
    return res.status(401).json({ error: 'Google must provide a verified email.' });

  const email = payload.email.trim().toLowerCase();
  const displayName = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim().slice(0, 80) : email.split('@')[0].slice(0, 80);
  let connection;
  let account;
  try {
    connection = await pool.connect();
    await connection.query('BEGIN');
    const linked = await connection.query(
      "SELECT a.id, a.email, a.display_name, a.role, a.email_verified, a.disabled_at FROM auth_identities i JOIN auth_accounts a ON a.id = i.account_id WHERE i.provider = 'google' AND i.provider_subject = $1 FOR UPDATE OF a",
      [payload.sub]
    );
    if (linked.rows[0]) {
      account = linked.rows[0];
      if (account.disabled_at) {
        await connection.query('ROLLBACK');
        return res.status(403).json({ error: 'This account is disabled.' });
      }
    } else {
      const existing = await connection.query(
        'SELECT id FROM auth_accounts WHERE email_normalized = lower(trim($1))',
        [email]
      );
      if (existing.rowCount) {
        await connection.query('ROLLBACK');
        return res.status(409).json({
          code: 'ACCOUNT_LINK_REQUIRED',
          error: 'An account already uses this email. Sign in using its existing method.'
        });
      }
      const created = await connection.query(
        'INSERT INTO auth_accounts (email, password_hash, display_name, email_verified) VALUES ($1, NULL, $2, TRUE) RETURNING id, email, display_name, role, email_verified, disabled_at',
        [email, displayName]
      );
      account = created.rows[0];
      await connection.query(
        "INSERT INTO auth_identities (account_id, provider, provider_subject) VALUES ($1, 'google', $2)",
        [account.id, payload.sub]
      );
    }
    await connection.query('COMMIT');
  } catch (error) {
    if (connection) try { await connection.query('ROLLBACK'); } catch {}
    if (error.code === '23505')
      return res.status(409).json({ error: 'Account conflict. Please sign in again.' });
    return next(error);
  } finally {
    connection?.release();
  }
  try {
    await createSession(account.id, res);
    return res.json({ account: safeAccount(account) });
  } catch (error) { return next(error); }
});

router.post('/logout', async (req, res, next) => {
  try {
    await revokeCurrentSession(req, res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireLocalAuth, (req, res) => {
  res.json({ account: safeAccount(req.account) });
});

export default router;
