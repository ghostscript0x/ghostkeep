import { describe, it, expect } from 'vitest';
import { proto } from 'baileys';
import { extractRevokeTarget, extractText, normalizeIncoming, shouldIgnore } from './wa/baileysEvents.js';

const REVOKE = proto.Message.ProtocolMessage.Type.REVOKE;

function wm(over: Partial<proto.IWebMessageInfo>): proto.IWebMessageInfo {
  return {
    key: { remoteJid: '123@s.whatsapp.net', id: 'MSG1', fromMe: false },
    messageTimestamp: 1700000000,
    ...over,
  } as proto.IWebMessageInfo;
}

describe('baileys revoke detection', () => {
  it('extracts revoke target from protocolMessage', () => {
    const m = wm({ message: { protocolMessage: { key: { remoteJid: '123@s.whatsapp.net', id: 'ORIG1' }, type: REVOKE } } });
    expect(extractRevokeTarget(m)).toEqual({ chatId: '123@s.whatsapp.net', waMessageId: 'ORIG1' });
  });
  it('ignores non-revoke protocol messages', () => {
    const m = wm({ message: { protocolMessage: { key: { id: 'X' }, type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING } } });
    expect(extractRevokeTarget(m)).toBeNull();
  });
  it('returns null for ordinary text', () => {
    expect(extractRevokeTarget(wm({ message: { conversation: 'hi' } }))).toBeNull();
  });
});

describe('incoming text normalization', () => {
  it('accepts conversation + extended text', () => {
    expect(extractText(wm({ message: { conversation: 'hello' } }))).toBe('hello');
    expect(extractText(wm({ message: { extendedTextMessage: { text: 'hi there' } } }))).toBe('hi there');
  });
  it('rejects protocol messages, media-only, oversize', () => {
    expect(extractText(wm({ message: { protocolMessage: { type: REVOKE } } }))).toBeNull();
    expect(extractText(wm({ message: { imageMessage: {} } }))).toBeNull();
    expect(extractText(wm({ message: { conversation: 'x'.repeat(4001) } }))).toBeNull();
  });
  it('ignores own messages and status broadcasts', () => {
    expect(shouldIgnore(wm({ key: { remoteJid: 'a', id: 'b', fromMe: true } }))).toBe(true);
    expect(shouldIgnore(wm({ key: { remoteJid: 'status@broadcast', id: 'b' } }))).toBe(true);
    expect(shouldIgnore(wm({ message: { conversation: 'hi' } }))).toBe(false);
  });
  it('never caches our own notifications (loop guard)', () => {
    const n = normalizeIncoming(wm({ message: { conversation: '🕵️ Deleted message detected\nfoo' } }));
    expect(n).toBeNull();
    const v = normalizeIncoming(wm({ message: { conversation: 'Your GhostKeep verification code is 123456' } }));
    expect(v).toBeNull();
    const ok = normalizeIncoming(wm({ message: { conversation: 'real user text' } }));
    expect(ok).not.toBeNull();
    expect(ok?.waMessageId).toBe('MSG1');
  });
});
