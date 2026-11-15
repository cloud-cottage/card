'use strict';

/**
 * 单一云函数入口：同时接受
 *   1) HTTP 访问服务 (POST，body 为 JSON 字符串或对象)
 *   2) callFunction（event 即 {op, key, payload}）
 * 任何异常一律折叠成结构化错误，绝不回吐堆栈或密钥。
 *
 * 缓存语义：仅 getIndex（只读、幂等）带 HTTP 缓存——Cache-Control: public, max-age=60
 * + 由 generated_at 派生的 ETag，客户端带 If-None-Match 命中即回 304 空体。
 * 其余 op 一律 no-store。
 */

const crypto = require('crypto');
const { dispatch } = require('./lib/api');

const INDEX_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';

function httpResponse(statusCode, bodyObj, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign(
      {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
      extraHeaders || {}
    ),
    body: JSON.stringify(bodyObj),
  };
}

function parseBody(event) {
  let body = event.body;
  if (event.isBase64Encoded && typeof body === 'string') {
    body = Buffer.from(body, 'base64').toString('utf8');
  }
  if (typeof body === 'string') {
    if (!body.trim()) return {};
    return JSON.parse(body);
  }
  if (body && typeof body === 'object') return body;
  return {};
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === lower) return String(headers[k] || '');
  }
  return '';
}

/** ETag 只由 generated_at + count 派生：同一份索引恒等，不读载荷、不含密钥 */
function indexEtag(res) {
  const seed = String(res.generated_at || '') + ':' + String(res.count);
  return '"' + crypto.createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 16) + '"';
}

exports.main = async (event) => {
  const isHttp = event && typeof event === 'object' && Object.prototype.hasOwnProperty.call(event, 'body');
  try {
    let req;
    if (isHttp) {
      try {
        req = parseBody(event);
      } catch (e) {
        return httpResponse(400, { ok: false, code: 'BAD_REQUEST', msg: 'body 不是合法 JSON' });
      }
    } else {
      req = event && typeof event === 'object' ? event : {};
    }
    const res = await dispatch(req);

    if (isHttp && req && typeof req.op === 'string' && req.op.trim() === 'getIndex' && res && res.ok) {
      const etag = indexEtag(res);
      const headers = { 'cache-control': INDEX_CACHE_CONTROL, etag };
      if (headerValue(event.headers, 'if-none-match') === etag) {
        return { statusCode: 304, headers, body: '' };
      }
      return httpResponse(200, res, headers);
    }

    return isHttp ? httpResponse(200, res) : res;
  } catch (err) {
    // 仅记录错误类型与简短消息（不含堆栈、不含请求载荷）
    const msg = err && err.message ? String(err.message).slice(0, 200) : 'unknown';
    console.error('[card-api] internal error:', msg);
    const res = { ok: false, code: 'INTERNAL', msg: '服务器内部错误' };
    return isHttp ? httpResponse(500, res) : res;
  }
};
