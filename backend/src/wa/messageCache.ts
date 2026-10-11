// Bounded in-memory TTL cache for ordinary messages. NEVER persisted.
// Key: `${userId}:${waMessageId}` — deliberately NOT chat-scoped, because
// WhatsApp may reference the same message under different JID forms
// (LID vs PN) at receipt vs revoke time. Message IDs are unique enough that
// cross-chat collision is not a practical concern; the stored chatId is
// still verified on take() and logged on mismatch.
export interface CachedMessage {
  userId: string;
  chatId: string;
  waMessageId: string;
  senderRef: string;   // display-safe identifier only
  chatRef: string;
  text: string;        // plaintext lives here ONLY, transiently
  ts: number;          // original message timestamp ms
  receivedAt: number;
}

export class MessageCache {
  private map = new Map<string, { msg: CachedMessage; expiresAt: number }>();
  constructor(private max = 1000, private ttlMs = 15 * 60 * 1000) {}
  private key(userId: string, waMessageId: string) {
    return `${userId}:${waMessageId}`;
  }
  set(m: CachedMessage): void {
    if (this.map.size >= this.max) {
      // evict oldest
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest) this.map.delete(oldest);
    }
    this.map.set(this.key(m.userId, m.waMessageId), { msg: m, expiresAt: Date.now() + this.ttlMs });
  }
  take(userId: string, waMessageId: string): CachedMessage | null {
    const k = this.key(userId, waMessageId);
    const e = this.map.get(k);
    if (!e) return null;
    this.map.delete(k);
    if (Date.now() > e.expiresAt) return null;
    return e.msg;
  }
  peek(userId: string, waMessageId: string): CachedMessage | null {
    const e = this.map.get(this.key(userId, waMessageId));
    if (!e || Date.now() > e.expiresAt) return null;
    return e.msg;
  }
  sweep(now = Date.now()): number {
    let n = 0;
    for (const [k, v] of this.map) if (now > v.expiresAt) { this.map.delete(k); n++; }
    return n;
  }
  get size() { return this.map.size; }
}
