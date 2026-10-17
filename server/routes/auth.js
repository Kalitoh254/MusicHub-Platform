import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import {
  registerAccount, authenticateAccount, createSession,
  revokeCurrentSession, requireLocalAuth, clearSessionCookie
} from '../auth/local.js';
import {
  createVerificationToken, sendVerificationEmail, verifyEmailToken
} from '../auth/email-verification.js';

const router = Router();
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
function logDeliveryFailure() {
  console.warn('Verification email delivery failed. Check SMTP configuration.');
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
      const token = await createVerificationToken(account.id);
      if (token) {
        await sendVerificationEmail({
          email: account.email, displayName: account.display_name, token
        });
        verificationEmailSent = true;
      }
    } catch {
      logDeliveryFailure();
    }
    await createSession(account.id, res);
    res.status(201).json({ account: safeAccount(account), verificationEmailSent });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'auth_accounts_email_unique') {
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
          const account = result.rows[0];
          const token = await createVerificationToken(account.id);
          if (token) await sendVerificationEmail({ ...account, token });
        } catch {
          logDeliveryFailure();
        }
      }
    }
    res.status(202).json({
      message: 'If the account exists and needs verification, a verification email will be sent.'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-email/confirm', confirmLimiter, async (req, res, next) => {
  try {
    const token = req.body?.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
      return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    }
    const verified = await verifyEmailToken(token);
    if (!verified) {
      return res.status(400).json({ error: 'This verification link is invalid, expired, or already used.' });
    }
    res.json({ verified: true, message: 'Email verified successfully.' });
  } catch (error) {
    next(error);
  }
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
