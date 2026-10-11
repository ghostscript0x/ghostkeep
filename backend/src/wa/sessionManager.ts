import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
  type proto,
} from 'baileys';
import pino from 'pino';
import { pool } from '../db/pool.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getTransient, type DueItem } from './transient.js';
import { loadPgAuthState, clearPgAuthState } from './pgAuthState.js';
import { extractRevokeTarget, normalizeIncoming, senderOf, shouldIgnore } from './baileysEvents.js';
import { extractMediaRef, mediaCaption, mediaLabel, type MediaRef } from './media.js';
import { formatRecoveryNotification } from './pipeline.js';
import { encryptEnvelope, serialize, deserialize, decryptEnvelope } from '../crypto/envelope.js';
import { sha256Short } from '../crypto/auth.js';

// Full Baileys lifecycle per https://github.com/whiskeysockets/baileys README:
// pairing QR via connection.update, creds.update persistence (encrypted,
// Postgres-backed), messages.upsert + messages.delete revoke handling,
// reconnect policy on DisconnectReason, per-user sockets, verified-destination
// delivery through a Redis ID-only queue with retries.

const waLogger = pino({ level: process.env.WA_LOG_LEVEL ?? 'warn' });
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 3600_000];

export class SessionManager {
  private sockets = new Map<string, WASocket>();
  private connecting = new Map<string, Promise<WASocket>>();
  private userClosed = new Set<string>();
  private reconnectAttempts = new Map<string, number>();
  private transient = getTransient();

  async init(): Promise<void> {
    // Restore persisted sessions so ordinary restarts don't drop links (§13).
    const r = await pool.query(
      "SELECT user_id FROM whatsapp_sessions WHERE connection_status IN ('connected','connecting') AND encrypted_session_credentials <> ''",
    ).catch(() => ({ rows: [] as { user_id: string }[] }));
    for (const row of r.rows) {
      this.connect(row.user_id).catch((e) => logger.warn({ userId: row.user_id, msg: 'restore_failed', err: String(e).slice(0, 120) }));
    }
    setInterval(() => { this.transient.sweep(); }, 60_000).unref();
  }

  // ---------- pairing / lifecycle ----------

  async start(userId: string): Promise<{ qr: string; expiresAt: number }> {
    this.userClosed.delete(userId);
    this.reconnectAttempts.delete(userId);
    if (this.sockets.has(userId)) return { qr: '', expiresAt: Date.now() }; // already live; don't flap status
    await this.ensureSessionRow(userId);
    await this.connect(userId);
    for (let i = 0; i < 40; i++) {
      const hit = await this.transient.takeQrDataUrl(userId);
      // NOTE: takeQrDataUrl does not consume; re-readable until TTL expiry.
      if (hit && hit.qrDataUrl) return { qr: hit.qrDataUrl, expiresAt: hit.expiresAt };
      const st = await this.statusOf(userId);
      if (st === 'connected') return { qr: '', expiresAt: Date.now() };
      await new Promise((r) => setTimeout(r, 250));
    }
    return { qr: '', expiresAt: Date.now() };
  }

  private async ensureSessionRow(userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO whatsapp_sessions (user_id, encrypted_session_credentials, session_key_reference, connection_status)
       VALUES ($1,'',$2,'connecting') ON CONFLICT (user_id) DO UPDATE SET connection_status='connecting', updated_at=now()`,
      [userId, config.sessionCredKeyId],
    );
  }

  /**
   * Pairing-code linking (QR alternative): the user types their number here,
   * gets an 8-character code, and enters it in WhatsApp → Linked devices →
   * "Link with phone number". WhatsApp rate-limits code requests, so the
   * route carries its own strict limiter.
   */
  async requestPairingCode(userId: string, phone: string): Promise<{ code: string } | { paired: true }> {
    this.userClosed.delete(userId);
    this.reconnectAttempts.delete(userId);
    if (this.sockets.has(userId)) return { paired: true };
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) throw new Error('invalid_phone');
    await this.ensureSessionRow(userId);
    const sock = await this.connect(userId);
    if (this.sockets.has(userId)) return { paired: true };
    if (sock.authState.creds.registered) return { paired: true }; // will connect without a code
    const code = await sock.requestPairingCode(digits);
    logger.info({ userId, msg: 'pairing_code_issued' });
    return { code };
  }

  private statusOf(userId: string): Promise<string> {
    return pool.query('SELECT connection_status FROM whatsapp_sessions WHERE user_id=$1', [userId])
      .then((r) => r.rows[0]?.connection_status ?? 'disconnected')
      .catch(() => 'disconnected');
  }

  async connect(userId: string): Promise<WASocket> {
    const existing = this.sockets.get(userId);
    if (existing) return existing;
    const pending = this.connecting.get(userId);
    if (pending) return pending;
    const p = this.doConnect(userId).finally(() => this.connecting.delete(userId));
    this.connecting.set(userId, p);
    return p;
  }

  private async doConnect(userId: string): Promise<WASocket> {
    const { state, saveCreds, flush } = await loadPgAuthState(userId);
    let version: [number, number, number] | undefined;
    try {
      const v = await fetchLatestBaileysVersion();
      version = v.version;
    } catch { /* use Baileys default */ }

    const sock = makeWASocket({
      auth: state,
      version,
      logger: waLogger.child({ userId }) as never,
      printQRInTerminal: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false, // no history import in MVP (§5 non-goals)
      markOnlineOnConnect: false,
      getMessage: async () => undefined, // no persistent message store by design
    });

    sock.ev.on('creds.update', () => { void saveCreds(); });

    sock.ev.on('connection.update', (u) => {
      if (u.qr) void this.transient.stageQr(userId, u.qr);
      if (u.connection === 'open') {
        this.sockets.set(userId, sock);
        this.reconnectAttempts.delete(userId);
        this.transient.clearQr(userId);
        void this.updateStatus(userId, 'connected');
        logger.info({ userId, msg: 'wa_connected' });
      } else if (u.connection === 'close') {
        this.sockets.delete(userId);
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        void flush().finally(() => this.onClose(userId, code));
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const m of messages as WAMessage[]) {
        const info = m as unknown as proto.IWebMessageInfo;
        const revoke = extractRevokeTarget(info);
        if (revoke) { void this.handleRevoke(userId, revoke); continue; }
        if (shouldIgnore(info)) continue;
        const mediaRef = extractMediaRef(info.message);
        if (mediaRef) { void this.handleMediaIncoming(userId, info, m, mediaRef); continue; }
        const norm = normalizeIncoming(info);
        if (norm) void this.transient.cacheMessage({ ...norm, userId, receivedAt: Date.now() });
      }
    });

    sock.ev.on('messages.delete', (payload) => {
      const keys = 'keys' in payload ? payload.keys : [];
      for (const k of keys) {
        if (k.fromMe) continue; // our own deletes never create recoveries
        if (k.remoteJid && k.id) void this.handleRevoke(userId, { chatId: k.remoteJid, waMessageId: k.id });
      }
    });

    return sock;
  }

  private async onClose(userId: string, code?: number): Promise<void> {
    const fatal = code === DisconnectReason.loggedOut
      || code === DisconnectReason.forbidden
      || code === DisconnectReason.multideviceMismatch
      || code === DisconnectReason.badSession;
    if (this.userClosed.has(userId)) {
      await this.updateStatus(userId, 'disconnected');
      return;
    }
    if (fatal) {
      // Credentials revoked server-side: keep the row for forensics, require relink.
      this.reconnectAttempts.delete(userId);
      await this.updateStatus(userId, 'needs_relink', String(code));
      logger.warn({ userId, msg: 'wa_needs_relink', code });
      return;
    }
    const attempts = (this.reconnectAttempts.get(userId) ?? 0) + 1;
    this.reconnectAttempts.set(userId, attempts);
    if (attempts >= 10) {
      // Persistent failure (network down, stale creds): stop hammering and
      // surface a clear state instead of a silent 5s retry storm.
      this.reconnectAttempts.delete(userId);
      await this.updateStatus(userId, 'needs_relink', code ? String(code) : 'retry_exhausted');
      logger.warn({ userId, msg: 'wa_reconnect_exhausted', code });
      return;
    }
    await this.updateStatus(userId, 'connecting', code ? String(code) : null);
    // Reconnect with backoff unless the user disconnected meanwhile.
    await new Promise((r) => setTimeout(r, 5000 * Math.min(attempts, 4)));
    if (!this.userClosed.has(userId) && !this.sockets.has(userId)) {
      this.connect(userId).catch((e) => logger.error({ userId, msg: 'wa_reconnect_failed', err: String(e).slice(0, 120) }));
    }
  }

  private async updateStatus(userId: string, status: string, errorCode: string | null = null): Promise<void> {
    await pool.query(
      `UPDATE whatsapp_sessions SET connection_status=$2,
        last_connected_at=CASE WHEN $2='connected' THEN now() ELSE last_connected_at END,
        last_error_code=$3, updated_at=now() WHERE user_id=$1`,
      [userId, status, errorCode ? errorCode.slice(0, 32) : null],
    ).catch(() => {});
  }

  async disconnect(userId: string): Promise<void> {
    this.userClosed.add(userId);
    this.reconnectAttempts.delete(userId);
    const sock = this.sockets.get(userId);
    this.sockets.delete(userId);
    this.transient.clearQr(userId);
    try { await sock?.logout(); } catch { /* already closed */ }
    try { (sock as { end?: (e?: Error) => void } | undefined)?.end?.(new Error('user_disconnect')); } catch { /* ignore */ }
    await clearPgAuthState(userId);
    await pool.query("UPDATE whatsapp_sessions SET connection_status='disconnected', updated_at=now() WHERE user_id=$1", [userId]).catch(() => {});
    logger.info({ userId, msg: 'session_disconnected' });
  }

  // ---------- media: instant forward, zero retention ----------
  // Media bytes are relayed server-side via Baileys `{forward}` straight to
  // the tenant's verified destination and never downloaded, staged, or
  // persisted by us — nothing to delete afterwards because we hold nothing.
  // Only a caption/placeholder text is cached so a later revoke still yields
  // the "Deleted message detected" label pointing at the forwarded copy.

  private async handleMediaIncoming(userId: string, info: proto.IWebMessageInfo, waMsg: WAMessage, ref: MediaRef): Promise<void> {
    const chatId = info.key.remoteJid as string;
    const waMessageId = info.key.id as string;
    const ts = Number(info.messageTimestamp ?? Date.now() / 1000) * 1000;
    const base = {
      userId, chatId, waMessageId,
      senderRef: senderOf(info.key, info.pushName ?? undefined).slice(0, 160),
      chatRef: chatId.slice(0, 160), ts, receivedAt: Date.now(),
    };
    const caption = mediaCaption(ref);
    const placeholder = caption ?? `[${mediaLabel(ref.kind, ref.ptt)} — forwarded to your recovery chat on arrival]`;
    const d = await pool.query('SELECT destination_identifier, verification_status FROM recovery_destinations WHERE user_id=$1', [userId]).catch(() => null);
    const dest = d?.rows[0]?.verification_status === 'verified' ? (d.rows[0].destination_identifier as string) : null;
    if (!dest) {
      if (caption) await this.transient.cacheMessage({ ...base, text: caption });
      return;
    }
    try {
      if (!this.sockets.get(userId)) await this.connect(userId);
      const live = this.sockets.get(userId);
      if (!live) throw new Error('wa_not_connected');
      await live.sendMessage(dest, { forward: waMsg });
      await this.transient.cacheMessage({ ...base, text: placeholder });
    } catch (e) {
      if (caption) await this.transient.cacheMessage({ ...base, text: caption });
      logger.warn({ userId, msg: 'media_forward_failed', kind: ref.kind, err: String(e).slice(0, 120) });
    }
  }

  // ---------- deletion → recovery ----------

  async handleRevoke(userId: string, r: { chatId: string; waMessageId: string }): Promise<void> {
    try {
      const cached = await this.transient.takeMessage(userId, r.chatId, r.waMessageId);
      if (!cached) {
        await pool.query(
          "INSERT INTO deletion_events (user_id, wa_message_id, event_status) VALUES ($1,$2,'unmatched') ON CONFLICT (user_id, wa_message_id) DO UPDATE SET event_status='duplicate'",
          [userId, r.waMessageId],
        );
        logger.info({ userId, msg: 'revoke_unmatched' });
        return;
      }
      // DB-level idempotency claim FIRST: concurrent duplicate revoke events
      // (upsert + messages.delete for the same delete) race here, and only
      // the INSERT winner may create a recovery record. Losers exit quietly.
      const claim = await pool.query(
        "INSERT INTO deletion_events (user_id, wa_message_id, event_status) VALUES ($1,$2,'recovered') ON CONFLICT (user_id, wa_message_id) DO NOTHING RETURNING id",
        [userId, r.waMessageId],
      );
      if (!claim.rowCount) {
        logger.info({ userId, msg: 'revoke_duplicate' });
        return;
      }
      if (!config.recoveryMasterKey) throw new Error('missing_master_key');
      const payload = JSON.stringify({ text: cached.text, senderRef: cached.senderRef, chatRef: cached.chatRef, ts: cached.ts });
      const env = encryptEnvelope(config.recoveryMasterKey, config.recoveryKeyId, payload);
      const expires = new Date(Date.now() + config.retentionDays * 86400_000);
      const rec = await pool.query(
        `INSERT INTO recovery_records (user_id, encrypted_content, encryption_key_reference, source_chat_reference, sender_reference, original_message_timestamp, retention_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [userId, serialize(env), config.recoveryKeyId, sha256Short(cached.chatId), sha256Short(cached.senderRef), new Date(cached.ts), expires],
      );
      const recordId: string = rec.rows[0].id;
      await pool.query('UPDATE deletion_events SET recovery_record_id=$1 WHERE id=$2', [recordId, claim.rows[0].id]);
      await this.transient.enqueueDelivery({ userId, recordId, attempt: 0 });
      // Fast path: try immediate delivery too, so a collocated API process
      // doesn't wait for the worker loop.
      void this.drainDue(5);
      logger.info({ userId, msg: 'revoke_recovered' });
    } catch (e) {
      logger.error({ userId, msg: 'revoke_failed', err: (e as Error).message });
    }
  }

  /** Claim due queue items and attempt delivery (called by worker loop + API fast path). */
  async drainDue(limit = 10): Promise<number> {
    const items = await this.transient.claimDue(limit);
    let done = 0;
    for (const item of items) {
      await this.deliverDue(item);
      done++;
    }
    return done;
  }

  private async deliverDue(item: DueItem): Promise<void> {
    const { userId, recordId } = item;
    const attempt = item.attempt + 1;
    try {
      // Single roundtrip: record + destination together.
      const r = await pool.query(
        `SELECT r.delivery_status, r.encrypted_content,
          d.destination_identifier, d.verification_status
         FROM recovery_records r LEFT JOIN recovery_destinations d ON d.user_id=r.user_id
         WHERE r.id=$1 AND r.user_id=$2`,
        [recordId, userId],
      );
      if (!r.rowCount || r.rows[0].delivery_status === 'delivered') return; // idempotent ack
      if (!r.rows[0].destination_identifier || r.rows[0].verification_status !== 'verified') {
        await this.markFailed(userId, recordId, attempt, 'no_verified_destination');
        return;
      }
      const row = r.rows[0];
      if (!config.recoveryMasterKey) throw new Error('missing_master_key');
      const payload = JSON.parse(decryptEnvelope(config.recoveryMasterKey, deserialize(row.encrypted_content))) as { text: string; senderRef: string; chatRef: string; ts: number };
      const body = formatRecoveryNotification({ senderRef: payload.senderRef, chatRef: payload.chatRef, originalTs: payload.ts, text: payload.text });
      const dest = row.destination_identifier as string;
      await this.sendText(userId, dest, body);
      await pool.query("UPDATE recovery_records SET delivery_status='delivered', delivered_at=now() WHERE id=$1", [recordId]);
      await pool.query('UPDATE deletion_events SET delivery_attempt_count=$2 WHERE recovery_record_id=$1', [recordId, attempt]);
    } catch (e) {
      const code = String((e as Error).message ?? 'send_failed').slice(0, 64);
      await this.markFailed(userId, recordId, attempt, code);
    }
  }

  private async markFailed(userId: string, recordId: string, attempt: number, code: string): Promise<void> {
    if (attempt >= MAX_ATTEMPTS) {
      await pool.query("UPDATE recovery_records SET delivery_status='failed' WHERE id=$1", [recordId]);
      await pool.query('UPDATE deletion_events SET delivery_attempt_count=$2, last_delivery_error_code=$3 WHERE recovery_record_id=$1', [recordId, attempt, code]);
      logger.warn({ userId, msg: 'delivery_gave_up', code });
      return;
    }
    await pool.query('UPDATE deletion_events SET delivery_attempt_count=$2, last_delivery_error_code=$3 WHERE recovery_record_id=$1', [recordId, attempt, code]);
    await this.transient.enqueueDelivery({ userId, recordId, attempt }, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
  }

  // ---------- sending ----------

  async sendText(userId: string, jid: string, text: string): Promise<void> {
    let sock = this.sockets.get(userId);
    if (!sock) sock = await this.connect(userId);
    const live = this.sockets.get(userId);
    if (!live) throw new Error('wa_not_connected');
    await live.sendMessage(jid, { text });
  }
}

let singleton: SessionManager | null = null;
export function getSessionManager(): SessionManager {
  if (!singleton) singleton = new SessionManager();
  return singleton;
}
