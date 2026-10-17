import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from '../db/pool.js';

const scrypt = promisify(scryptCallback);
const COOKIE = 'mh_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MS
  };
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  try {
    const [scheme, n, r, p, saltHex, keyHex] = encoded.split('$');
    if (scheme !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1') return false;
    const expected = Buffer.from(keyHex, 'hex');
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function readCookie(req, name) {
  const prefix = `${name}=`;
  for (const part of (req.headers.cookie || '').split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      try { return decodeURIComponent(item.slice(prefix.length)); } catch { return ''; }
    }
  }
  return '';
}

export async function createSession(accountId, res) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await pool.query(
    'INSERT INTO auth_sessions (account_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [accountId, hashToken(token), expiresAt]
  );
  res.cookie(COOKIE, token, cookieOptions());
}

export async function requireLocalAuth(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (!token || token.length > 200) return res.status(401).json({ error: 'Sign-in required' });
  try {
    const result = await pool.query(
      `SELECT a.id, a.email, a.display_name, a.role, a.email_verified
       FROM auth_sessions s
       JOIN auth_accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND a.disabled_at IS NULL`,
      [hashToken(token)]
    );
    if (!result.rowCount) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    req.account = result.rows[0];
    await pool.query('UPDATE auth_sessions SET last_seen_at = now() WHERE token_hash = $1', [hashToken(token)]);
    next();
  } catch (error) {
    next(error);
  }
}

export async function registerAccount({ email, password, displayName }) {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const result = await pool.query(
    `INSERT INTO auth_accounts (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, display_name, role, email_verified`,
    [normalizedEmail, passwordHash, displayName.trim()]
  );
  return result.rows[0];
}

export async function authenticateAccount(email, password) {
  const result = await pool.query(
    `SELECT id, email, display_name, role, email_verified, password_hash, disabled_at
     FROM auth_accounts WHERE email_normalized = lower(trim($1))`,
    [email]
  );
  const account = result.rows[0];
  if (!account || !(await verifyPassword(password, account.password_hash)) || account.disabled_at) return null;
  const { password_hash, disabled_at, ...safeAccount } = account;
  return safeAccount;
}

export async function revokeCurrentSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
  clearSessionCookie(res);
}
