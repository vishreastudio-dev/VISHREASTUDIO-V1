import fs from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { log } from './log.js';

dotenv.config();

const { Pool, types } = pg;

// NUMERIC (1700) arrives as a string by default; money columns are NUMERIC(12,2) and
// safely representable as JS numbers at INR scale.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// BIGINT counts (count(*)) — safe for realistic row counts.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.PGUSER || 'postgres'}:${encodeURIComponent(process.env.PGPASSWORD || 'postgres')}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'vishrea'}`;

function sslConfig() {
  if (process.env.DATABASE_SSL !== 'true') return false;
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  if (caFile) return { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true };
  if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true') return { rejectUnauthorized: true };
  // Encrypted but unverified. Supply DATABASE_SSL_CA_FILE in production to verify the server certificate.
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString,
  ssl: sslConfig(),
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10_000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15_000),
  application_name: 'vishrea-studio',
});

pool.on('error', (err) => log.error('db.pool_error', { message: err.message }));

pool.on('connect', (client) => {
  client.on('error', (err) => {
    log.error('db.client_error', { message: err.message });
  });
});

export const db = {
  query(text, params = []) {
    return pool.query(text, params);
  },

  /**
   * Run `fn(client)` inside a single PostgreSQL transaction.
   * Any thrown error rolls the whole unit of work back.
   */
  async tx(fn, { isolation } = {}) {
    const allowed = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);
    if (isolation && !allowed.has(isolation)) throw new Error('invalid_isolation');
    const client = await pool.connect();
    client.afterCommit = [];
    try {
      await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      for (const cb of client.afterCommit) {
        try {
          cb();
        } catch (err) {
          log.error('db.after_commit_failed', { message: err.message });
        }
      }
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.afterCommit = null;
      client.release();
    }
  },

  /** Legacy helper: run a list of { sql, params } atomically. */
  async transaction(queries) {
    return this.tx(async (client) => {
      const results = [];
      for (const q of queries) results.push(await client.query(q.sql, q.params || []));
      return { results };
    });
  },

  /** Run `cb` once `client`'s transaction commits (immediately when `client` is not in `tx`). */
  onCommit(client, cb) {
    if (Array.isArray(client?.afterCommit)) client.afterCommit.push(cb);
    else cb();
  },

  async healthy() {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
};
