'use strict';

const { PERSONS } = require('./auth');
const { toTrad, toSimp } = require('./variants');

const MAX_LIMIT = 1000;
const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 50;

// getIndex：轻量索引（只读投影）。字段逐字固定，消费方（xiai 广场/名录）按此契约解析。
const INDEX_FIELDS = [
  'person_id',
  'name',
  'family_name',
  'given_name',
  'courtesy_name',
  'art_name',
  'zhaihao',
  'dynasty',
  'tags',
  'cbdb_id',
];
// include_biehao===true 时追加的两个字段（搜索用，别号最占体积）
const INDEX_EXTRA_FIELDS = ['biehao_text', 'zhaihao_alts'];
// 进程内缓存：同一容器 60s 内复用一次扫描结果，响应头另带 ETag/max-age=60
const INDEX_TTL_MS = 60 * 1000;
// 单次读上限：整表单页 1000 行（当前 573 行即一页）
const INDEX_PAGE_SIZE = 1000;

// 允许通过 updatePersonFields 写入的字段（白名单，逐字固定）
const WRITABLE_FIELDS = [
  'name',
  'family_name',
  'given_name',
  'courtesy_name',
  'courtesy_alt_names',
  'art_name',
  'biehao_text',
  'zhaihao',
  'zhaihao_alts',
  'dynasty',
  'birth_year',
  'death_year',
  'native_place',
  'biography',
  'tags',
];

// 2026-11-13 扩字段（数据源 xiai_persons，回填用）：一律按字符串落库，空值不写。
// 空值不写 = 传 ''/null/纯空白 视为“不改动”，绝不把已有值冲掉。
const STRING_FIELDS = [
  'gender',
  'cbdb_id',
  'years_lived',
  'birth_era_text',
  'death_era_text',
  'native_place_chs',
  'biography_chs',
  /* **2026-11-15 新增（xiai 专用辨识面）**：繁体【姓】【名】。
     与 `_chs`（简体族）对称命名。语义分工：
       · `family_name` / `given_name` ＝ **简体标识面**，供 jiapu 等其它项目辨识用（今后可能被写成简体）；
       · `family_name_cht` / `given_name_cht` ＝ **繁体面**，**xiai 唯一辨识 / 展示来源**。
     空值不写（与 STRING_FIELDS 同规则），绝不冲掉已有值。 */
  'family_name_cht',
  'given_name_cht',
];
const STRING_FIELD_SET = new Set(STRING_FIELDS);
WRITABLE_FIELDS.push(...STRING_FIELDS);
const WRITABLE = new Set(WRITABLE_FIELDS);

// upsertPerson 可写字段 = 白名单 + 两个模型字段（sources 是服务端去重的依据，dynasty_source 由种子派生）
// 与 updatePersonFields 共用 WRITABLE_FIELDS 这一份常量，不另抄一份
const UPSERT_WRITABLE_FIELDS = WRITABLE_FIELDS.concat(['dynasty_source', 'sources']);

const MODEL_FIELDS = WRITABLE_FIELDS.concat(['person_id', 'dynasty_source', 'sources']);

function fail(code, msg) {
  return { ok: false, code, msg };
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v === undefined ? null : v;
}

function sameValue(a, b) {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

function clampLimit(raw, dflt) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function stripId(doc) {
  const { _id, ...rest } = doc;
  return rest;
}

/**
 * 分页读全表（服务端单页上限 1000；游标严格递增，空页收尾）。
 */
async function readAll(db, { pageSize = 1000, guardField } = {}) {
  const _ = db.command;
  const rows = [];
  let cursor = '';
  for (;;) {
    let q = db.collection(PERSONS);
    if (cursor) q = q.where({ _id: _.gt(cursor) });
    const res = await q.orderBy('_id', 'asc').limit(pageSize).get();
    const page = (res && res.data) || [];
    if (page.length === 0) break;
    for (const d of page) {
      if (guardField) {
        const { _id, ...rest } = d;
        rows.push({ _id, ...rest });
      } else rows.push(d);
    }
    cursor = page[page.length - 1]._id;
    if (page.length < pageSize) break;
  }
  return rows;
}

/* ---------------- ops ---------------- */

async function ping(db) {
  const res = await db.collection(PERSONS).count();
  const total = (res && (res.total !== undefined ? res.total : res.Total)) || 0;
  return { ok: true, version: '1', persons: total };
}

async function getPerson(db, payload) {
  const personId = payload && payload.person_id;
  if (!personId || typeof personId !== 'string') return fail('INVALID_ARG', 'person_id 必填');
  const res = await db.collection(PERSONS).doc(personId).get();
  const rows = (res && res.data) || [];
  if (rows.length === 0) return fail('NOT_FOUND', '人物不存在');
  return { ok: true, person: rows[0] };
}

async function listPersons(db, payload) {
  const p = payload || {};
  const limit = clampLimit(p.limit, DEFAULT_LIST_LIMIT);
  const _ = db.command;
  let q = db.collection(PERSONS);
  const where = {};
  if (p.cursor) where._id = _.gt(String(p.cursor));
  if (p.tag) where.tags = String(p.tag);
  if (Object.keys(where).length > 0) q = q.where(where);
  const res = await q.orderBy('_id', 'asc').limit(limit).get();
  const rows = (res && res.data) || [];
  const nextCursor = rows.length === limit ? rows[rows.length - 1]._id : '';
  return { ok: true, rows, next_cursor: nextCursor };
}

function searchVariants(text) {
  const raw = String(text == null ? '' : text);
  const set = new Set([raw, toSimp(raw), toTrad(raw)]);
  return Array.from(set).filter((s) => s.length > 0);
}

function personSearchText(doc) {
  const parts = [
    doc.name,
    doc.family_name,
    doc.given_name,
    doc.courtesy_name,
    doc.art_name,
    doc.biehao_text,
    doc.zhaihao,
  ];
  for (const arr of [doc.courtesy_alt_names, doc.zhaihao_alts]) {
    if (Array.isArray(arr)) parts.push(arr.join('\n'));
  }
  return parts.filter((x) => typeof x === 'string' && x.length > 0);
}

async function searchPersons(db, payload) {
  const p = payload || {};
  const q = p.q;
  if (!q || typeof q !== 'string' || !q.trim()) return fail('INVALID_ARG', 'q 必填');
  const limit = clampLimit(p.limit, DEFAULT_SEARCH_LIMIT);
  const needle = q.trim();
  const qVariants = searchVariants(needle);
  const all = await readAll(db);
  const scored = [];
  for (const doc of all) {
    const texts = personSearchText(doc);
    const expanded = [];
    for (const t of texts) {
      expanded.push(t, toSimp(t), toTrad(t));
    }
    let hit = false;
    for (const nv of qVariants) {
      for (const ev of expanded) {
        if (ev.indexOf(nv) !== -1) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (!hit) continue;
    // 排序权重：姓名全等 0 < 姓名包含 1 < 其它字段 2
    let rank = 2;
    const nameVariants = [doc.name, toSimp(doc.name || ''), toTrad(doc.name || '')];
    if (qVariants.some((v) => nameVariants.indexOf(v) !== -1)) rank = 0;
    else if (qVariants.some((v) => nameVariants.some((nv) => nv && nv.indexOf(v) !== -1))) rank = 1;
    scored.push({ rank, row: doc });
  }
  scored.sort((a, b) => (a.rank - b.rank) || String(a.row._id).localeCompare(String(b.row._id)));
  return { ok: true, rows: scored.slice(0, limit).map((s) => s.row) };
}

async function updatePersonFields(db, payload) {
  const p = payload || {};
  const personId = p.person_id;
  if (!personId || typeof personId !== 'string') return fail('INVALID_ARG', 'person_id 必填');
  const fields = p.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return fail('INVALID_ARG', 'fields 必须是对象');
  const keys = Object.keys(fields);
  if (keys.length === 0) return fail('INVALID_ARG', 'fields 不能为空');
  const bad = keys.filter((k) => !WRITABLE.has(k));
  if (bad.length > 0) return fail('INVALID_FIELD', '不允许修改的字段：' + bad.join(','));

  const res = await db.collection(PERSONS).doc(personId).get();
  const rows = (res && res.data) || [];
  if (rows.length === 0) return fail('NOT_FOUND', '人物不存在');
  const current = rows[0];

  // 扩字段一律按字符串落库；空值不写（不参与比较、不进 update）
  const incoming = {};
  const skipped = [];
  for (const k of keys) {
    if (STRING_FIELD_SET.has(k)) {
      if (isBlankValue(fields[k])) {
        skipped.push(k);
        continue;
      }
      incoming[k] = typeof fields[k] === 'string' ? fields[k] : String(fields[k]);
    } else incoming[k] = fields[k];
  }

  const changed = [];
  const update = {};
  for (const k of Object.keys(incoming)) {
    if (!sameValue(current[k], incoming[k])) {
      changed.push(k);
      update[k] = incoming[k];
    }
  }
  const source = typeof p.source === 'string' && p.source ? p.source.slice(0, 64) : 'api';
  if (changed.length === 0) {
    return { ok: true, person_id: personId, version: current.version || 1, changed: [], skipped };
  }
  const nextVersion = (Number(current.version) || 0) + 1;
  update.version = nextVersion;
  update.updated_at = new Date().toISOString();
  update.updated_by = source;

  await db.collection(PERSONS).doc(personId).update(update);

  // 回读核验
  const back = await db.collection(PERSONS).doc(personId).get();
  const after = (back && back.data && back.data[0]) || null;
  if (!after) return fail('INTERNAL', '写入后回读失败');
  const mismatch = changed.filter((k) => !sameValue(after[k], update[k]));
  if (mismatch.length > 0) return fail('INTERNAL', '回读不一致：' + mismatch.join(','));
  invalidateIndexCache();
  return { ok: true, person_id: personId, version: after.version, changed, skipped };
}

async function allocatePersonId(db) {
  const res = await db.collection(PERSONS).orderBy('person_id', 'desc').limit(1).get();
  const rows = (res && res.data) || [];
  const maxId = rows.length > 0 ? Number(rows[0].person_id) : 100000000;
  return String(maxId + 1).padStart(9, '0');
}

/* ---------------- upsertPerson ---------------- */

/** 空值判定：undefined/null/空串/纯空白/空数组/非有限数字 ⇒ 视为“没传” */
function isBlankValue(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return !Number.isFinite(v);
  return false;
}

/** 归一化并去重 sources（[{system,id}]，id 允许数字） */
function normalizeSources(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const s of raw) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const system = typeof s.system === 'string' ? s.system.trim() : '';
    let id = '';
    if (typeof s.id === 'string') id = s.id.trim();
    else if (typeof s.id === 'number' && Number.isFinite(s.id)) id = String(s.id);
    if (!system || !id) continue;
    const k = system + '\u0000' + id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ system, id });
  }
  return out;
}

function mergeSources(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const list of [existing, incoming]) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      if (!s || typeof s !== 'object') continue;
      const system = typeof s.system === 'string' ? s.system : '';
      let id = '';
      if (typeof s.id === 'string') id = s.id;
      else if (typeof s.id === 'number' && Number.isFinite(s.id)) id = String(s.id);
      if (!system || !id) continue;
      const k = system + '\u0000' + id;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ system, id });
    }
  }
  return out;
}

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === '11000' || err.errCode === 11000) return true;
  const msg = String(err.message || err.errMsg || '');
  return /E11000|duplicate key|Duplicated Key|唯一索引|唯一键/i.test(msg);
}

async function getDoc(db, personId) {
  const res = await db.collection(PERSONS).doc(personId).get();
  return (res && res.data && res.data[0]) || null;
}

/** 按 sources 单项精确匹配（elemMatch 保证 system 与 id 落在同一数组元素上），返回 _id 升序前几条 */
async function findBySource(db, src) {
  const _ = db.command;
  const res = await db
    .collection(PERSONS)
    .where({ sources: _.elemMatch({ system: src.system, id: src.id }) })
    .orderBy('_id', 'asc')
    .limit(5)
    .get();
  return (res && res.data) || [];
}

/** 已存在行：只写“传入且非空”的字段（部分更新，未传字段一律不动） */
async function updateExistingPerson(db, current, fieldDoc, incomingSources, source, via) {
  const personId = String(current._id || current.person_id);
  const update = {};
  const changed = [];

  for (const k of Object.keys(fieldDoc)) {
    if (k === 'person_id' || k === 'sources') continue;
    if (!sameValue(current[k], fieldDoc[k])) {
      changed.push(k);
      update[k] = fieldDoc[k];
    }
  }
  if (incomingSources.length > 0) {
    const merged = mergeSources(current.sources, incomingSources);
    if (!sameValue(current.sources, merged)) {
      update.sources = merged;
      if (changed.indexOf('sources') === -1) changed.push('sources');
    }
  }

  if (changed.length === 0) {
    return { ok: true, person_id: personId, created: false, via, version: Number(current.version) || 1, changed: [] };
  }

  const nextVersion = (Number(current.version) || 0) + 1;
  update.version = nextVersion;
  update.updated_at = new Date().toISOString();
  update.updated_by = source;

  // 部分更新：绝不整文档 set，未传字段（含 created_at / biography 等）保持原样
  await db.collection(PERSONS).doc(personId).update(update);

  const after = await getDoc(db, personId);
  if (!after) return fail('INTERNAL', '写入后回读失败');
  const mismatch = changed.filter((k) => !sameValue(after[k], update[k]));
  if (mismatch.length > 0) return fail('INTERNAL', '回读不一致：' + mismatch.join(','));
  invalidateIndexCache();
  return { ok: true, person_id: personId, created: false, via, version: after.version, changed };
}

/**
 * 三级去重：person_id → sources(逐项) → 新建(max+1)。
 * 已存在行只做部分更新（只写传入且非空的字段）；新建时写全。
 * 回包带 via：'person_id' | 'source:<system>:<id>' | 'new'。
 */
async function upsertPerson(db, payload) {
  const p = payload || {};
  const person = p.person;
  if (!person || typeof person !== 'object' || Array.isArray(person)) return fail('INVALID_ARG', 'person 必须是对象');

  const source = typeof p.source === 'string' && p.source ? p.source.slice(0, 64) : 'api';
  const now = new Date().toISOString();

  // 显式 person_id（可选）
  let explicitId = '';
  if (person.person_id !== undefined && person.person_id !== null && person.person_id !== '') {
    explicitId = String(person.person_id);
    if (!/^\d{1,9}$/.test(explicitId)) return fail('INVALID_ARG', 'person_id 必须是数字');
  }

  const incomingSources = normalizeSources(person.sources);

  // 只收“传入且非空”的白名单字段；sources 走 mergeSources 单独处理，避免原始列表覆盖已合并结果
  const fieldDoc = {};
  for (const k of UPSERT_WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(person, k)) continue;
    if (k === 'person_id' || k === 'sources') continue;
    const v = person[k];
    if (isBlankValue(v)) continue; // 空值一律不覆盖（清空走 updatePersonFields）
    fieldDoc[k] = STRING_FIELD_SET.has(k) && typeof v !== 'string' ? String(v) : v;
  }

  // a) 按 person_id
  if (explicitId) {
    const hit = await getDoc(db, explicitId);
    if (hit) return updateExistingPerson(db, hit, fieldDoc, incomingSources, source, 'person_id');
  }

  // b) 按 sources 逐项查（顺序即优先级）
  for (const src of incomingSources) {
    const hits = await findBySource(db, src);
    if (hits.length > 0) {
      const via = 'source:' + src.system + ':' + src.id;
      const res = await updateExistingPerson(db, hits[0], fieldDoc, incomingSources, source, via);
      if (res && res.ok && hits.length > 1) res.dupe_matches = hits.length; // 历史重复行计数，供调用方审计
      return res;
    }
  }

  // c) 新建（显式 id 优先，否则 max+1）；唯一索引 uniq_person_id 兜底，冲突重试一次
  let attempt = 0;
  let personId = explicitId;
  for (;;) {
    attempt += 1;
    if (!personId) personId = await allocatePersonId(db);

    const doc = Object.assign({}, fieldDoc, {
      _id: personId,
      person_id: personId,
      version: 1,
      created_at: now,
      updated_at: now,
      updated_by: source,
    });
    if (incomingSources.length > 0) doc.sources = incomingSources; // 新建时才写全；未传就不落空数组

    try {
      await db.collection(PERSONS).add(doc);
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // 并发抢占：先确认是否别人刚插了同一个来源，能复用就复用
      for (const src of incomingSources) {
        const hits = await findBySource(db, src);
        if (hits.length > 0) {
          return updateExistingPerson(db, hits[0], fieldDoc, incomingSources, source, 'source:' + src.system + ':' + src.id);
        }
      }
      if (attempt >= 2 || explicitId) {
        return fail('CONFLICT', 'person_id 分配冲突，请重试');
      }
      personId = ''; // 重新取号
      continue;
    }

    const after = await getDoc(db, personId);
    if (!after) return fail('INTERNAL', '写入后回读失败');
    const bad = Object.keys(fieldDoc).filter((k) => !sameValue(after[k], fieldDoc[k]));
    if (bad.length > 0) return fail('INTERNAL', '回读不一致：' + bad.join(','));
    invalidateIndexCache();
    return { ok: true, person_id: personId, created: true, via: 'new', version: after.version, changed: Object.keys(fieldDoc) };
  }
}

async function exportPersons(db) {
  const rows = await readAll(db);
  return { ok: true, rows };
}

/* ---------------- getIndex（轻量索引，只读） ---------------- */

// 进程内索引缓存：{ at:<Date.now()>, generated_at:<ISO>, docs:[...] }
let _indexCache = null;

/** 写操作成功后调用：下一读必重算（跨容器仍有 60s TTL 兜底） */
function invalidateIndexCache() {
  _indexCache = null;
}

function asText(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

function asTextArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string');
}

/** 投影一行：固定 10 字段，顺序即 INDEX_FIELDS；include_biehao 时追加 2 个 */
function projectIndexRow(doc, includeBiehao) {
  const row = {
    person_id: asText(doc.person_id || doc._id),
    name: asText(doc.name),
    /* **2026-11-15**：索引同时带两面 —— `*_cht` 给 xiai（繁体辨识/展示），
       旧 `family_name` / `given_name`（简体标识面）保留，供其它项目与兼容回落。 */
    family_name: asText(doc.family_name),
    given_name: asText(doc.given_name),
    family_name_cht: asText(doc.family_name_cht),
    given_name_cht: asText(doc.given_name_cht),
    courtesy_name: asText(doc.courtesy_name),
    art_name: asText(doc.art_name),
    zhaihao: asText(doc.zhaihao),
    dynasty: asText(doc.dynasty),
    tags: asTextArray(doc.tags),
    cbdb_id: asText(doc.cbdb_id),
  };
  if (includeBiehao) {
    row.biehao_text = asText(doc.biehao_text);
    row.zhaihao_alts = asTextArray(doc.zhaihao_alts);
  }
  return row;
}

/** 缓存命中则复用；否则整表按 1000 行/页扫一遍（当前 573 行 = 1 次查询） */
async function loadIndexDocs(db) {
  const now = Date.now();
  if (_indexCache && now - _indexCache.at < INDEX_TTL_MS && Array.isArray(_indexCache.docs)) {
    return _indexCache;
  }
  const docs = await readAll(db, { pageSize: INDEX_PAGE_SIZE });
  _indexCache = { at: now, generated_at: new Date(now).toISOString(), docs };
  return _indexCache;
}

/**
 * payload: { include_biehao?: boolean, since?: ISO }
 * 回包: { ok:true, generated_at, count, rows }
 * since 给定时只回 updated_at 严格晚于该时刻的行（无 updated_at 的行一律保留）。
 */
async function getIndex(db, payload) {
  const p = payload || {};
  const includeBiehao = p.include_biehao === true;

  let sinceMs = null;
  if (p.since !== undefined && p.since !== null && p.since !== '') {
    if (typeof p.since !== 'string') return fail('INVALID_ARG', 'since 必须是 ISO 时间字符串');
    const t = Date.parse(p.since);
    if (!Number.isFinite(t)) return fail('INVALID_ARG', 'since 不是合法时间');
    sinceMs = t;
  }

  const entry = await loadIndexDocs(db);
  let docs = entry.docs;
  if (sinceMs !== null) {
    docs = docs.filter((d) => {
      const t = Date.parse(d && d.updated_at);
      return Number.isFinite(t) ? t > sinceMs : true;
    });
  }
  const rows = docs.map((d) => projectIndexRow(d, includeBiehao));
  return { ok: true, generated_at: entry.generated_at, count: rows.length, rows };
}

module.exports = {
  WRITABLE_FIELDS,
  STRING_FIELDS,
  MODEL_FIELDS,
  INDEX_FIELDS,
  INDEX_EXTRA_FIELDS,
  ping,
  getPerson,
  listPersons,
  searchPersons,
  updatePersonFields,
  upsertPerson,
  exportPersons,
  getIndex,
  invalidateIndexCache,
  readAll,
};
