import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireLocalAuth } from '../auth/local.js';

const router = Router();
const handlePattern = /^[a-zA-Z0-9_]{3,24}$/;

router.use(requireLocalAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,email,display_name,role,email_verified,handle,bio,avatar_url,created_at
       FROM auth_accounts WHERE id=$1 AND disabled_at IS NULL`,
      [req.account.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Account unavailable' });
    res.json({ profile: rows[0] });
  } catch (error) { next(error); }
});

router.patch('/', async (req, res, next) => {
  try {
    const displayName = String(req.body.displayName ?? '').trim();
    const handleInput = String(req.body.handle ?? '').trim();
    const bio = String(req.body.bio ?? '').trim();
    const avatarInput = String(req.body.avatarUrl ?? '').trim();

    if (displayName.length < 2 || displayName.length > 80)
      return res.status(400).json({ error: 'Display name must be 2–80 characters' });
    if (handleInput && !handlePattern.test(handleInput))
      return res.status(400).json({ error: 'Handle must be 3–24 letters, numbers, or underscores' });
    if (bio.length > 280)
      return res.status(400).json({ error: 'Bio must be 280 characters or fewer' });

    let avatarUrl = null;
    if (avatarInput) {
      try {
        const url = new URL(avatarInput);
        if (url.protocol !== 'https:') throw new Error();
        avatarUrl = url.href;
      } catch {
        return res.status(400).json({ error: 'Avatar URL must be a valid HTTPS URL' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE auth_accounts
       SET display_name=$1, handle=$2, bio=$3, avatar_url=$4, updated_at=now()
       WHERE id=$5 AND disabled_at IS NULL
       RETURNING id,email,display_name,role,email_verified,handle,bio,avatar_url,created_at`,
      [displayName, handleInput || null, bio, avatarUrl, req.account.id]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Account unavailable' });
    res.json({ profile: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That handle is already in use' });
    next(error);
  }
});

export default router;
