'use strict';

const { getDb } = require('./cloud');
const { authenticate } = require('./auth');
const ops = require('./ops');

const HANDLERS = {
  ping: ops.ping,
  getPerson: ops.getPerson,
  listPersons: ops.listPersons,
  searchPersons: ops.searchPersons,
  updatePersonFields: ops.updatePersonFields,
  upsertPerson: ops.upsertPerson,
  exportPersons: ops.exportPersons,
  getIndex: ops.getIndex,
};

/**
 * 请求形状：{ op, key, payload }；callFunction 的 data 同形。
 * 回包一律带 ok；错误为 { ok:false, code, msg }。
 */
async function dispatch(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) {
    return { ok: false, code: 'INVALID_ARG', msg: '请求体必须是对象' };
  }
  const op = req.op;
  if (typeof op !== 'string' || op.trim() === '') {
    return { ok: false, code: 'INVALID_ARG', msg: 'op 必填' };
  }
  const handler = HANDLERS[op.trim()];
  if (!handler) {
    return { ok: false, code: 'UNKNOWN_OP', msg: '未知的 op' };
  }
  const db = getDb();
  const auth = await authenticate(db, req.key);
  if (!auth.ok) {
    return { ok: false, code: 'UNAUTHORIZED', msg: 'key 无效' };
  }
  const payload = req.payload && typeof req.payload === 'object' && !Array.isArray(req.payload) ? req.payload : {};
  try {
    return await handler(db, payload);
  } catch (err) {
    const msg = err && err.message ? String(err.message).slice(0, 200) : 'unknown';
    console.error('[card-api] op ' + op.trim() + ' failed:', msg);
    return { ok: false, code: 'INTERNAL', msg: '操作失败' };
  }
}

module.exports = { dispatch, HANDLERS };
