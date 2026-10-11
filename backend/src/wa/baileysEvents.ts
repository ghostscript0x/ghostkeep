import { proto } from 'baileys';

// Pure Baileys message-shape helpers. No I/O, fully unit-testable.
// A "delete for everyone" arrives as a WAMessage whose body is a
// protocolMessage with type REVOKE (proto enum 0) carrying the key of the
// deleted message.

export interface NormalizedIncoming {
  chatId: string;
  waMessageId: string;
  senderRef: string;
  chatRef: string;
  text: string;
  ts: number;
  fromMe: boolean;
}

export interface RevokeTarget {
  chatId: string;
  waMessageId: string;
}

const REVOKE = proto.Message.ProtocolMessage.Type.REVOKE;

export function senderOf(key: proto.IMessageKey, pushName?: string): string {
  if (key.participant) return pushName ? `${pushName} (${key.participant})` : key.participant;
  return pushName ?? key.remoteJid ?? 'unknown';
}

export function extractRevokeTarget(m: proto.IWebMessageInfo): RevokeTarget | null {
  const pm = m.message?.protocolMessage;
  if (!pm || pm.type !== REVOKE || !pm.key?.id) return null;
  const chatId = m.key.remoteJid ?? pm.key.remoteJid ?? '';
  if (!chatId || !pm.key.id) return null;
  return { chatId, waMessageId: pm.key.id };
}

export function extractText(m: proto.IWebMessageInfo): string | null {
  const body = m.message;
  if (!body || body.protocolMessage) return null;
  const text =
    body.conversation ??
    body.extendedTextMessage?.text ??
    null;
  if (!text || text.length === 0 || text.length > 4000) return null;
  return text;
}

export function shouldIgnore(m: proto.IWebMessageInfo): boolean {
  if (m.key.fromMe) return true;
  const jid = m.key.remoteJid ?? '';
  if (jid === 'status@broadcast') return true; // status updates are out of MVP scope
  if (!m.key.id || !jid) return true;
  return false;
}

export function normalizeIncoming(m: proto.IWebMessageInfo): NormalizedIncoming | null {
  if (shouldIgnore(m)) return null;
  const text = extractText(m);
  if (!text) return null;
  // Loop guard: never re-cache our own recovery notifications.
  if (text.startsWith('🕵️ Deleted message detected') || text.startsWith('Your GhostKeep verification code')) return null;
  const ts = Number(m.messageTimestamp ?? Date.now() / 1000) * 1000;
  const chatId = m.key.remoteJid as string;
  return {
    chatId,
    waMessageId: m.key.id as string,
    senderRef: senderOf(m.key, m.pushName ?? undefined).slice(0, 160),
    chatRef: chatId.slice(0, 160),
    text,
    ts,
    fromMe: false,
  };
}
