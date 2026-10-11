import { Router, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, requireVerified, type AuthedRequest } from '../middleware/auth.js';
import { getSessionManager } from '../wa/sessionManager.js';

const router = Router();
router.use(requireAuth, requireVerified);
// WhatsApp throttles pairing codes hard — 5 tries per 15 min per IP.
const pairingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

async function requireRiskConsent(req: AuthedRequest, res: Response, next: NextFunction) {
  const r = await pool.query('SELECT wa_risk_accepted_at FROM users WHERE id=$1', [req.user!.id]);
  if (!r.rows[0]?.wa_risk_accepted_at) return res.status(403).json({ error: 'risk_consent_required' });
  next();
}

// POST /whatsapp/session/start -> { qrDataUrl, expiresAt }
router.post('/session/start', requireRiskConsent, async (req: AuthedRequest, res) => {
  const mgr = getSessionManager();
  const { qr, expiresAt } = await mgr.start(req.user!.id);
  res.json({ qrDataUrl: qr, expiresAt });
});

router.get('/session/status', async (req: AuthedRequest, res) => {
  const r = await pool.query('SELECT connection_status, last_connected_at, last_error_code, updated_at FROM whatsapp_sessions WHERE user_id=$1', [req.user!.id]);
  if (!r.rowCount) return res.json({ status: 'disconnected', lastConnectedAt: null });
  res.json({ status: r.rows[0].connection_status, lastConnectedAt: r.rows[0].last_connected_at, lastErrorCode: r.rows[0].last_error_code, updatedAt: r.rows[0].updated_at });
});

router.post('/session/reconnect', requireRiskConsent, async (req: AuthedRequest, res) => {
  const mgr = getSessionManager();
  const { qr, expiresAt } = await mgr.start(req.user!.id);
  res.json({ qrDataUrl: qr, expiresAt });
});

// POST /whatsapp/session/pairing-code { phone } -> { code } | { paired: true }
router.post('/session/pairing-code', pairingLimiter, requireRiskConsent, async (req: AuthedRequest, res) => {
  const parsed = z.object({ phone: z.string().min(8).max(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_phone' });
  try {
    const mgr = getSessionManager();
    res.json(await mgr.requestPairingCode(req.user!.id, parsed.data.phone));
  } catch (e) {
    const m = (e as Error).message;
    if (m === 'invalid_phone') return res.status(400).json({ error: 'invalid_phone' });
    if (/exist|regist|conflict|rate|429|too many/i.test(m)) return res.status(429).json({ error: 'pairing_unavailable_retry' });
    throw e;
  }
});

router.delete('/session', async (req: AuthedRequest, res) => {
  const mgr = getSessionManager();
  await mgr.disconnect(req.user!.id);
  res.json({ ok: true });
});

export default router;
