import dotenv from 'dotenv';
import path from 'node:path';
// Load repo-root .env (when running from backend/) plus local .env if present.
for (const p of [path.resolve(process.cwd(), '../.env'), path.resolve(process.cwd(), '.env')]) {
  dotenv.config({ path: p });
}

function b64env(name: string): Buffer | null {
  const v = process.env[name];
  if (!v) return null;
  try {
    const b = Buffer.from(v, 'base64');
    return b.length === 32 ? b : null;
  } catch { return null; }
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://casaos:casaos@192.168.1.103:5432/ghostkeep',
  redisUrl: process.env.REDIS_URL ?? 'redis://192.168.1.103:6379',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me-32-bytes!!',
  webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
  recoveryKeyId: process.env.RECOVERY_MASTER_KEY_ID ?? 'v1',
  recoveryMasterKey: b64env('RECOVERY_MASTER_KEY'),
  sessionCredKeyId: process.env.SESSION_CRED_MASTER_KEY_ID ?? 'v1',
  sessionCredMasterKey: b64env('SESSION_CRED_MASTER_KEY'),
  cacheMax: Number(process.env.MSG_CACHE_MAX ?? 1000),
  cacheTtlMs: Number(process.env.MSG_CACHE_TTL_MS ?? 15 * 60 * 1000),
  retentionDays: Number(process.env.RECOVERY_RETENTION_DAYS ?? 30),
  isProd: process.env.NODE_ENV === 'production',
};
