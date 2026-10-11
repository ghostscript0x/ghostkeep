import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.js';
import { hashToken } from '../crypto/auth.js';

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; isAdmin: boolean; emailVerified: boolean };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = (req as Request & { cookies: Record<string, string> }).cookies?.gk_session;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const th = hashToken(token);
  const r = await pool.query(
    'SELECT u.id, u.email, u.is_admin, u.email_verified_at, u.status FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()',
    [th],
  );
  if (!r.rowCount || r.rows[0].status !== 'active') return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: r.rows[0].id, email: r.rows[0].email, isAdmin: !!r.rows[0].is_admin, emailVerified: !!r.rows[0].email_verified_at };
  next();
}

export function requireVerified(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user?.emailVerified) return res.status(403).json({ error: 'email_not_verified' });
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'forbidden' });
  next();
}
