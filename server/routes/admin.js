import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireLocalAuth } from '../auth/local.js';

const router = Router();

function requireAdmin(req, res, next) {
  return requireLocalAuth(req, res, error => {
    if (error) return next(error);
    if (res.headersSent) return;
    if (req.account?.role !== 'admin')
      return res.status(403).json({ error: 'Administrator access required' });
    return next();
  });
}
router.use(requireAdmin);

router.get('/summary', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT count(*)::int AS total_accounts,
             count(*) FILTER (WHERE disabled_at IS NULL)::int AS active_accounts,
             count(*) FILTER (WHERE role='admin' AND disabled_at IS NULL)::int AS active_admins,
             count(*) FILTER (WHERE created_at >= now()-interval '7 days')::int AS new_last_7_days
      FROM auth_accounts`);
    res.json({ summary: rows[0] });
  } catch (error) { next(error); }
});

router.get('/accounts', async (req, res, next) => {
  try {
    const search = String(req.query.search ?? '').trim().slice(0, 100);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const { rows } = await pool.query(
      `SELECT id,email,display_name,role,email_verified,disabled_at,handle,created_at
       FROM auth_accounts
       WHERE ($1='' OR email ILIKE '%'||$1||'%' OR display_name ILIKE '%'||$1||'%' OR coalesce(handle,'') ILIKE '%'||$1||'%')
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [search, limit, offset]
    );
    res.json({ accounts: rows, limit, offset });
  } catch (error) { next(error); }
});

router.patch('/accounts/:id/role', async (req, res, next) => {
  const role = req.body.role;
  if (!['user', 'admin'].includes(role))
    return res.status(400).json({ error: 'Role must be user or admin' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(68421001)');
    const target = await client.query('SELECT id,role,disabled_at FROM auth_accounts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!target.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Account not found' }); }
    if (target.rows[0].id === req.account.id && role !== 'admin') {
      await client.query('ROLLBACK'); return res.status(400).json({ error: 'You cannot remove your own administrator role' });
    }
    if (target.rows[0].role === 'admin' && role !== 'admin' && !target.rows[0].disabled_at) {
      const count = await client.query("SELECT count(*)::int AS n FROM auth_accounts WHERE role='admin' AND disabled_at IS NULL");
      if (count.rows[0].n <= 1) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Cannot demote the last active administrator' }); }
    }
    const result = await client.query(
      `UPDATE auth_accounts SET role=$1,updated_at=now() WHERE id=$2
       RETURNING id,email,display_name,role,email_verified,disabled_at,handle,created_at`,
      [role, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ account: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

router.patch('/accounts/:id/status', async (req, res, next) => {
  if (typeof req.body.disabled !== 'boolean')
    return res.status(400).json({ error: 'disabled must be true or false' });
  if (req.params.id === req.account.id && req.body.disabled)
    return res.status(400).json({ error: 'You cannot suspend your own account' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(68421001)');
    const target = await client.query('SELECT id,role,disabled_at FROM auth_accounts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!target.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Account not found' }); }
    if (req.body.disabled && target.rows[0].role === 'admin' && !target.rows[0].disabled_at) {
      const count = await client.query("SELECT count(*)::int AS n FROM auth_accounts WHERE role='admin' AND disabled_at IS NULL");
      if (count.rows[0].n <= 1) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Cannot suspend the last active administrator' }); }
    }
    const result = await client.query(
      `UPDATE auth_accounts SET disabled_at=$1,updated_at=now() WHERE id=$2
       RETURNING id,email,display_name,role,email_verified,disabled_at,handle,created_at`,
      [req.body.disabled ? new Date() : null, req.params.id]
    );
    if (req.body.disabled) await client.query('DELETE FROM auth_sessions WHERE account_id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ account: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});

router.post('/accounts/:id/revoke-sessions', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM auth_sessions WHERE account_id=$1', [req.params.id]);
    res.json({ revoked: result.rowCount });
  } catch (error) { next(error); }
});

export default router;
