import { db } from './db.js';

/**
 * Standard Human-Readable ID Prefixes for Vishrea Studio
 * Pattern: PREFIX-YYYY-NNN (e.g. VEN-2026-001, CUST-2026-001, PROD-2026-001)
 */
export const ID_PREFIXES = {
  VENDOR: 'VEN',
  CUSTOMER: 'CUST',
  CATEGORY: 'CAT',
  PRODUCT: 'PROD',
  INVENTORY: 'INV',
  SALE: 'SALE',
  ORDER: 'ORD',
  PROCUREMENT: 'PO',
  MEMBERSHIP: 'MEM',
  GIFT: 'GIFT',
  EXCHANGE: 'EXC',
};

/**
 * Concurrency-safe atomic generation of sequential human-readable IDs.
 * Uses PostgreSQL row-level locks on id_sequences to guarantee unique, gapless,
 * monotonic numbers even during high-concurrency requests.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} [client=db]
 * @param {string} prefix Module prefix (e.g. 'ORD', 'PROD', 'CUST')
 * @param {number} [year] Calendar year (defaults to current year)
 * @returns {Promise<string>} Generated ID like 'ORD-2026-001'
 */
export async function nextHumanId(client = db, prefix, year = new Date().getFullYear()) {
  const cleanPrefix = String(prefix || '').trim().toUpperCase();
  const cleanYear = Number(year) || new Date().getFullYear();

  const query = `
    INSERT INTO id_sequences (prefix, year, current_val, updated_at)
    VALUES ($1, $2, 1, now())
    ON CONFLICT (prefix, year)
    DO UPDATE SET current_val = id_sequences.current_val + 1, updated_at = now()
    RETURNING current_val
  `;

  const res = await client.query(query, [cleanPrefix, cleanYear]);
  const seq = Number(res.rows[0]?.current_val || 1);
  return `${cleanPrefix}-${cleanYear}-${String(seq).padStart(3, '0')}`;
}

/**
 * Validate if a given string matches the standard PREFIX-YYYY-NNN format.
 */
export function isValidHumanId(id, expectedPrefix = null) {
  if (!id || typeof id !== 'string') return false;
  const match = id.match(/^([A-Z]{2,6})-(\d{4})-(\d{3,})$/);
  if (!match) return false;
  if (expectedPrefix && match[1] !== expectedPrefix.toUpperCase()) return false;
  return true;
}
