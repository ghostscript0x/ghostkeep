import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
// Make CITEXT optional: if extension missing, drop CITEXT usage gracefully.
async function migrate() {
  const sql = schema.replace('email CITEXT UNIQUE NOT NULL,', 'email TEXT NOT NULL,');
  await pool.query(sql);
  console.log('migrated');
  await pool.end();
}
migrate().catch((e) => { console.error(e); process.exit(1); });
