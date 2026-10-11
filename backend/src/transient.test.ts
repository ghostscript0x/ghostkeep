import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { getTransient } from './wa/transient.js';

// Path-agnostic: passes whether Redis is up (Lua/ZSET path) or down
// (mem fallback with notBefore). Delayed items must never be claimed early;
// immediate items must be claimed and consumed (take-once).
describe('delivery queue delays', () => {
  it('holds delayed items, delivers immediate ones once', async () => {
    const tr = getTransient();
    const tag = crypto.randomBytes(4).toString('hex');
    await tr.enqueueDelivery({ userId: 't-' + tag, recordId: 'r-delayed-' + tag, attempt: 0 }, 30_000);
    await tr.enqueueDelivery({ userId: 't-' + tag, recordId: 'r-now-' + tag, attempt: 0 });
    const first = await tr.claimDue(10);
    const ids = first.map((c) => c.recordId);
    expect(ids).toContain('r-now-' + tag);
    expect(ids).not.toContain('r-delayed-' + tag);
    // take-once: already claimed items are gone
    const second = await tr.claimDue(10);
    expect(second.map((c) => c.recordId)).not.toContain('r-now-' + tag);
  }, 20000);
});
