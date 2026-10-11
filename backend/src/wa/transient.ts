import QRCode from 'qrcode';
import { redis, ensureRedis } from '../redis.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { MessageCache, type CachedMessage } from './messageCache.js';

// Redis-backed transient layers. Redis holds ONLY short-lived operational
// data (message cache entries with TTL, QR payloads with 60s TTL, delivery
// queue items containing IDs — never message bodies, creds, or keys).
// Media is forwarded server-side instantly and never staged at all.
// Every path degrades to the in-memory fallback when Redis is unreachable so
// a Redis outage never breaks pairing or recovery on a single VPS.

const K_MSG = (u: string, m: string) => `gk:msg:${u}:${m}`;
const K_QR = (u: string) => `gk:qr:${u}`;
const Q_DUE = 'gk:deliver:due';   // ZSET score=notBeforeMs member=JSON {userId, recordId, attempt}
const K_HB = 'gk:worker:hb';
const Q_DEPTH_WARN = 500;

export interface DueItem { userId: string; recordId: string; attempt: number; }
interface MemDue extends DueItem { notBefore: number; }

export class TransientStore {
  private mem = new MessageCache(config.cacheMax, config.cacheTtlMs);
  private memQr = new Map<string, { payload: string; expiresAt: number }>();
  private memDue: MemDue[] = [];

  get cacheSize(): number { return this.mem.size; }

  // ---- message cache ----
  async cacheMessage(m: CachedMessage): Promise<void> {
    this.mem.set(m);
    if (await ensureRedis()) {
      try {
        const v = JSON.stringify({ senderRef: m.senderRef, chatRef: m.chatRef, text: m.text, ts: m.ts, chatId: m.chatId });
        await redis.set(K_MSG(m.userId, m.waMessageId), v, 'PX', config.cacheTtlMs);
        return;
      } catch { logger.warn({ msg: 'redis_cache_set_failed' }); }
    }
  }

  /** Take-once by (user, message). Chat is verified against the stored copy
   *  and mismatches are logged but still accepted (LID/PN JID aliasing). */
  async takeMessage(userId: string, chatId: string, waMessageId: string): Promise<CachedMessage | null> {
    const fromMem = this.mem.take(userId, waMessageId);
    if (await ensureRedis()) {
      try {
        const raw = await redis.getdel(K_MSG(userId, waMessageId));
        if (raw) {
          const p = JSON.parse(raw) as { senderRef: string; chatRef: string; text: string; ts: number; chatId: string };
          if (p.chatId !== chatId) logger.info({ userId, msg: 'cache_chat_alias' });
          return { userId, chatId: p.chatId, waMessageId, senderRef: p.senderRef, chatRef: p.chatRef, text: p.text, ts: p.ts, receivedAt: Date.now() };
        }
      } catch { logger.warn({ msg: 'redis_cache_take_failed' }); }
    }
    if (fromMem) {
      if (fromMem.chatId !== chatId) logger.info({ userId, msg: 'cache_chat_alias' });
      return fromMem;
    }
    return null;
  }

  sweep(): number {
    return this.mem.sweep();
  }

  // ---- QR staging (raw payload, 60s TTL; converted to data URL at request time) ----
  async stageQr(userId: string, payload: string): Promise<void> {
    this.memQr.set(userId, { payload, expiresAt: Date.now() + 60_000 });
    if (await ensureRedis()) {
      try { await redis.set(K_QR(userId), payload, 'PX', 60_000); } catch { /* mem fallback */ }
    }
  }

  async takeQrDataUrl(userId: string): Promise<{ qrDataUrl: string; expiresAt: number } | null> {
    let payload: string | null = null;
    let expiresAt = Date.now() + 60_000;
    if (await ensureRedis()) {
      try {
        payload = await redis.get(K_QR(userId));
        const ttl = await redis.pttl(K_QR(userId));
        if (ttl > 0) expiresAt = Date.now() + ttl;
      } catch { /* fall through to mem */ }
    }
    if (!payload) {
      const hit = this.memQr.get(userId);
      if (!hit || Date.now() > hit.expiresAt) return null;
      payload = hit.payload; expiresAt = hit.expiresAt;
    }
    try {
      const qrDataUrl = await QRCode.toDataURL(payload, { margin: 1 });
      return { qrDataUrl, expiresAt };
    } catch { return null; }
  }

  clearQr(userId: string): void {
    this.memQr.delete(userId);
    redis.del(K_QR(userId)).catch(() => {});
  }

  // ---- delivery queue (IDs only) ----
  async enqueueDelivery(item: DueItem, delayMs = 0): Promise<void> {
    const memItem: MemDue = { ...item, notBefore: Date.now() + delayMs };
    // Honour backoff delays in the mem fallback too, not just Redis.
    this.memDue = [...this.memDue.filter((d) => !(d.userId === item.userId && d.recordId === item.recordId)), memItem];
    if (await ensureRedis()) {
      try {
        // One roundtrip: queue + depth check pipelined.
        const [, depth] = await redis.pipeline()
          .zadd(Q_DUE, Date.now() + delayMs, JSON.stringify(item))
          .zcard(Q_DUE)
          .exec()
          .then((res) => [(res?.[0]?.[1] as number) ?? 0, (res?.[1]?.[1] as number) ?? 0] as const);
        void depth;
        if (depth > Q_DEPTH_WARN) logger.warn({ msg: 'delivery_queue_deep', depth });
        // Remove the mem copy once durably queued.
        this.memDue = this.memDue.filter((d) => !(d.userId === item.userId && d.recordId === item.recordId));
        return;
      } catch { logger.warn({ msg: 'redis_enqueue_failed_mem_fallback' }); }
    }
  }

  /** Claim up to `limit` due items in a single atomic Lua roundtrip. */
  async claimDue(limit = 10): Promise<DueItem[]> {
    if (await ensureRedis()) {
      try {
        const claimed = await redis.eval(
          `local items = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
           for _, m in ipairs(items) do redis.call('ZREM', KEYS[1], m) end
           return items`,
          1, Q_DUE, Date.now(), limit,
        ) as string[];
        if (claimed.length) return claimed.map((m) => JSON.parse(m) as DueItem);
      } catch { logger.warn({ msg: 'redis_claim_failed' }); }
    }
    // Mem fallback: only items whose backoff has elapsed.
    const now = Date.now();
    const due = this.memDue.filter((d) => d.notBefore <= now).slice(0, limit);
    if (due.length) {
      const ids = new Set(due.map((d) => `${d.userId}:${d.recordId}`));
      this.memDue = this.memDue.filter((d) => !ids.has(`${d.userId}:${d.recordId}`));
    }
    return due.map(({ notBefore: _nb, ...rest }) => rest);
  }

  async queueDepth(): Promise<number> {
    if (await ensureRedis()) {
      try { return await redis.zcard(Q_DUE); } catch { /* fall through */ }
    }
    return this.memDue.length;
  }

  // ---- worker heartbeat ----
  async heartbeat(): Promise<void> {
    process.env.WORKER_LAST_HEARTBEAT = String(Date.now());
    if (await ensureRedis()) {
      try { await redis.set(K_HB, String(Date.now()), 'EX', 120); } catch { /* ignore */ }
    }
  }

  async workerAlive(): Promise<boolean> {
    if (await ensureRedis()) {
      try {
        const v = await redis.get(K_HB);
        if (v && Date.now() - Number(v) < 120_000) return true;
      } catch { /* fall through */ }
    }
    const local = Number(process.env.WORKER_LAST_HEARTBEAT ?? 0);
    return Date.now() - local < 120_000;
  }
}

let singleton: TransientStore | null = null;
export function getTransient(): TransientStore {
  if (!singleton) singleton = new TransientStore();
  return singleton;
}
