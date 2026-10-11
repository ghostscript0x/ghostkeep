import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/me', async (req: AuthedRequest, res) => {
  const r = await pool.query(
    `SELECT u.id, u.email, u.email_verified_at, u.created_at,
      u.tos_accepted_at, u.privacy_accepted_at, u.wa_risk_accepted_at,
      w.connection_status, w.last_connected_at,
      d.destination_identifier, d.verification_status,
      (SELECT count(*) FROM deletion_events e WHERE e.user_id=u.id) AS total_events,
      (SELECT max(detected_at) FROM deletion_events e WHERE e.user_id=u.id) AS last_activity
     FROM users u LEFT JOIN whatsapp_sessions w ON w.user_id=u.id
     LEFT JOIN recovery_destinations d ON d.user_id=u.id WHERE u.id=$1`,
    [req.user!.id],
  );
  const row = r.rows[0];
  res.json({
    id: row.id, email: row.email, emailVerified: !!row.email_verified_at,
    consents: { tos: !!row.tos_accepted_at, privacy: !!row.privacy_accepted_at, waRisk: !!row.wa_risk_accepted_at },
    connectionStatus: row.connection_status ?? 'disconnected',
    lastConnectedAt: row.last_connected_at,
    destination: row.destination_identifier ? { identifierPreview: maskDest(row.destination_identifier), verificationStatus: row.verification_status } : null,
    totalEvents: Number(row.total_events ?? 0), lastActivity: row.last_activity,
  });
});

function maskDest(jid: string): string {
  if (jid.length <= 6) return '***';
  return jid.slice(0, 3) + '***' + jid.slice(-3);
}

router.delete('/account', async (req: AuthedRequest, res) => {
  await pool.query('DELETE FROM users WHERE id=$1', [req.user!.id]);
  res.clearCookie('gk_session', { path: '/' });
  res.json({ ok: true });
});

router.delete('/recovery-records', async (req: AuthedRequest, res) => {
  await pool.query('DELETE FROM recovery_records WHERE user_id=$1', [req.user!.id]);
  await pool.query("UPDATE deletion_events SET recovery_record_id=NULL, event_status='unmatched' WHERE user_id=$1 AND recovery_record_id IS NOT NULL", [req.user!.id]);
  res.json({ ok: true });
});

export default router;
