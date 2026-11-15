# card-api

CARD 主数据库（CloudBase `liwu-cny1313-d1gb2fukyb7cb19bb`）的单一云函数：集合 `card_persons` 的读写入口，HTTP 与 `callFunction` 双通道。

## 请求 / 回包

```json
{ "op": "getPerson", "key": "<CARD_API_KEY>", "payload": { "person_id": "100000531" } }
```

- 两条通道同一形状：HTTP 为 `POST`（body 即上述 JSON）；`callFunction` 时 `data` 同形。
- 回包一律带 `ok`；错误为 `{ ok:false, code, msg }`。错误码：`UNAUTHORIZED`、`NOT_FOUND`、`INVALID_FIELD`、`INVALID_ARG`、`UNKNOWN_OP`、`INTERNAL`。堆栈与密钥永不回吐。
- 认证：`key` 的 sha256 与集合 `card_api_keys`（`{name, sha256, created_at}`，当前一条 `name:'xiai'`）匹配。**密钥明文只在本机 `~/.config/card/api.env`（600）**，不入仓、不入日志。

## ops

| op | payload | 回包 |
|---|---|---|
| `ping` | `{}` | `{ok:true, version:'1', persons:<count>}` |
| `getPerson` | `{person_id}` | `{ok:true, person}` / `NOT_FOUND` |
| `listPersons` | `{cursor?, limit?=200, tag?}` | `{ok:true, rows, next_cursor}`（`_id` 严格递增游标，到尾 `''`；`limit` 上限 1000） |
| `searchPersons` | `{q, limit?=50}` | `{ok:true, rows}`（姓名/字/號/齋號/別號，简繁双向，字符级映射见 `lib/variants.js`） |
| `updatePersonFields` | `{person_id, fields:{...}, source}` | `{ok:true, person_id, version, changed}`；白名单字段，`version` +1，`updated_by=source` |
| `upsertPerson` | `{person, source}` | `{ok:true, person_id, created, via, version, changed}`；三级去重见下 |
| `exportPersons` | `{}` | `{ok:true, rows}`（全量，供导出静态快照） |
| `getIndex` | `{include_biehao?:false, since?:'<ISO>'}` | `{ok:true, generated_at, count, rows}`（轻量索引：固定 10 字段；`include_biehao:true` 另带 `biehao_text, zhaihao_alts`；`since` 只回 `updated_at` 更晚的行） |

`updatePersonFields` 白名单（`lib/ops.js#WRITABLE_FIELDS`）：`name/family_name/given_name/courtesy_name/courtesy_alt_names/art_name/biehao_text/zhaihao/zhaihao_alts/dynasty/birth_year/death_year/native_place/biography/tags` ＋ 7 个 xiai 来源字符串字段 `gender/cbdb_id/years_lived/birth_era_text/death_era_text/native_place_chs/biography_chs`。白名单外字段 ⇒ `INVALID_FIELD`。

- 7 个扩字段（`lib/ops.js#STRING_FIELDS`）**一律按字符串落库**（非字符串标量 `String()` 化），且**空值不写**：`''`/`null`/纯空白视为“不改动”，既不进 `update` 也不算 `changed`（回包 `skipped` 列出被跳过的键）。要清空这些字段须直接改库或新增专用 op。

### `upsertPerson` 去重与写盘语义

去重按固定优先级，命中即用该行，不新建：

1. 传了 `person.person_id` ⇒ 按 `_id` 命中则更新（`via:'person_id'`）
2. 否则按 `person.sources` **逐项**查（`sources.system` + `sources.id`，`elemMatch` 保证同一数组元素）⇒ 命中则复用该行 `person_id`（`via:'source:<system>:<id>'`；若历史上有重复行另带 `dupe_matches`）
3. 都不中 ⇒ `max+1` 取九位号新建（`via:'new'`）

- **部分更新**：已存在行只写“传入且非空白”的字段（空白字符串/空数组/null 视为未传，**不会清空**；要清空走 `updatePersonFields`），未传字段（`created_at`/`biography` 等）一律不动；`sources` 取新旧并集。新建时才写全。
- 有实际字段变化时 `version` +1、`updated_at=now`、`updated_by=source`；幂等重复调用不改版本。
- 并发：新建走 `add`（`_id=person_id`），撞唯一索引 `uniq_person_id` 时先复查 sources，再重取号重试一次；仍冲突 ⇒ `{ok:false, code:'CONFLICT'}`。

### `getIndex`：轻量索引（只读）

给 xiai 广场/名录用的薄投影，比全量 `exportPersons` 小数倍（当前 573 行：10 字段约 46 KB，全量约 640 KB）。

- **行字段固定 10 个**（`lib/ops.js#INDEX_FIELDS`）：`person_id / name / family_name / given_name / courtesy_name / art_name / zhaihao / dynasty / tags / cbdb_id`；缺失一律 `""` / `[]`，不省键。
- `include_biehao === true`（严格布尔）时每行多 `biehao_text` / `zhaihao_alts` 两个字段（`INDEX_EXTRA_FIELDS`），供全站搜索用。
- `since`（ISO 字符串）：只回 `updated_at` 严格晚于该时刻的行（没有 `updated_at` 的行一律保留）。非法时间 ⇒ `INVALID_ARG`。
- 体积/耗时：整表按 1000 行/页扫一遍（当前 573 行 = 1 次查询），结果在容器内缓存 60s；写操作（`updatePersonFields`/`upsertPerson`）成功即失效本地缓存。
- HTTP 通道：`getIndex` 回包带由 `generated_at + count` 派生的 `ETag`；请求带同名 `If-None-Match` 时回 **304 空体**（实测生效）。回包里的 `cache-control` 由 CloudBase 访问服务（`tcbgw`）重写为 `no-store`，故浏览器/CDN 层不缓存——真正的缓存语义是「**ETag 304 + 用 `generated_at` 做客户端/本地缓存键**」。其余 op 无 ETag。

## 部署

```bash
printf 'y\n' | tcb fn deploy card-api -e liwu-cny1313-d1gb2fukyb7cb19bb --force --dir /Users/kevin/bistro/card-api
```

- 配置来自本目录 `cloudbaserc.json`（Nodejs18.15 / timeout 20s / 256MB / 云端安装依赖 / `index.main`）。
- HTTP 通道路由：`card-api` → 云函数 `card-api`，入口 `https://liwu-cny1313-d1gb2fukyb7cb19bb-1463728495.ap-shanghai.app.tcloudbase.com/card-api`（`tcb service create -p card-api -f card-api -e <env>`）。
- 云函数内只 `tcb.init({env})`，不读取/传递 `TENCENTCLOUD_*`（运行时凭据交给 SDK）。

## 数据

- 集合 `card_persons`：`_id` 恒等于 `person_id`；索引 `uniq_person_id`（唯一）+ `idx_tags`。
- 当前 573 行，来源 `/Users/kevin/bistro/card/data/persons.json`，`version=1`、`updated_by='seed'`。
- 2026-11-13 回填：570 人从 `xiai_persons`（只读，按 `sources[{system:'xiai',id:'PR…'}]` 匹配）写入 7 个字符串字段，`updated_by='xiai-backfill-v1'`。实际有值的只有 3 个：`cbdb_id` 104 人、`native_place_chs` 568 人、`biography_chs` 570 人；`gender`/`years_lived`/`birth_era_text`/`death_era_text` 在 xiai 侧本就全空，故 CARD 侧**不落键**（不是空串、更不是 `"0"`）。3 个无 xiai 来源的库外藏家未动。
- `dynasty_source` 由种子派生：有 `dynasty` 且 `birth_year>0` ⇒ `birth_year`；仅有 `dynasty` ⇒ `seed`；否则 `''`。
