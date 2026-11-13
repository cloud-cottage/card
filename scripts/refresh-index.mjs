#!/usr/bin/env node
/**
 * 重生成 CARD 轻量索引（开发期脚本，不入运行时、不影响静态托管）。
 *
 * 用法：node scripts/refresh-index.mjs [--dry-run] [--out-dir data] [--api-url <url>] [--key-file <path>]
 *
 * 产出两份纯静态 JSON（由 card-api 的 getIndex op 拉取）：
 *   data/person-index.json       瘦版：10 字段，不含別號/別署齋號（广场/名录轻量加载）
 *   data/person-index-full.json  全版：12 字段，含 biehao_text / zhaihao_alts（站内搜索）
 *
 * 密钥只从本机 ~/.config/card/api.env 读取（CARD_API_KEY=...），命令行不接收密钥、
 * 也不写进任何文件。任何失败都非零退出，绝不落半份产物。
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const DEFAULT_API_URL =
  'https://liwu-cny1313-d1gb2fukyb7cb19bb-1463728495.ap-shanghai.app.tcloudbase.com/card-api';
const DEFAULT_KEY_FILE = path.join(homedir(), '.config', 'card', 'api.env');
// 默认产物目录 = 仓库内 data/（与本脚本位置绑定，任意 cwd 下运行都落对地方）
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'data');
const TIMEOUT_MS = 30_000;

function parseArgs(argv) {
  const out = { dryRun: false, outDir: DEFAULT_OUT_DIR, apiUrl: process.env.CARD_API_URL || DEFAULT_API_URL, keyFile: DEFAULT_KEY_FILE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--api-url') out.apiUrl = argv[++i];
    else if (a === '--key-file') out.keyFile = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return out;
}

function usage() {
  return [
    'usage: node scripts/refresh-index.mjs [--dry-run] [--out-dir data] [--api-url <url>] [--key-file <path>]',
    '',
    '  密钥取自 ~/.config/card/api.env 的 CARD_API_KEY（600），命令行不接受密钥。',
  ].join('\n');
}

async function loadKey(keyFile) {
  let text;
  try {
    text = await readFile(keyFile, 'utf8');
  } catch (err) {
    throw new Error(`读取密钥文件失败（${keyFile}）：${err.code || err.message}`);
  }
  const line = text.split('\n').find((l) => /^\s*(export\s+)?CARD_API_KEY\s*=/.test(l));
  if (!line) throw new Error(`密钥文件里没有 CARD_API_KEY（${keyFile}）`);
  const value = line.replace(/^\s*(export\s+)?CARD_API_KEY\s*=\s*/, '').trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error('CARD_API_KEY 为空');
  return value;
}

async function callIndex(apiUrl, key, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let body;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'getIndex', key, payload }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (!body || body.ok !== true) {
    throw new Error(`getIndex 失败：${(body && (body.code || body.msg)) || 'unknown'}`);
  }
  if (!Array.isArray(body.rows)) throw new Error('回包缺少 rows');
  return body;
}

/** 落盘格式 = 回包去掉 ok：{generated_at, count, rows}；1 空格缩进（同 data/persons.json 惯例）+ 尾换行，便于 diff */
function serialize(body) {
  const doc = { generated_at: body.generated_at, count: body.count, rows: body.rows };
  return JSON.stringify(doc, null, 1) + '\n';
}

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

function report(label, file, body, bytes) {
  const gz = zlib.gzipSync(bytes, { level: 9 }).length;
  const fields = body.rows.length > 0 ? Object.keys(body.rows[0]).length : 0;
  console.log(
    `${label}  ${path.basename(file)}  count=${body.count}  fields=${fields}  ` +
      `bytes=${bytes.length}  gzip=${gz}  generated_at=${body.generated_at}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const key = await loadKey(args.keyFile);
  const outDir = path.resolve(args.outDir);

  const thin = await callIndex(args.apiUrl, key, {});
  const full = await callIndex(args.apiUrl, key, { include_biehao: true });

  if (thin.count !== full.count) {
    throw new Error(`两份索引行数不一致：瘦版 ${thin.count} / 全版 ${full.count}`);
  }

  const thinText = serialize(thin);
  const fullText = serialize(full);
  const thinFile = path.join(outDir, 'person-index.json');
  const fullFile = path.join(outDir, 'person-index-full.json');

  report('瘦版', thinFile, thin, Buffer.from(thinText, 'utf8'));
  report('全版', fullFile, full, Buffer.from(fullText, 'utf8'));

  if (args.dryRun) {
    console.log('--dry-run：未写盘');
    return;
  }
  await mkdir(outDir, { recursive: true });
  await writeAtomic(thinFile, thinText);
  await writeAtomic(fullFile, fullText);
  console.log(`已写入 ${thinFile} 与 ${fullFile}`);
}

main().catch((err) => {
  console.error(`refresh-index 失败：${err && err.message ? err.message : err}`);
  process.exit(1);
});
