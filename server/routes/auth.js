import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  registerAccount, authenticateAccount, createSession,
  revokeCurrentSession, requireLocalAuth, clearSessionCookie
} from '../auth/local.js';

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' }
});

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function safeAccount(account) {
  return {
    id: account.id,
    email: account.email,
    name: account.display_name,
    role: account.role,
    emailVerified: account.email_verified
  };
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
    await createSession(account.id, res);
    res.status(201).json({ account: safeAccount(account) });
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
