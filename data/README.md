# CARD 数据目录（`data/`）口径说明

本目录是 CARD 的**纯静态数据层**：只有 JSON 文件，无脚本、无依赖、无构建步骤。页面与本文档均不联网取数。

```
data/
├── persons.json              # 人物主表（每人一条，按 person_id 升序，17 键）
├── person-index.json         # 轻量索引·瘦版（10 键，不含別號；广场/名录用）
├── person-index-full.json    # 轻量索引·全版（12 键，含別號/別署齋號；站内搜索用）
├── tags.json                 # 标签词表（本期两类）
├── id-map.json               # 反向映射 / 回填表（person_id ⇄ 数据源 id + 印主印章数）
└── README.md                 # 本文件（口径说明）
```

## 1. `person_id`：九位数字，永不变

- 形态固定为**九位数字，仅含 `0`-`9`**，首位从 `100000001` 起。示例：`100000531`。
- **一次分配，永不复用、永不改号**：人物改名、补传生卒年、合并重复条目、乃至条目下架，都不重新编号；空出的号直接弃用，不回收给他人。
- 本期分配顺序（**可复现**）：先按 `name` 用 `Intl.Collator('zh-Hans-CN', { collation: 'pinyin' })` 排序，同名者再按 `sources[0].id` 升序；第 `i` 位（从 1 起）取 `100000000 + i`。因此同一份数据源重跑，得到的号完全相同（`persons.json` 不含时间戳，两次生成字节相等）。
- 对外一律只用 `person_id` 指称人物；引用规范页的示例号即此形态。

## 2. 标签词表（`tags.json`）

| `code` | `label` | 含义 |
|---|---|---|
| `yinren` | 印人 | 篆刻創作者（刻印之人）——即印章的**作者** |
| `cangjia` | 藏家 | 印章收藏者（印主）——即印章的**持有人** |

- 一人**可同时**具备两类：既刻印又藏印者，`tags` 为 `["印人","藏家"]`。
- 词表可扩展：新增标签只追加、不改既有 `code`/`label` 的语义；`code` 恒为小写、无空格。
- 本期计数：`印人` 570 人，`藏家` 10 人（两标签交集 7 人）。

## 3. `sources`：只作来源可追溯，不对外宣称内部编号

`sources` 记录每条人物数据**出自何处**，供回填与核对：

| `system` | `id` 形态 | 说明 |
|---|---|---|
| `xiai` | `PR…` | 玺爱（xiai）人物库的内部人员 id |
| `cbdb` | 数字串 | 哈佛 CBDB 的人物 id（仅在该人物已有 CBDB 对应时出现） |
| `xiai-seals` | 归一后的姓名 | 仅见于「库外藏家」（印章印主，未收录于 xiai 人物库，无 `PR` id） |

- **这些 id 是内部编号，仅作数据溯源与内部回填之用，不构成对外标识**；对外介绍、引用、接口一律只使用九位数字的 `person_id`。
- `xiai` 的 `PR…` 与 CBDB 的数字 id 都不外泄为「CARD 编号」，CARD 也不复用它们的编号空间。

## 4. 字段与缺失值约定

`persons.json` 每人固定 17 个键，**缺失即用空值占位，绝不省略键**（便于消费方稳定解析）：

| 键 | 类型 | 缺失时 |
|---|---|---|
| `person_id` | string（九位数字） | 必填 |
| `name` | string（繁体，姓+名） | 必填 |
| `family_name` / `given_name` | string | `""` |
| `courtesy_name` | string（字） | `""` |
| `courtesy_alt_names` | string[]（异写字） | `[]` |
| `art_name` | string（号） | `""` |
| `biehao_text` | string（别号，多行以 `\n` 分隔） | `""` |
| `zhaihao` / `zhaihao_alts` | string / string[]（斋号） | `""` / `[]` |
| `dynasty` | string | `""` |
| `birth_year` / `death_year` | number（公元年） | `0` |
| `native_place` | string | `""` |
| `tags` | string[]（标签词表的 `label`） | 必填，至少一项 |
| `sources` | object[]（见上） | 必填，至少一项 |
| `biography` | string（繁体小传，原样保留） | `""` |

- 库外藏家的姓/名无法可靠拆分：`family_name` 为 `""`，`given_name` 为归一后的整名。
- `persons.json` 顶层是**数组**（按 `person_id` 升序）；`tags.json` 与 `id-map.json` 顶层是带 `version` 的对象。

## 5. 本期数据源与生成时间

- 数据源（只读）：腾讯云 CloudBase 环境 `liwu-cny1313-d1gb2fukyb7cb19bb`
  - `xiai_persons`：570 条印人（已迁移后的新字段）；
  - `xiai_seals`：1,252 方印章，其中 381 方有印主（`seal_yz_person_name`），871 方印主为空。
- 简繁归一：藏家姓名经 xiai 的 `toTraditionalText`（OpenCC `s2t` 逐字表）转繁后，与印人「姓+名」精确比对；命中即**合为同一人**，不新建条目（例：`赵之谦` 与 `趙之謙` 归一为同一人 `趙之謙`，印章数合计 2）。
- 生成时间：**2026-11-13（CST）**。`id-map.json` 的 `generated_at` 记录每次导出的 UTC 时刻；`persons.json` 刻意不含时间戳以保持字节稳定。
- 本期读数：**573 人** = 570 印人 ∪ 3 名库外藏家；两类交集 7 人；`person_id` 区间 `100000001`–`100000573`，无重号、无跳号。
- `id-map.json` 的 `seal_count` = 该人作为**印主**覆盖的印章方数（同一人的印人+藏家身份已合计）；全表合计 381，与有印主的印章总数一致。

## 6. 后续新增人物如何取号

1. 取当前最大号：`next = max(person_id) + 1`（当前即 `100000574` 起）。
2. 新号**只追加**，既有编号一律不动、不重排、不回收；批量导入也按同一顺序（拼音序，同名按来源 id 升序）逐个顺延取号后追加。
3. 判重先归一（简繁、去空白）再比「姓+名」；命中既有条目则**只补字段与标签，不新建、不换号**。
4. 重建全表时，`id-map.json` 是回填依据：以既有的 `person_id ⇄ 来源 id` 对照先行占号，剩余的号再按顺序发给新人物，确保老号一个不变。

## 7. 与 CBDB 的关系

- **互补，不合并编号**：CBDB 以正史、碑刻、文集为核心，CARD 以家谱为一手资料；两边各自维护独立的人物标识。
- 已在 CBDB 有对应者，仅在其 `sources` 里追加 `{"system":"cbdb","id":"…"}` 作为溯源（本期 104 人），**不采用 CBDB 的 id 作为 CARD 的 `person_id`**，也不因 CBDB 编号相同而合并两条 CARD 记录。
- CBDB 有而 CARD 尚无的人物，本期不入库；日后汇入时按第 6 节规则取新号。

## 8. 其他约束

- 纯静态、零构建、零外部请求：JSON 由静态托管直接提供，页面不 fetch、不引 CDN。
- 仅收录**已故人物**（CARD 既有口径）；数据许可沿用 CARD 首页声明——仅限非商业的公益与学术研究用途，商业使用须事先取得书面许可。

## 9. 轻量索引：`person-index.json` / `person-index-full.json`

供 CARD 之外的消费方（xiai 广场、名录、站内搜索）**只取展示所需字段**，不必拉全量 `persons.json`。

| 文件 | 字段 | 用途 | 本期体积 |
|---|---|---|---|
| `person-index.json` | 10 个：`person_id / name / family_name / given_name / courtesy_name / art_name / zhaihao / dynasty / tags / cbdb_id` | 广场卡片、名录列表（**不含別號**，最省） | 149,987 B（gzip ≈ 19 KB） |
| `person-index-full.json` | 上列 10 个 ＋ `biehao_text / zhaihao_alts` | 站内搜索、人物详情头图（別號多为多行文本，最占体积） | 203,423 B（gzip ≈ 34 KB） |

- **顶层形状与接口回包一致**：`{ "generated_at": "<ISO>", "count": 573, "rows": [ … ] }` —— 只是去掉了接口层恒为 `true` 的 `ok`。`rows` 按 `person_id` 升序；每人**固定键集、缺失用空串/空数组占位**（消费方无需判空）。
- `generated_at` 是本次拉取时刻（UTC，与 `id-map.json` 同口径）；`count` 恒等于 `rows.length`。
- 数据来源 = 云函数 `card-api` 的只读 `getIndex` op（`include_biehao` 为 `false` / `true` 各拉一次），**不是**手抄。
- 体积对照（同日实测）：全量 `persons.json` 616,125 B（gzip ≈ 181 KB）、`exportPersons` 接口回包 987,812 B（gzip ≈ 282 KB）；瘦版约为后者的 **1/9**。

### 何时重生成

`persons.json` 有任何实质变化（新增人物、补字號/齋號/朝代/`cbdb_id`、标签调整）之后重跑：

```bash
cd /Users/kevin/bistro/card
node scripts/refresh-index.mjs            # 拉取并覆盖两份索引
node scripts/refresh-index.mjs --dry-run  # 只打印体积/行数，不写盘
```

- 脚本仅**开发期**使用（`scripts/` 目录，纯静态托管不引用、不执行）：单文件 ESM、零依赖、Node 18+，用 `fetch` 打 `card-api` 的 HTTP 通道。
- 密钥**只**从本机 `~/.config/card/api.env` 的 `CARD_API_KEY` 读取（600）；脚本内无密钥、命令行也不接收密钥，产物里只有公开数据。
- 可选参数：`--out-dir <目录>`（默认 `data`）、`--api-url <url>`（默认线上函数地址）、`--key-file <路径>`。失败即非零退出且**不落半份产物**（临时文件 + rename）。
- 重生成后必须核：两份 `count` 一致且 = `persons.json` 行数；瘦版每行**必须没有** `biehao_text` 键；`person_id` 无重复。抽查若干人与 `getPerson` 逐字比对（`name/courtesy_name/art_name/zhaihao/dynasty`）。
