import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { decryptEnvelope, deserialize } from '../crypto/envelope.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

// GET /recovery/events — metadata + decrypted content ONLY for owner.
// (Admin routes never call this; admin uses metadata-only queries.)
router.get('/events', async (req: AuthedRequest, res) => {
  if (!config.recoveryMasterKey) return res.status(500).json({ error: 'server_misconfigured' });
  const ev = await pool.query(
    `SELECT e.id, e.event_status, e.detected_at, e.delivery_attempt_count, e.last_delivery_error_code,
      r.id AS rec_id, r.encrypted_content, r.delivery_status, r.delivered_at, r.original_message_timestamp, r.retention_expires_at
     FROM deletion_events e LEFT JOIN recovery_records r ON r.id=e.recovery_record_id
     WHERE e.user_id=$1 ORDER BY e.detected_at DESC LIMIT 100`,
    [req.user!.id],
  );
  const out = ev.rows.map((row) => {
    let content: string | null = null;
    let sender: string | null = null;
    let chat: string | null = null;
    if (row.encrypted_content) {
      try {
        const payload = JSON.parse(decryptEnvelope(config.recoveryMasterKey!, deserialize(row.encrypted_content)));
        content = payload.text ?? null; sender = payload.senderRef ?? null; chat = payload.chatRef ?? null;
      } catch { content = null; }
    }
    // Media itself lives in the WhatsApp destination chat (instant-forwarded
    // on receipt); history carries the label text pointing at it.
    return {
      id: row.id, status: row.event_status, detectedAt: row.detected_at,
      deliveryAttempts: row.delivery_attempt_count, lastDeliveryError: row.last_delivery_error_code,
      deliveryStatus: row.delivery_status, deliveredAt: row.delivered_at,
      originalMessageTimestamp: row.original_message_timestamp, retentionExpiresAt: row.retention_expires_at,
      sender, chat, content,
    };
  });
  res.json({ events: out });
});

export default router;
