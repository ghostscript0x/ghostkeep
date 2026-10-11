import type { proto } from 'baileys';

// Media support (post-MVP extension, owner-requested): voice notes, images,
// videos, documents, stickers. Pure helpers — no I/O, fully unit-testable.
//
// Delivery model: instant server-side `{forward}` to the verified destination
// on receipt. Bytes are never downloaded, staged, or persisted by us.
// View-once is intentionally NOT handled: those messages are skipped.

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface MediaRef {
  kind: MediaKind;
  mimetype: string;
  fileName?: string;
  ptt?: boolean;          // voice note flag for audio
  caption?: string;       // image/video caption, also cached as text
}

type MsgBody = proto.IMessage;

export function extractMediaRef(body: MsgBody | null | undefined): MediaRef | null {
  if (!body) return null;
  if (body.imageMessage) {
    return { kind: 'image', mimetype: body.imageMessage.mimetype ?? 'image/jpeg', caption: body.imageMessage.caption ?? undefined };
  }
  if (body.videoMessage) {
    return { kind: 'video', mimetype: body.videoMessage.mimetype ?? 'video/mp4', caption: body.videoMessage.caption ?? undefined };
  }
  if (body.audioMessage) {
    return { kind: 'audio', mimetype: body.audioMessage.mimetype ?? 'audio/ogg; codecs=opus', ptt: body.audioMessage.ptt ?? false };
  }
  if (body.documentMessage) {
    return { kind: 'document', mimetype: body.documentMessage.mimetype ?? 'application/octet-stream', fileName: body.documentMessage.fileName ?? 'document' };
  }
  if (body.stickerMessage) {
    return { kind: 'sticker', mimetype: body.stickerMessage.mimetype ?? 'image/webp' };
  }
  return null;
}

/** Caption doubles as the cached text so caption-only deletes still recover something. */
export function mediaCaption(ref: MediaRef): string | null {
  if (ref.caption && ref.caption.length > 0 && ref.caption.length <= 4000) return ref.caption;
  return null;
}

export function mediaLabel(kind: MediaKind, ptt?: boolean): string {
  if (kind === 'audio') return ptt ? 'voice note' : 'audio';
  return kind;
}
