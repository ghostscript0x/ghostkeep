import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { getSessionManager } from '../wa/sessionManager.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const destSchema = z.object({ destination: z.string().min(6).max(64) });

export function toJid(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (input.includes('@')) return input;
  return `${digits}@s.whatsapp.net`;
}

router.get('/recovery-destination', async (req: AuthedRequest, res) => {
  const r = await pool.query('SELECT destination_identifier, verification_status FROM recovery_destinations WHERE user_id=$1', [req.user!.id]);
  if (!r.rowCount) return res.json({ destination: null });
  res.json({ destination: { preview: r.rows[0].destination_identifier.slice(0, 3) + '***', verificationStatus: r.rows[0].verification_status } });
});

router.put('/recovery-destination', async (req: AuthedRequest, res) => {
  const parsed = destSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const code = String(crypto.randomInt(100000, 999999));
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const jid = toJid(parsed.data.destination);
  await pool.query(
    `INSERT INTO recovery_destinations (user_id, destination_identifier, verification_status, verify_code_hash)
     VALUES ($1,$2,'pending',$3) ON CONFLICT (user_id) DO UPDATE SET destination_identifier=$2, verification_status='pending', verify_code_hash=$3, updated_at=now()`,
    [req.user!.id, jid, codeHash],
  );
  const mgr = getSessionManager();
  await mgr.sendText(req.user!.id, jid, `Your GhostKeep verification code is ${code}`).catch(() => {});
  res.json({ ok: true, verificationSent: true, devCode: config.isProd ? undefined : code });
});

router.post('/recovery-destination/verify', async (req: AuthedRequest, res) => {
  const parsed = z.object({ code: z.string().length(6) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const h = crypto.createHash('sha256').update(parsed.data.code).digest('hex');
  const r = await pool.query("UPDATE recovery_destinations SET verification_status='verified', verify_code_hash=NULL WHERE user_id=$1 AND verify_code_hash=$2 RETURNING id", [req.user!.id, h]);
  if (!r.rowCount) return res.status(400).json({ error: 'invalid_code' });
  res.json({ ok: true });
});

// Record the pre-link WhatsApp-risk consent. The dashboard requires this
// before the Link button is enabled; the timestamp is the audit trail.
router.put('/consents', async (req: AuthedRequest, res) => {
  const parsed = z.object({ waRisk: z.literal(true) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'consent_required' });
  await pool.query('UPDATE users SET wa_risk_accepted_at=now() WHERE id=$1', [req.user!.id]);
  res.json({ ok: true });
});

export default router;
