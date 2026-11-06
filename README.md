# CARD — 中华族裔人物资料库 / Chinese Ancestral Repository of Descendants

基于家谱史料的开放人物谱系数据库，对标哈佛 CBDB，与其形成互补：CBDB 以正史、碑刻、文集传记为核心，CARD 的核心原始资料是家谱，收录古往今来华人及海内外华裔谱系人物记录。

## 当前阶段

本期只做两件事：**仓库初始化 + 首页上线**。

- 无数据：仓库内不含任何人物数据。
- 无 API：首页「开放 API 示例」段为**占位示意**，`/api/person` 接口**尚未实现**。
- 检索未实现：首页检索框当前仅做前端跳转到 `/search`，`search/index.html` 是**静态占位页**，检索功能**尚未实现**。

## 文件结构

```
.
├── index.html          # 首页（中英双语，默认中文）
├── 404.html            # 自定义 404 页（中英双语，noindex）
├── robots.txt          # 爬虫规则（全站允许 + sitemap 指针）
├── sitemap.xml         # 站点地图（仅首页）
├── search/
│   └── index.html      # 检索占位页（中英双语）
├── citation/
│   └── index.html      # 引用规范页（中英双语，页脚「引用规范」落地页）
├── api-docs/
│   └── index.html      # API 文档页（中英双语，页脚「API文档」落地页）
├── privacy/
│   └── index.html      # 隐私说明页（中英双语，页脚「隐私说明」落地页）
├── README.md
└── .gitignore
```

纯静态站点，零构建：无 npm / package.json / 打包器 / 框架 / 任何构建步骤。

## 本地预览

```bash
cd /Users/kevin/bistro/card && python3 -m http.server 8080
```

打开 http://127.0.0.1:8080/ 预览首页。

## 部署说明（Vercel，手动）

- Framework Preset：**Other**
- Build Command：**留空**
- Output Directory：**仓库根目录**
- 域名：`cardreader.top` 与 `www.cardreader.top` 由用户在 Vercel 手动绑定

仓库根目录被 Vercel 直接托管，不加 `vercel.json`。

## 已冻结口径

- **person_id 为九位数字（仅由 0-9 组成）**。对外示例：`100000001`。
- 对外**不暴露任何内部编号**（如 handle / gramps_id）。
- **在世人物不入库**。

## 余留项

- favicon：未提供。
- 检索页实际实现：待实现（当前为静态占位页）。
- 开放 API：待实现（首页示例为占位）。
- 检索页未按 q 参数做任何处理（仍为静态占位）。

## 视觉规范

- **风格**：宣纸谱牒（v2）+ API 代码卡（深色卡片，顶栏双色标 `GET` / `/api/person`）。
- **配色**：纸色 `--paper #f4eddd`，正文墨色 `--text #242424`，主色（朱）`--zhu #9b2d20`，点缀色（赭）`--zhe #a0432f`；代码卡用深色 `--code-bg #241d16`。
- **字体**：中文标题走系统衬线栈 `"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC","SimSun",serif`，正文无衬线，代码/API 用等宽栈。
- **样式 token**：全部集中在 `:root` 变量，便于日后换色。
- **一致性**：检索页与首页共用同一风格与同一套 `:root` token。
- **零外部请求**：样式/脚本全内联，宣纸底纹用纯 CSS 渐变实现，无 `<img>` / `<svg>` / 图标字体 / CDN。
