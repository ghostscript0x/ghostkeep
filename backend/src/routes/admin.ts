import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requireAdmin, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);

async function audit(adminId: string, action: string, target: string | null, result: string, meta: object = {}) {
  await pool.query(
    'INSERT INTO admin_audit_logs (admin_user_id, action_type, target_user_id, result, metadata_redacted) VALUES ($1,$2,$3,$4,$5)',
    [adminId, action, target, result, JSON.stringify(meta)],
  );
}

router.get('/overview', async (req: AuthedRequest, res) => {
  const [users, conn, events, fails] = await Promise.all([
    pool.query("SELECT count(*) AS total, count(*) FILTER (WHERE status='suspended') AS suspended FROM users WHERE is_admin=false"),
    pool.query("SELECT count(*) FILTER (WHERE connection_status='connected') AS connected, count(*) FILTER (WHERE connection_status<>'connected') AS disconnected FROM whatsapp_sessions"),
    pool.query("SELECT count(*) AS total, count(*) FILTER (WHERE event_status='recovered') AS recovered FROM deletion_events"),
    pool.query("SELECT count(*) AS failed FROM recovery_records WHERE delivery_status='failed'"),
  ]);
  await audit(req.user!.id, 'overview_view', null, 'ok');
  res.json({
    users: { total: Number(users.rows[0].total), suspended: Number(users.rows[0].suspended) },
    sessions: { connected: Number(conn.rows[0]?.connected ?? 0), disconnected: Number(conn.rows[0]?.disconnected ?? 0) },
    events: { total: Number(events.rows[0].total), recovered: Number(events.rows[0].recovered) },
    delivery: { failed: Number(fails.rows[0].failed) },
    version: process.env.APP_VERSION ?? '1.0.0',
  });
});

router.get('/users', async (req: AuthedRequest, res) => {
  const q = (req.query.q as string) ?? '';
  const r = await pool.query(
    `SELECT u.id, u.email, u.status, u.created_at, w.connection_status, w.last_connected_at
     FROM users u LEFT JOIN whatsapp_sessions w ON w.user_id=u.id
     WHERE u.is_admin=false AND ($1='' OR u.email ILIKE '%'||$1||'%' OR u.id::text=$1)
     ORDER BY u.created_at DESC LIMIT 50`,
    [q],
  );
  await audit(req.user!.id, 'users_search', null, 'ok', { qLen: q.length });
  res.json({ users: r.rows });
});

router.post('/users/:id/suspend', async (req: AuthedRequest, res) => {
  await pool.query("UPDATE users SET status='suspended' WHERE id=$1 AND is_admin=false", [req.params.id]);
  // A suspended account must stop receiving/forwarding immediately:
  // kill its live socket and wipe staged transients via disconnect.
  try {
    const { getSessionManager } = await import('../wa/sessionManager.js');
    await getSessionManager().disconnect(req.params.id);
  } catch { /* best effort; account is already locked out of the API */ }
  await audit(req.user!.id, 'user_suspend', req.params.id, 'ok');
  res.json({ ok: true });
});

router.post('/users/:id/unsuspend', async (req: AuthedRequest, res) => {
  await pool.query("UPDATE users SET status='active' WHERE id=$1 AND is_admin=false", [req.params.id]);
  await audit(req.user!.id, 'user_unsuspend', req.params.id, 'ok');
  res.json({ ok: true });
});

router.get('/sessions', async (req: AuthedRequest, res) => {
  // Secrets redacted: never select encrypted_session_credentials.
  const r = await pool.query(
    'SELECT user_id, connection_status, last_connected_at, last_error_code, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC LIMIT 100',
  );
  await audit(req.user!.id, 'sessions_view', null, 'ok');
  res.json({ sessions: r.rows });
});

// Safe operational action: flag a session as needing relink (user relinks
// from their dashboard). Never exposes credentials or QR payloads.
router.post('/sessions/:userId/reconnect', async (req: AuthedRequest, res) => {
  await pool.query("UPDATE whatsapp_sessions SET connection_status='needs_relink', updated_at=now() WHERE user_id=$1", [req.params.userId]);
  await audit(req.user!.id, 'session_reconnect_request', req.params.userId, 'ok');
  res.json({ ok: true });
});

router.get('/events', async (req: AuthedRequest, res) => {  // Counts + statuses only. No join to recovery_records content.
  const r = await pool.query(
    'SELECT user_id, event_status, detected_at, delivery_attempt_count, last_delivery_error_code FROM deletion_events ORDER BY detected_at DESC LIMIT 100',
  );
  await audit(req.user!.id, 'events_view', null, 'ok');
  res.json({ events: r.rows });
});

router.get('/health', async (_req: AuthedRequest, res) => {
  const db = await pool.query('SELECT 1').then(() => 'up').catch(() => 'down');
  const { ensureRedis } = await import('../redis.js');
  const { getTransient } = await import('../wa/transient.js');
  const { smtpStatus, isSmtpConfigured } = await import('../mailer.js');
  const redisUp = await ensureRedis();
  const workerAlive = await getTransient().workerAlive();
  const queueDepth = await getTransient().queueDepth();
  const cacheSize = getTransient().cacheSize;
  res.json({ db, redis: redisUp ? 'up' : 'down', worker: workerAlive ? 'up' : 'unknown', queueDepth, cacheSize, smtp: !isSmtpConfigured() ? 'off' : smtpStatus() ? 'up' : 'down', uptimeSec: Math.round(process.uptime()) });
});

router.get('/audit', async (req: AuthedRequest, res) => {
  const r = await pool.query('SELECT admin_user_id, action_type, target_user_id, timestamp, result, metadata_redacted FROM admin_audit_logs ORDER BY timestamp DESC LIMIT 100');
  res.json({ audit: r.rows });
});

export default router;
