# Bestdori! API 实测参考（2026-09-12）

> Bestdori!（https://bestdori.com/）**没有官方 API 文档**。本文端点于 2026-09-12 起匿名实测（只读为主）。
> **写路径（登录 / 发帖 / 删帖）2026-09-24 已实测**，完整结论见 [bestdori-community-upload.md](./bestdori-community-upload.md)；本文 §3–5 / §9 只留摘要。
> 本文只记录事实，不做决策；决策见 `docs/adr/` 与 `.scratch/bestdori-integration/` 对应票。

权威来源（交叉验证）：

- Bestdori 前端 bundle：`/js/app.d390adb1.js`、`/js/CommunityCharts{,New,Edit}.js`（请求构造的最终权威）
- 社区 Python wrapper [WindowsSov8forUs/bestdori-api](https://github.com/WindowsSov8forUs/bestdori-api)：端点清单 `bestdori/data/api/bestdori/api.json`
- 社区 Go SDK [bestdori-api-go](https://pkg.go.dev/github.com/WindowsSov8forUs/bestdori-api-go)

## 0. 全局事实

| 事实 | 说明 |
| --- | --- |
| 单一域名 | API `/api/*`、游戏资源 `/assets/*`、上传文件 `/api/upload/file/*` 全部在 `https://bestdori.com` 同域（`assets.bestdori.com` 实测不可用/无响应） |
| **无 CORS 头** | 所有端点（含 assets）响应均无 `access-control-allow-origin` → **浏览器跨域 fetch 全部被禁**。`<img>`/`<audio>` 标签引用不受 CORS 限制（但 canvas 像素读取需要） |
| robots.txt | 不存在（返回 SPA HTML 回退页），站点未声明抓取政策 |
| WAF | 全站 Cloudflare 前置；本调研百余次低速率请求未触发人机验证 |
| 错误形态 | 业务错误也是 **HTTP 200** + `{"result":false,"code":"…"}`。错误码全集：`REQUEST_INVALID` / `LOGIN_REQUIRED` / `CREDENTIALS_INVALID` / `USER_INVALID` / `ALREADY_UPLOADED` / `POST_INVALID` |
| 无 CSRF/UA 校验 | 后端不校验 User-Agent / Origin / Referer / CSRF 头（curl 裸 POST 成功；Python wrapper 亦不带任何特殊头） |

## 1. 官方歌曲与官方谱面

### GET `/api/songs/all.5.json`

全量歌曲元数据（约 4 万字符级响应，`cache-control: max-age=60`）。键为歌曲 id：

```json
"1": {
  "tag": "normal", "bandId": 1,
  "jacketImage": ["yes_bang_dream", ...],
  "musicTitle": [ja, en, zh-Hans, zh-Hant, ko, ...],
  "publishedAt": [各服毫秒时间戳], "closedAt": [...],
  "difficulty": {
    "0": {"playLevel": 5}, "1": {"playLevel": 10}, "2": {"playLevel": 17},
    "3": {"playLevel": 22},
    "4": {"playLevel": 26, "publishedAt": [...]}
  }
}
```

难度编号 `0..4` = easy / normal / hard / expert / special；`difficulty` 中**出现的键即该曲已实装的难度**（special 通常带 per-server `publishedAt`）。

### GET `/api/songs/{id}.json`

单曲详情：`bgmId`（如 `"bgm001"`）、`bgmFile`（如 `"yes_bang_dream"`）、`tag`、`bandId`、`achievements[]`、`difficulty{}` 等。

### GET `/api/charts/{songId}/{diff}.json`

官方谱面代码。`diff` ∈ `easy|normal|hard|expert|special`。**返回的 JSON 数组就是本编辑器的「谱面代码」格式**（`BPM` / `System` / `Single` / `Long` / `Slide` + `connections` + `flick` / `lane 0..6` / `beat`），与 `src/chart/editing/ChartConverter.ts` 及 vendored sonolus-bandori-engine 口径一致，可直接导入：

```json
[{"type":"BPM","bpm":185,"beat":0},
 {"type":"System","data":"bgm001.wav","beat":0},
 {"type":"Single","lane":5,"beat":10},
 {"type":"Long","connections":[{"lane":6,"beat":12},{"lane":6,"beat":13}]}, ...]
```

### GET `/api/songs/meta/all.{n}.json`

歌曲 meta（BPM / 时长等）。实测 `all.1.json` 404、`all.2.json` 200（版本号 2）。

## 2. 社区谱面（= `SELF_POST`/`chart` 分类的帖子）

社区谱面在 Bestdori 里就是「帖子」（画廊 `SELF_POST`，分类 `chart`）。2026-09-12 实测总量 **47491** 张。

### POST `/api/post/list`（社区谱面列表 / 搜索 / 分页）

JSON body（实测约束）：

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `search` | ✅ | 可为空串 `""`；非空时做关键字搜索 |
| `categoryName` | ✅ | `SELF_POST` |
| `categoryId` | ✅ | `chart` |
| `order` | ✅ | `TIME_DESC` / `TIME_ASC` 实测可用；`LIKE_DESC` 返回 `REQUEST_INVALID` |
| `limit` | ✅ | **10..50**（2026-09-23 复测：9 拒、10 过、50 过、51/60/75/100 拒；本文 2026-09-12 初版记的「100 通过」已失效，按 50 实现） |
| `offset` | ✅ | 翻页偏移，缺省也拒绝 |
| `username` | ❌ | **未文档化字段，2026-09-23 实测可用**：按谱师账号名过滤，见 §2.1 |

响应：

```json
{"result": true, "count": 47491, "posts": [{
  "id": 248468, "categoryName": "SELF_POST", "categoryId": "chart",
  "title": "All You Wanted (GBP Edit)",
  "song": {"type": "custom",
           "audio": "https://bestdori.com/api/upload/file/d936…",
           "cover": "https://bestdori.com/api/upload/file/247c…"},
  "artists": "Michelle Branch", "diff": 3, "level": 24,
  "content": [{"data":"Notes: 413","type":"text"}, {"type":"br"}, {"data":"Morfonica","type":"emoji"}],
  "time": 1789214607000, "author": {"username":"…","nickname":"…","titles":null},
  "likes": 1, "liked": false, "tags": []
}]}
```

`song` 三种形态：`custom`（用户上传音频+封面，直链）／`bandori`（Bestdori 官方曲库，`{type,id}`）／`llsif`（LoveLive 曲库）。列表**不含谱面数据本体**，需再取详情。

### §2.1 按谱师列出作品：`username` 字段（2026-09-23 实测）

`post/list` 的 body 额外接受 `username`（前端 bundle 未走这个参数，Python/Go wrapper 也未收录；由本仓库实测发现）。实测结果：

| 验证项 | 结果 |
| --- | --- |
| 过滤生效 | `{"search":"","username":"Envy09",...}` → `count: 421`，返回项 `author.username` 全为 `Envy09` |
| `count` 语义 | 是**过滤后**的总数（不是全站 47607），可直接用来判断翻页终点 |
| 分页 | ✅ `offset` 在过滤结果内偏移；`offset=415,limit=10` → 剩 6 条正常收尾；`limit` 仍是 10..100 |
| 大小写 | ✅ 不敏感（`nanako77` / `NANAKO77` 都命中 `Nanako77` 的 9 条） |
| 与 `search` 组合 | ✅ AND 语义（`username=Envy09` + `search=GYARI` → 3 条） |
| 传昵称 | ❌ `nickname`（如 `瓦彩蛇`）不命中，非 ASCII 会被拒（`REQUEST_INVALID`）——只能用账号名 |
| 字段名写 `author` | ❌ `REQUEST_INVALID`，必须是 `username` |

取某谱师全部作品 = `search:""` + `username` 翻页到 `count`，再按 `postId` 逐个取 `post/details`。

### §2.2 等级 / 难度只能在客户端过滤（2026-09-24 实测）

`post/list` **没有任何服务端等级或难度过滤字段**。探测方式是「未知字段会被拒」——body 里多传一个不认识的键就返回 `REQUEST_INVALID`，所以拒绝即等于字段不存在。实测全被拒：

| 探测字段 | 结果 |
| --- | --- |
| `level` / `minLevel` / `maxLevel` / `levelMin` / `levels` / `minLv` / `maxLv` / `diffLevel` | `REQUEST_INVALID` |
| `diff` / `difficulty` | `REQUEST_INVALID` |
| `rating` / `tags` | `REQUEST_INVALID` |
| `order` = `LEVEL_DESC` / `LEVEL_ASC` / `DIFF_DESC` / `LIKE_ASC` / `RANDOM` | `REQUEST_INVALID`（只有 `TIME_DESC` / `TIME_ASC` 可用） |
| `GET /api/post/tag?type=level&data=28` | `{"result":true,"tags":[]}`（tag 只有 text 类型，不存等级） |
| 对照：`limit=50` 基线 | `count=47608`，返回项 level 3–35、diff 1–4 |

合法字段只有：`search` / `categoryName` / `categoryId` / `order` / `limit` / `offset` / `username`（§2.1）。

所以等级筛选必须在客户端按 `post.level` / `post.diff` 过滤，且要**一直翻页**直到凑够条数（带 `username` 时作品总数有限，过滤是精确的；全库场景则可能需要扫很多页，需设扫描上限）。

### GET `/api/post/details?id={id}`

帖子详情，**匿名可读**。谱面帖多出 `chart` 字段 = **完整谱面代码数组**（与官方谱面、本编辑器同格式）。

### 其他读端点

- `GET /api/post/basic?id={id}` — 标题/作者摘要
- `GET /api/post/tag?type=&data=&fuzzy=` — 标签搜索（返回 `tags[]` 带 count）
- `GET /api/post/find?categoryName=&categoryId=&id=` — 帖子在画廊中的时间序位次

## 3. 账号与登录

| 端点 | 说明 |
| --- | --- |
| `POST /api/user/login`，JSON `{username, password}` | 成功 Set-Cookie 建立会话；失败 200 + `{"result":false,"code":"CREDENTIALS_INVALID"}`（实测） |
| `GET /api/user/me` | 当前会话用户信息 |
| `POST /api/user/signup` `{username,password,email}` | 注册（前端 bundle 实证） |
| `POST /api/user/logout`、`POST /api/user/password {old,new}`、`POST /api/user/reset/{request,consume}` | 会话/密码管理（前端 bundle 实证） |

- **无 OAuth / API Token**：唯一授权方式就是用户名+密码换 Cookie 会话。
- 后端不校验 CSRF（见 §0），自建客户端只需保存并回传会话 Cookie。
- 2026-09-24 写路径实测：成功 Cookie 名是 **`token`**；`GET /api/user/me` 登录后返回 `{result, username, nickname, titles, email, messageCount}`。有效期 / 多点登录仍未测。详见 [bestdori-community-upload.md](./bestdori-community-upload.md) §2。

## 4. 文件上传（发布谱面所需的音频 / 封面图）

流程（wrapper `upload.py` 与前端 bundle 一致；**需登录会话**）：

1. 本地计算文件 **SHA-1**（40 位 hex）与字节数 `size`；
2. `POST /api/upload/prepare`，JSON `{ver: 3, hash, size}` —— 若文件已存在返回 `ALREADY_UPLOADED`（可直接复用）；
3. `POST /api/upload`，`multipart/form-data` 字段名 `file` → 响应 `{hash}`；
4. 轮询 `GET /api/upload/status/{hash}` 直到 `{"status":"available"}`（wrapper 最多重试 5 次）。

引用 URL：`https://bestdori.com/api/upload/file/{hash}`，**匿名可下载**（实测 200，`application/octet-stream`，无 CORS 头）。音频与封面图都走同一上传通道，发布时以 URL 形态填进帖子的 `song` 字段。

## 5. 发布 / 编辑社区谱面帖

- **发布**：`POST /api/post`，JSON body：
  `{title, artists, diff(0..4?), level(1..35?), chart(谱面代码数组), content(富文本块数组, ≤5000 字符), categoryName:"SELF_POST", categoryId:"chart", tags[], song}`，
  `song` = `{type:"custom", audio:"https://bestdori.com/api/upload/file/{hash}", cover:"…"}` 或 `{type:"bandori", id}`。响应返回新帖 id。需登录。
- **编辑**：`POST /api/post/edit` `{id, diff, level, rating, warningViolence, warningDeath, warningNonCon, warningUnderage, tags}`。**body 里没有 `chart` → 谱面本体发布后不可再改**，只有 diff / level / rating / 警告标记 / tags 能事后修改。这决定了本地缓存语义：谱面字节可安全缓存，元数据只是抓取时刻的快照。
- **点赞**：`POST /api/post/like` `{id, value}`。评论即回复帖（`categoryName:"POST_COMMENT"`，如 `categoryId=父帖id`）。
- **无删除 / 隐藏**：`/api/post/delete|hide|remove|unpublish|archive` 均为 HTTP 404。写路径细节、谱面 `sanitizeAll`、实测帖 id 见 [bestdori-community-upload.md](./bestdori-community-upload.md)。

## 6. 资源 URL 模式（官方曲库素材）

| 资源 | 模式 | 实测 |
| --- | --- | --- |
| 官方完整音频 | `/assets/{server}/sound/bgm{bgmId:03d}_rip/bgm{bgmId:03d}.mp3`（`bgmId` 取自 `/api/songs/{id}.json`；server = jp/en/tw/kr/cn） | song 1 → `bgm001`，200，audio/mpeg，约 4 MB（完整曲，非预览） |
| 专辑封面 | `/assets/{server}/musicjacket/musicjacket{bucket}_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket{bucket}-{jacketImage}-jacket.png`（`jacketImage` 取自 `all.5.json`） | song 1（`yes_bang_dream`）：`musicjacket10` → 200（97KB，正确封面）；`musicjacket00` → 200 但 14KB（非该封面）。**bucket 求值规则待确认**（假设 `ceil(id/10)*10`，实现时抽查） |

注意：社区谱面若 `song.type="bandori"`，播放同样依赖上述官方音频端点。

### 本仓库 CLI（开发期拉取）

官方与社区**分两个入口**（id 语义不同），共用 `scripts/lib/bestdori-*.mjs`；说明见 `scripts/README.md`。

- 官方：`node scripts/fetch-bestdori-official.mjs --search <曲名>` → `node scripts/fetch-bestdori-official.mjs <songId> <diff> [-o chart.json] [--audio]`
- 社区：`node scripts/fetch-bestdori-community.mjs --search <关键字>` → `node scripts/fetch-bestdori-community.mjs <postId> [-o chart.json] [--audio]`
- 按谱师：`node scripts/fetch-bestdori-community.mjs --username <账号名> --limit all` 列清单；加 `--download-dir <dir>` 批量下载（并发 + 磁盘缓存 + `index.json`，实现在 `scripts/lib/bestdori-cache.mjs`）。issue 154 固定语料：`node scripts/fetch-stress-test-charts.mjs` → `docs/resource/StressTestChart/`

## 7. 速率与合规边界

- Bestdori 无公开的 API 限流文档；社区有 429 rate limit 讨论（2021）。本次调研百余次请求未触发 429 → **客户端仍应低速率 + 本地缓存**，不做整站爬取。
- 版权边界：游戏内素材（谱面、音频、封面、皮肤）版权归 © BanG Dream! Project（Craft Egg / Bushiroad）；Bestdori 本身是粉丝站；**社区谱面的音频/封面是普通用户上传的第三方内容**，版权风险高于官方素材。
- 本仓库既有约定：`docs/resource/bestdori/README.md`「归档仅本地研究、不得再分发或商用」；ADR-0003 §12.4「素材运行时接入需另行评审授权边界」。

## 8. 待验证清单（实现期用真实账号/规模实测）

1. ~~登录成功后的会话 Cookie 名~~（2026-09-24：名是 `token`）。有效期、多端登录行为仍未测。
2. 发布帖 `diff` / `level` 的合法取值域（已确认 `diff:0` + `level:1` 可通过；`level` 0/36 拒。全值域未扫完）。
3. 发布帖 `content` 富文本块完整语法（`text` / `br` / `emoji` …）与 5000 字符上限的计量方式。
4. `order` 全部合法值（`LIKE_DESC` 无效，是否还有 `LIKE_ASC` 等）。
5. musicjacket bucket 求值规则（§6）。
6. 429 限流的实际阈值与封禁形态。
7. `song.type="bandori"` 社区谱面在站内播放用的音频是否为完整曲（影响我们浏览功能的音频体验与流量）。

## 9. 2026-09-24 前端再核（发布 payload）

写路径实测与发帖记录已独立成文：**[bestdori-community-upload.md](./bestdori-community-upload.md)**。本节只保留 bundle 对照。

站点仍无官方 API 文档。当日 `https://bestdori.com/community/charts/new` 对应 bundle 仍是 `CommunityChartsNew.b534f9a9.js` + `app.d390adb1.js`（与 2026-09-12 调研同一 `app` hash）。

发布按钮 `onPublish` 的前端校验与请求（未登录会跳转登录页）：

| 校验 | 条件 | 错误码 |
| --- | --- | --- |
| 标题 | `userChartTitle` 非空 | `TITLE_INVALID` |
| 歌曲 | `userChartSong` 非空 | `SONG_INVALID` |
| 演唱者 | `userChartArtists` 非空 | `ARTISTS_INVALID` |
| 描述 | `userChartBody` 非空 | `POST_EMPTY` |
| 描述长度 | `userChartBody.length > 5000` | `POST_INVALID`（文案：Post too long） |
| 谱面 | `userChart` 数组非空 | `CHART_INVALID` |
| 临时文件 | body / song 仍指向未转正的临时上传 | `TEMPORARY_FILE` |
| 未登录 | 无 `this.user` | 路由到 `profile-account?t=login` |

通过后调用 `POST /api/post`（Vuex `socialPostPost`），body 字段：

```json
{
  "title": "…",
  "song": { "type": "custom|bandori|llsif", "audio": "…", "cover": "…", "id": 123 },
  "artists": "…",
  "diff": 3,
  "level": 20,
  "chart": [ /* 谱面代码数组 */ ],
  "content": [ /* 由正文解析出的富文本块 */ ],
  "categoryName": "SELF_POST",
  "categoryId": "chart",
  "tags": []
}
```

前端默认值：`diff = 3`（Expert）、`level = 20`。歌曲选择器三种：Custom（推荐自传封面/音频）、BanG Dream 官方曲（`type:bandori` + 曲 id）、LLSIF 曲库。Custom 也可填外链 URL，但文案建议上传到 Bestdori（外链需允许 CORS 才能在站内播放）。

`POST /api/post/edit` 在 `app.js` 里仍只有 `id, diff, level, rating, warningViolence, warningDeath, warningNonCon, warningUnderage, tags`——**没有 `chart` / `title` / `song` / `content`**，与 §5 一致：谱面本体发布后不能改。

限流文案（前端 i18n，阈值未测）：`Too many posts, please try again later` / `Too many uploads, please try again later`。
