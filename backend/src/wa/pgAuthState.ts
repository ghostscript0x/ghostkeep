import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState } from 'baileys';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { encryptEnvelope, decryptEnvelope, serialize, deserialize } from '../crypto/envelope.js';

// Postgres-backed Baileys auth state (per Baileys README: "write auth & key
// states for SQL/no-SQL databases ... in any production grade system").
//
// The WHOLE blob {creds, keys} is envelope-encrypted with the dedicated
// session-credential master key before touching Postgres, and only ever
// decrypted transiently in the worker process. Plaintext creds never hit
// disk, logs, Redis, or the API response path.

type KeyMap = Record<string, unknown>;

function master(): Buffer {
  if (!config.sessionCredMasterKey) throw new Error('SESSION_CRED_MASTER_KEY missing');
  return config.sessionCredMasterKey;
}

async function readRow(userId: string): Promise<string | null> {
  const r = await pool.query('SELECT encrypted_session_credentials FROM whatsapp_sessions WHERE user_id=$1', [userId]);
  const v = r.rows[0]?.encrypted_session_credentials as string | undefined;
  return v && v.length > 0 ? v : null;
}

async function writeRow(userId: string, blob: string): Promise<void> {
  await pool.query(
    `INSERT INTO whatsapp_sessions (user_id, encrypted_session_credentials, session_key_reference)
     VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET encrypted_session_credentials=$2, session_key_reference=$3, updated_at=now()`,
    [userId, blob, config.sessionCredKeyId],
  );
}

export async function clearPgAuthState(userId: string): Promise<void> {
  await pool.query('UPDATE whatsapp_sessions SET encrypted_session_credentials=\'\', updated_at=now() WHERE user_id=$1', [userId]);
}

export async function loadPgAuthState(userId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; flush: () => Promise<void> }> {
  let creds: AuthenticationCreds = initAuthCreds();
  let keys: KeyMap = {};
  const stored = await readRow(userId).catch(() => null);
  if (stored) {
    try {
      const parsed = JSON.parse(decryptEnvelope(master(), deserialize(stored)), BufferJSON.reviver);
      creds = parsed.creds ?? initAuthCreds();
      keys = parsed.keys ?? {};
    } catch (e) {
      logger.error({ userId, msg: 'auth_state_decrypt_failed' });
      throw new Error('auth_state_unreadable');
    }
  }

  // Serialize writes per user to avoid interleaved encrypt+update races.
  let chain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    chain = chain.then(async () => {
      const raw = JSON.stringify({ creds, keys }, BufferJSON.replacer);
      await writeRow(userId, serialize(encryptEnvelope(master(), config.sessionCredKeyId, raw)));
    }).catch((e) => logger.error({ userId, msg: 'auth_state_persist_failed', err: String(e).slice(0, 120) }));
    return chain;
  };

  let debounce: NodeJS.Timeout | null = null;
  const scheduleKeySave = () => {
    if (debounce) return;
    debounce = setTimeout(() => { debounce = null; void persist(); }, 750);
    debounce.unref?.();
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: Record<string, unknown> = {};
        for (const id of ids) {
          let value = keys[`${type}-${id}`] ?? null;
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
          }
          data[id] = value;
        }
        return data as never;
      },
      set: async (data) => {
        for (const category of Object.keys(data)) {
          for (const id of Object.keys((data as Record<string, Record<string, unknown>>)[category])) {
            const value = (data as Record<string, Record<string, unknown>>)[category][id];
            const k = `${category}-${id}`;
            if (value) keys[k] = value;
            else delete keys[k];
          }
        }
        // Docs warn: keys MUST be saved whenever set() is called or messages stop flowing.
        scheduleKeySave();
      },
    },
  };

  const saveCreds = async () => { await persist(); };
  const flush = async () => { if (debounce) { clearTimeout(debounce); debounce = null; } await persist(); };
  return { state, saveCreds, flush };
}
