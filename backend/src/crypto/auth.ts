import crypto from 'node:crypto';
import argon2 from 'argon2';

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw);

export function newToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
export function sha256Short(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}
