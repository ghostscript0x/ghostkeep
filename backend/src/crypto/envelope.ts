import crypto from 'node:crypto';

export interface Envelope {
  v: 1;
  keyId: string;
  iv: string;          // base64
  dataKeyEnc: string;  // base64: data key wrapped by master key (AES-GCM)
  ct: string;          // base64 ciphertext of plaintext
  tag: string;         // base64 auth tag
}

function wrapKey(master: Buffer, dataKey: Buffer): { iv: Buffer; enc: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', master, iv);
  const enc = Buffer.concat([c.update(dataKey), c.final()]);
  return { iv, enc, tag: c.getAuthTag() };
}

function unwrapKey(master: Buffer, iv: Buffer, enc: Buffer, tag: Buffer): Buffer {
  const d = crypto.createDecipheriv('aes-256-gcm', master, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

export function encryptEnvelope(masterKey: Buffer, keyId: string, plaintext: string): Envelope {
  const dataKey = crypto.randomBytes(32);
  const w = wrapKey(masterKey, dataKey);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  // pack wrapped key as iv.enc.tag joined
  const dataKeyEnc = Buffer.concat([w.iv, w.tag, w.enc]).toString('base64');
  return { v: 1, keyId, iv: iv.toString('base64'), dataKeyEnc, ct: ct.toString('base64'), tag: tag.toString('base64') };
}

export function decryptEnvelope(masterKey: Buffer, env: Envelope): string {
  const raw = Buffer.from(env.dataKeyEnc, 'base64');
  const wIv = raw.subarray(0, 12);
  const wTag = raw.subarray(12, 28);
  const wEnc = raw.subarray(28);
  const dataKey = unwrapKey(masterKey, wIv, wEnc, wTag);
  const d = crypto.createDecipheriv('aes-256-gcm', dataKey, Buffer.from(env.iv, 'base64'));
  d.setAuthTag(Buffer.from(env.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8');
}

export function serialize(env: Envelope): string {
  return Buffer.from(JSON.stringify(env), 'utf8').toString('base64');
}
export function deserialize(s: string): Envelope {
  return JSON.parse(Buffer.from(s, 'base64').toString('utf8')) as Envelope;
}
