import { describe, it, expect } from 'vitest';
import { extractMediaRef, mediaCaption, mediaLabel } from './wa/media.js';

describe('media detection', () => {
  it('detects image with caption', () => {
    expect(extractMediaRef({ imageMessage: { mimetype: 'image/jpeg', caption: 'look' } })).toEqual(
      { kind: 'image', mimetype: 'image/jpeg', caption: 'look' });
  });
  it('detects voice note vs plain audio', () => {
    expect(extractMediaRef({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } })?.ptt).toBe(true);
    expect(extractMediaRef({ audioMessage: { mimetype: 'audio/mpeg', ptt: false } })).toMatchObject({ kind: 'audio', ptt: false });
    expect(mediaLabel('audio', true)).toBe('voice note');
    expect(mediaLabel('audio', false)).toBe('audio');
  });
  it('detects video, document, sticker; null for text', () => {
    expect(extractMediaRef({ videoMessage: { mimetype: 'video/mp4' } })?.kind).toBe('video');
    expect(extractMediaRef({ documentMessage: { mimetype: 'application/pdf', fileName: 'a.pdf' } })).toMatchObject({ kind: 'document', fileName: 'a.pdf' });
    expect(extractMediaRef({ stickerMessage: { mimetype: 'image/webp' } })?.kind).toBe('sticker');
    expect(extractMediaRef({ conversation: 'hi' })).toBeNull();
    expect(extractMediaRef(null)).toBeNull();
  });
  it('caption guard rejects empty/oversize', () => {
    expect(mediaCaption({ kind: 'image', mimetype: 'image/jpeg', caption: 'ok' })).toBe('ok');
    expect(mediaCaption({ kind: 'image', mimetype: 'image/jpeg' })).toBeNull();
    expect(mediaCaption({ kind: 'image', mimetype: 'image/jpeg', caption: 'x'.repeat(4001) })).toBeNull();
  });
  it('skips view-once wrappers entirely', () => {
    expect(extractMediaRef({ viewOnceMessage: { message: { imageMessage: { mimetype: 'image/jpeg' } } } })).toBeNull();
    expect(extractMediaRef({ viewOnceMessageV2: { message: { videoMessage: { mimetype: 'video/mp4' } } } })).toBeNull();
  });
});
