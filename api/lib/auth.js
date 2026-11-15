'use strict';

const crypto = require('crypto');

const KEY_COLLECTION = 'card_api_keys';
const PERSONS = 'card_persons';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

/**
 * key 逐个与 card_api_keys.sha256 比对（只比较哈希，明文从不落库/落日志）。
 * @returns {Promise<{ok:boolean, name?:string}>}
 */
async function authenticate(db, key) {
  if (typeof key !== 'string' || key.length === 0) return { ok: false };
  const hashed = sha256Hex(key);
  const res = await db.collection(KEY_COLLECTION).where({ sha256: hashed }).limit(1).get();
  const rows = (res && res.data) || [];
  if (rows.length === 0) return { ok: false };
  return { ok: true, name: rows[0].name || 'unknown' };
}

module.exports = { authenticate, sha256Hex, KEY_COLLECTION, PERSONS };
