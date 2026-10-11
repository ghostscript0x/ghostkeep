import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { hashPassword, verifyPassword, newToken, hashToken } from '../crypto/auth.js';
import { config } from '../config.js';
import { isSmtpConfigured, sendVerifyEmail, sendResetEmail } from '../mailer.js';

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

const email = z.string().email().max(254);
const password = z.string().min(12).max(200);

router.post('/register', authLimiter, async (req, res) => {
  const parsed = z.object({
    email, password,
    // Terms + Privacy accepted at signup. The WhatsApp-risk consent is
    // recorded separately right before linking (PUT /settings/consents).
    consents: z.object({ tos: z.literal(true), privacy: z.literal(true) }),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input_consent_required' });
  const { email: em, password: pw } = parsed.data;
  const verifyToken = crypto.randomBytes(24).toString('hex');
  try {
    const ph = await hashPassword(pw);
    const ins = await pool.query(
      'INSERT INTO users (email, password_hash, email_verify_token, tos_accepted_at, privacy_accepted_at) VALUES (lower($1), $2, $3, now(), now()) RETURNING id',
      [em, ph, verifyToken],
    );
    if (isSmtpConfigured()) sendVerifyEmail(em, ins.rows[0].id as string, verifyToken);
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err?.code === '23505') return res.status(409).json({ error: 'email_taken' });
    throw e;
  }
  // With SMTP configured the link is emailed; otherwise the token is
  // returned so dev setups without mail infra still work.
  res.status(201).json({ ok: true, emailSent: isSmtpConfigured(), verifyToken: isSmtpConfigured() ? undefined : verifyToken });
});

// Re-send the verification link (rate-limited). Always responds ok so
// addresses can't be enumerated.
router.post('/resend-verification', authLimiter, async (req, res) => {
  const parsed = z.object({ email }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const r = await pool.query('SELECT id, email_verify_token FROM users WHERE email=lower($1) AND email_verified_at IS NULL', [parsed.data.email]);
  if (r.rowCount && isSmtpConfigured()) {
    let tok = r.rows[0].email_verify_token as string | null;
    if (!tok) {
      tok = crypto.randomBytes(24).toString('hex');
      await pool.query('UPDATE users SET email_verify_token=$2 WHERE id=$1', [r.rows[0].id, tok]);
    }
    sendVerifyEmail(parsed.data.email, r.rows[0].id as string, tok);
  }
  res.json({ ok: true, emailSent: isSmtpConfigured() && !!r.rowCount });
});

router.post('/verify-email', authLimiter, async (req, res) => {
  const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const r = await pool.query('UPDATE users SET email_verified_at=now(), email_verify_token=NULL WHERE email_verify_token=$1 RETURNING id', [parsed.data.token]);
  if (!r.rowCount) return res.status(400).json({ error: 'invalid_token' });
  res.json({ ok: true });
});

router.post('/login', authLimiter, async (req, res) => {
  const parsed = z.object({ email, password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const r = await pool.query('SELECT * FROM users WHERE email=lower($1)', [parsed.data.email]);
  if (!r.rowCount || r.rows[0].status !== 'active') return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await verifyPassword(r.rows[0].password_hash, parsed.data.password);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  const { token, tokenHash } = newToken();
  await pool.query('INSERT INTO sessions (user_id, token_hash) VALUES ($1, $2)', [r.rows[0].id, tokenHash]);
  res.cookie('gk_session', token, { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000, path: '/' });
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const t = (req as unknown as { cookies: Record<string, string> }).cookies?.gk_session;
  if (t) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(t)]);
  res.clearCookie('gk_session', { path: '/' });
  res.json({ ok: true });
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  const parsed = z.object({ email }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const tok = crypto.randomBytes(24).toString('hex');
  const upd = await pool.query(
    "UPDATE users SET password_reset_token=$2, password_reset_expires_at=now()+interval '1 hour' WHERE email=lower($1) AND status='active' RETURNING id",
    [parsed.data.email, tok],
  );
  if (upd.rowCount && isSmtpConfigured()) sendResetEmail(parsed.data.email, upd.rows[0].id as string, tok);
  res.json({ ok: true, emailSent: isSmtpConfigured() && !!upd.rowCount, resetToken: isSmtpConfigured() ? undefined : (upd.rowCount ? tok : undefined) });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const parsed = z.object({ token: z.string().min(10), password }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const ph = await hashPassword(parsed.data.password);
  const r = await pool.query(
    'UPDATE users SET password_hash=$2, password_reset_token=NULL, password_reset_expires_at=NULL WHERE password_reset_token=$1 AND password_reset_expires_at > now() RETURNING id',
    [parsed.data.token, ph],
  );
  if (!r.rowCount) return res.status(400).json({ error: 'invalid_token' });
  await pool.query('DELETE FROM sessions WHERE user_id=$1', [r.rows[0].id]);
  res.json({ ok: true });
});

export default router;
