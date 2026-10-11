import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

// Shared Redis for TRANSIENT data only: message cache, QR staging, delivery
// queue (IDs only), heartbeats. Never message bodies at rest beyond TTL, never
// credentials, never keys.

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  connectTimeout: 3000,
});

let redisUp = false;
// Circuit breaker: after a failure, skip Redis attempts for a cooldown so a
// dead Redis costs the hot path microseconds, not connection timeouts.
let lastFail = 0;
const COOLDOWN_MS = 5000;
const PING_BUDGET_MS = 1500;

redis.on('ready', () => { redisUp = true; logger.info({ msg: 'redis_ready' }); });
redis.on('close', () => { redisUp = false; lastFail = Date.now(); logger.warn({ msg: 'redis_closed' }); });
redis.on('error', (err: Error) => { lastFail = Date.now(); logger.error({ msg: 'redis_error', err: String(err).slice(0, 120) }); });

export async function ensureRedis(): Promise<boolean> {
  if (redisUp) return true;
  if (Date.now() - lastFail < COOLDOWN_MS) return false;
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ping_budget')), PING_BUDGET_MS)),
    ]);
    redisUp = true;
    return true;
  } catch {
    lastFail = Date.now();
    return false;
  }
}

export function isRedisUp(): boolean {
  return redisUp;
}
