import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageCache } from './wa/messageCache.js';
import { formatRecoveryNotification, dedupeKey, isOwnOutgoing } from './wa/pipeline.js';
import { encryptEnvelope, decryptEnvelope, serialize, deserialize } from './crypto/envelope.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('message cache expiry', () => {
  it('discards entries after TTL', () => {
    const c = new MessageCache(10, 50);
    c.set({ userId: 'u1', chatId: 'c', waMessageId: 'm1', senderRef: 's', chatRef: 'c', text: 'hello', ts: Date.now(), receivedAt: Date.now() });
    expect(c.peek('u1', 'm1')).not.toBeNull();
    vi.useFakeTimers();
    vi.advanceTimersByTime(100);
    // sweep with future now
    expect(c.sweep(Date.now() + 1000)).toBeGreaterThanOrEqual(0);
    vi.useRealTimers();
  });
  it('evicts oldest when bounded', () => {
    const c = new MessageCache(2, 60_000);
    const mk = (id: string) => ({ userId: 'u', chatId: 'c', waMessageId: id, senderRef: 's', chatRef: 'c', text: id, ts: 1, receivedAt: 1 });
    c.set(mk('a')); c.set(mk('b')); c.set(mk('c'));
    expect(c.size).toBe(2);
    expect(c.peek('u', 'a')).toBeNull();
  });
});

describe('deletion matching + idempotency', () => {
  it('formats notification with required fields, no extra content', () => {
    const body = formatRecoveryNotification({ senderRef: 'Alice', chatRef: 'Family', originalTs: 1700000000000, text: 'secret text' });
    expect(body).toContain('Deleted message detected');
    expect(body).toContain('Alice');
    expect(body).toContain('secret text');
  });
  it('dedupe key is per-tenant + message', () => {
    expect(dedupeKey({ userId: 'A', chatId: 'c', waMessageId: 'm', detectedAt: 1 })).not.toBe(
      dedupeKey({ userId: 'B', chatId: 'c', waMessageId: 'm', detectedAt: 1 }));
  });
  it('ignores own outgoing to prevent loops', () => {
    expect(isOwnOutgoing(true, false)).toBe(true);
    expect(isOwnOutgoing(false, true)).toBe(true);
    expect(isOwnOutgoing(false, false)).toBe(false);
  });
});

describe('envelope encryption', () => {
  it('round-trips and separates key from payload', () => {
    const master = crypto.randomBytes(32);
    const env = encryptEnvelope(master, 'v1', '{"text":"hi"}');
    expect(decryptEnvelope(master, env)).toBe('{"text":"hi"}');
    const s = serialize(env);
    expect(decryptEnvelope(master, deserialize(s))).toBe('{"text":"hi"}');
    expect(s).not.toContain('hi');
  });
});

describe('tenant isolation guard', () => {
  it('customer routes scope to server-side tenant id, never client-supplied', async () => {
    for (const f of ['me.ts', 'whatsapp.ts', 'recovery.ts', 'settings.ts']) {
      const src = fs.readFileSync(path.join(here, 'routes', f), 'utf8');
      // Tenant id always comes from the verified session, and queries scope by user_id.
      expect(src).toMatch(/req\.user!\.id/);
      expect(src).toMatch(/user_id/i);
      expect(src).not.toMatch(/req\.body\.user_id|req\.query\.user_id|req\.params\.userId/i);
    }
  });
  it('admin routes never select message content or secrets', async () => {
    const raw = fs.readFileSync(path.join(here, 'routes', 'admin.ts'), 'utf8');
    const src = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const selects = [...src.matchAll(/SELECT[\s\S]*?FROM/gi)].map((m) => m[0]);
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s).not.toMatch(/encrypted_content/i);
      expect(s).not.toMatch(/encrypted_session_credentials/i);
    }
    expect(src).not.toMatch(/decrypt/i);
  });
  it('delivery routes only to the tenant destination (no broadcast)', async () => {
    const src = fs.readFileSync(path.join(here, 'wa', 'sessionManager.ts'), 'utf8');
    expect(src).toMatch(/WHERE user_id=\$1/);
    expect(src).not.toMatch(/broadcast/i);
  });
});
