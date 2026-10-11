import { Pool } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const pool = new Pool({ connectionString: config.databaseUrl });
// Idle-client errors would otherwise crash the process; log and continue
// (the pool discards the broken client automatically).
pool.on('error', (err) => logger.error({ msg: 'pg_pool_error', err: String(err).slice(0, 160) }));
