import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db/pool.js';
import { checkSmtp } from './mailer.js';
import { getSessionManager } from './wa/sessionManager.js';
import { getTransient } from './wa/transient.js';

// Single-process runtime: API + WhatsApp sockets + delivery loop + retention.
// This process is the ONLY socket owner — never run worker.ts alongside it
// (two owners fight over the same WhatsApp session and knock each other off).
const app = createApp();
await checkSmtp();
const mgr = getSessionManager();
await mgr.init(); // restores persisted Baileys sessions
const transient = getTransient();

async function expireRetention(): Promise<void> {
  const r = await pool.query('DELETE FROM recovery_records WHERE retention_expires_at < now()').catch((e) => {
    logger.error({ msg: 'retention_sweep_failed', err: String(e).slice(0, 120) });
    return { rowCount: 0 };
  });
  if ((r.rowCount ?? 0) > 0) logger.info({ msg: 'retention_expired', count: r.rowCount });
}
await expireRetention();
setInterval(() => { void expireRetention(); }, 60 * 60 * 1000).unref();

const loop = async () => {
  try {
    await mgr.drainDue(20);
  } catch (e) {
    logger.error({ msg: 'drain_failed', err: String(e).slice(0, 120) });
  } finally {
    await transient.heartbeat();
    setTimeout(loop, 5000).unref();
  }
};
void loop();

// One-time admin bootstrap: set BOOTSTRAP_ADMIN_EMAIL once, promote, then unset.
if (process.env.BOOTSTRAP_ADMIN_EMAIL) {
  await pool.query('UPDATE users SET is_admin=true WHERE lower(email)=lower($1)', [process.env.BOOTSTRAP_ADMIN_EMAIL]);
  logger.info({ msg: 'admin_bootstrap_attempted' });
}
app.listen(config.port, () => logger.info({ msg: 'backend_listening', port: config.port }));
