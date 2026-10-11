import type { CachedMessage } from './messageCache.js';

// Pure helpers: idempotent deletion matching + notification formatting.
// Kept dependency-free so unit tests prove correctness without Baileys/DB.

export type RevokeEvent = {
  userId: string;
  chatId: string;
  waMessageId: string;
  detectedAt: number;
};

export function isOwnOutgoing(fromMe: boolean, isNotification: boolean): boolean {
  return fromMe || isNotification;
}

export function formatRecoveryNotification(o: {
  senderRef: string; chatRef: string; originalTs?: number; text: string;
}): string {
  const when = o.originalTs ? new Date(o.originalTs).toISOString() : 'unknown time';
  return [
    '🕵️ Deleted message detected',
    `From: ${o.senderRef}`,
    `Chat: ${o.chatRef}`,
    `Sent: ${when}`,
    '',
    o.text,
    '',
    '_Recovered because it was captured before deletion. If content is missing, the message was not cached in time._',
  ].join('\n');
}

// Deduplication guard: caller must check (userId, waMessageId) unique constraint first.
export function dedupeKey(e: RevokeEvent): string {
  return `${e.userId}:${e.waMessageId}`;
}

export function matchCached(msg: CachedMessage | null): 'hit' | 'miss' {
  return msg ? 'hit' : 'miss';
}
