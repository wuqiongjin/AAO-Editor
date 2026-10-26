# Bestdori 社区谱上传（写路径）实测（2026-09-24）

> 本文只记**发帖 / 登录 / 删帖**相关事实，不做产品决策。只读端点与全局约束见 [bestdori-api.md](./bestdori-api.md)。决策见 ADR-0011 与 `.scratch/bestdori-integration/issues/04`。
>
> Bestdori **没有官方 API 文档**。写路径交叉验证来源：现行前端 bundle（`app.d390adb1.js`、`CommunityChartsNew.b534f9a9.js`、`CommunityChartsEdit.c7752d8c.js`、`CommunityChartsSingle.41148197.js`）+ 登录账号发帖实测。密码不写入本文。

## 1. 结论摘要


| 问题                          | 结论                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| 软件能否直接发到社区？                 | **能**。走与官网相同的未文档化接口；无 OAuth，账密换 Cookie。浏览器因 **无 CORS** 不能直连（产品通道仍是 Electron 主进程，见 ADR-0011）。 |
| Custom / BanG Dream / LLSIF | 三种 `song.type` 都是一等选项。后两种**不上传**音频和封面，只传曲库 `id`。                                             |
| 官方谱面 JSON 能否原样 POST？        | **不能**。必须先按官网制谱器做 `sanitizeAll`（丢掉 `System`、删掉 `charge`），否则 `POST_INVALID`、不建帖。              |
| 发后能否改谱 / 隐藏 / 删除？           | **谱面不能改。没有隐藏、没有删除接口**（路径 404；页面上只有编辑 diff/level/tags）。                                       |




## 2. 登录

`POST /api/user/login`，JSON `{username, password}`。


| 项          | 实测                                                                               |
| ---------- | -------------------------------------------------------------------------------- |
| 成功         | HTTP 200，`{"result":true}`；`Set-Cookie` 名是 `token`                               |
| 随后         | `GET /api/user/me` → `{result, username, nickname, titles, email, messageCount}` |
| 失败（此前只读探测） | 200 + `{"result":false,"code":"CREDENTIALS_INVALID"}`                            |
| 授权形态       | 无 Token / OAuth；之后请求带上 `token` Cookie 即可。后端不校验 CSRF（见 bestdori-api.md §0）        |


Cookie 有效期、多端登录未测。

## 3. 发帖：`POST /api/post`

需登录。成功：`{"result":true,"id":<postId>}`。失败几乎都是 HTTP 200 + `{"result":false,"code":"…"}`。

### 3.1 Body 字段（社区谱 = `SELF_POST` / `chart`）

与官网「Publish a Chart」`onPublish` 一致：


| 字段             | 必填  | 说明                                                         |
| -------------- | --- | ---------------------------------------------------------- |
| `title`        | 是   | 标题                                                         |
| `artists`      | 是   | **独立文本**，选官方曲也不能空；站点不替你填曲库艺人名                              |
| `song`         | 是   | 见 §3.2                                                     |
| `diff`         | 是   | `0..4` = Easy / Normal / Hard / Expert / Special。前端默认 `3`  |
| `level`        | 是   | 前端默认 `20`。实测 `1` 可通过；`0` / `36` 为 `POST_INVALID`           |
| `chart`        | 是   | 谱面代码数组，须先清洗（§4）                                            |
| `content`      | 是   | 富文本块数组。纯文本：`[{"type":"text","data":"…"}]`。前端限制正文 ≤ 5000 字符 |
| `categoryName` | 是   | `"SELF_POST"`                                              |
| `categoryId`   | 是   | `"chart"`                                                  |
| `tags`         | 否   | `[]` 可通过。元素形态见 §3.3（读路径已实测；非空数组发帖尚未测）          |


前端校验码（未登录会先跳转登录页，不一定打到 API）：`TITLE_INVALID` / `SONG_INVALID` / `ARTISTS_INVALID` / `POST_EMPTY` / `POST_INVALID`（过长）/ `CHART_INVALID` / `TEMPORARY_FILE`。

**服务端错误码很粗**：缺 `artists`、非法 `diff`/`level`、未清洗的官方谱，都可能是同一个 `POST_INVALID`。不要用「空 artists」当安全探测——它和坏谱面返回值相同。

### 3.2 `song` 三种渠道

官网页选曲器文案：Custom / BanG Dream / Love Live! School Idol Festival。


| 页面         | 发帖 `song`                                            | 要不要 `/api/upload` | 播放时资源从哪来                                                          |
| ---------- | ---------------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
| Custom     | `{type:"custom", audio, cover}`（Bestdori 文件 URL 或外链） | 要（或填外链）           | 帖子里的 URL                                                          |
| BanG Dream | `{type:"bandori", id}`                               | **不要**            | 官方曲 `/api/songs/{id}.json` + `/assets/…/bgm…mp3` 与封面              |
| LLSIF      | `{type:"llsif", id}`                                 | **不要**            | `GET /api/misc/llsif.10.json`（约 401 首），封面/音频在 `card.niconi.co.ni` |


现网抽样（2026-09-24）：

- Bandori：帖 `254166` 详情 `{"id":659,"type":"bandori"}`，无 `audio`/`cover`
- LLSIF：帖 `160434` 详情 `{"id":1,"type":"llsif"}`

Custom 上传三步（本次未重测文件上传，沿用 bestdori-api.md §4）：SHA-1 → `POST /api/upload/prepare` `{ver:3,hash,size}` → multipart `POST /api/upload` 字段 `file` → 轮询 `GET /api/upload/status/{hash}`。引用 `https://bestdori.com/api/upload/file/{hash}`。

**Bandori 曲 id 发帖时不校验**：`id: 999999` 仍可建帖成功（见 §6 误发帖）。实现里应自己校验曲库。

### 3.3 标签形态（2026-10-26 读路径补测）

Bestdori 社区帖的 `tags` **不是**预置枚举、也不是纯字符串数组。读路径实测：

| 来源 | 结果 |
| --- | --- |
| `GET /api/post/details?id=111533` | `tags: [{type:"text", data:"結束バンド"}, …]` 共 **8** 条；内容是自由文本（角色 / 作品名），不是等级或难度 |
| `GET /api/post/tag?type=text&data=gimmick&fuzzy=true` | `{"result":true,"tags":[{"type":"text","data":"gimmick","count":2}]}` |
| `GET /api/post/tag?type=level&data=28`（2026-09-24） | `tags: []`（等级不进 tag） |
| `POST /api/post` 带 `tags: []`（2026-09-24） | 可通过 |

产品发帖目前写死 `tags: []`（`src/community/bestdori/publish.ts`）。**尚未**用非空 `{type,data}` 实测 `POST /api/post` / `POST /api/post/edit`。单条长度、条数上限、非法 `type` 的错误码仍未知。

## 4. 谱面代码必须先清洗

官网制谱器把 JSON 写进 `userChart` 时会 `sanitizeAll`（`CommunityChartsNew` bundle）：

1. **只保留** `type ∈ {Single, Directional, Slide, Long, BPM}`
2. 对其它类型（含 `System`：`bgm….wav`、`cmd_fever_*.wav`）直接丢掉
3. 递归 `delete charge`（单键和滑条 `connections` 上都可能有）

社区 API 与此一致：带 `System` 或任何 `charge` 键 → `POST_INVALID`，**不建帖**。

实测材料：本地 issue 154 语料 `docs/resource/StressTestChart/Official/413_SP.json`（**不进库**；需 `fetch-stress-test-charts.mjs`）。CI 锁 `tests/unit/upload/bestdori/sanitizeChart.test.ts` 内联切片。


|                                | 对象数 | 结果                                                          |
| ------------------------------ | --- | ----------------------------------------------------------- |
| 原样（含 4 条 System、30 处 `charge`） | 869 | `POST_INVALID`                                              |
| 去掉 System + 全部 `charge`        | 865 | 通过，帖 [254203](https://bestdori.com/community/charts/254203) |


详情回读：Easy (`diff:0`) / `level:1` / `song:{type:"bandori",id:413}` / 865 条（BPM 1 + Single 690 + Slide 74 + Directional 82 + Long 18），与清洗后数组长度一致。

实现上传时必须做同样清洗，不要把官方 `/api/charts/{id}/{diff}.json` 原样塞进 `chart`。丢掉的 `System` 是站内 SFX/fever 指令，社区谱本来就不走这条。

## 5. 发后能改什么、不能改什么



### 能：`POST /api/post/edit`

Vuex 通用 `postEdit` 的 body 形状是：

`{id, diff, level, rating?, warningViolence?, warningDeath?, warningNonCon?, warningUnderage?, tags}`

**谱面编辑页** `CommunityChartsEdit.onEdit` 实际只提交 `{id, diff, level, tags}`。没有 `chart` / `title` / `song` / `content`，也没有 rating / 警告。

`rating` 与四条 `warning*` **不是谱面帖的字段**。它们属于**社区故事**（`CommunityStoriesNew` / `Edit`）：

| 字段 | 故事页在干什么 |
| --- | --- |
| `rating` | 分级下拉（i18n `txtHelpRating`：「Inform audience about rating of your story」；选项里有 Mature / Explicit，默认 `0`） |
| `warningViolence` / `warningDeath` / `warningNonCon` / `warningUnderage` | 内容警告勾选（暴力 / 死亡 / 非自愿 / 未成年相关） |

谱面发帖 `POST /api/post`（`CommunityChartsNew.onPublish`）body 里本来就没有这五项。现网谱面详情（如帖 111533）也不返回它们。第三方有把谱面 `level` 改名叫 `rating` 的（Bestdori-Proxy 文档把 rating 写成 5–35 等级）——那是他们自己的改名，不是站点字段。

### 不能：改谱面、隐藏、删除


| 探法                                                                      | 结果                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| 谱面详情页                                                                   | 作者仅有编辑按钮（铅笔）→ `community-charts-edit`                       |
| Vuex 帖子 API                                                             | 只有 list / post / details / basic / find / tag / like / edit |
| `POST /api/post/delete`（及 hide / remove / unpublish / archive），假 id、未登录 | **HTTP 404** 空 body                                         |
| 对照 `POST /api/post/edit`、`/api/post/like`                               | HTTP 200 + `LOGIN_REQUIRED`                                 |


i18n 里的「删除」是通用 `btnDelete`（列表项打叉），不是删帖。

**发错只能另发一帖。** 社区没有作者自助下架通道。

## 6. 本次实测产生的帖（账号 `OfChartTester`）

探测时有两次误发（谱面不全）；完整清洗后发了一次。站点无法删除。


| 帖                                                      | 说明                               |
| ------------------------------------------------------ | -------------------------------- |
| [254201](https://bestdori.com/community/charts/254201) | 误发。2 个对象（BPM + 单键）。元数据已是目标形态     |
| [254202](https://bestdori.com/community/charts/254202) | 误发。同上，且 `song.id=999999`（曲库外仍成功） |
| [254203](https://bestdori.com/community/charts/254203) | **目标帖**。清洗后的 413 SP，865 对象       |


目标帖字段：`title` = `Test: Partial Chart Fields`；`content` = `DON'T PLAY. FOR TESTING ONLY.`；`artists` = `RAS`；`diff` = 0；`level` = 1；`song` = `{type:"bandori", id:413}`。

## 7. 实现时建议记住的点

1. 登录：存 `token` Cookie，不要落盘明文密码（ADR-0011 §3）。
2. Bandori / LLSIF：跳过 upload，只传 `{type, id}`；`artists` 仍要用户填。
3. Custom：走 upload 三步，再把 URL 填进 `song.audio` / `song.cover`。
4. 导出谱面后先 `sanitizeAll`，再 POST。
5. 发帖不可逆；UI 必须二次确认，并写明发后不能改谱、不能删。
6. 自控速率。前端有「Too many posts / uploads」文案，阈值未测。
7. 渲染进程不要直连 `bestdori.com`（无 CORS）；只走 Electron 主进程。



## 8. 仍未测

- Cookie TTL、多端互踢
- Custom 文件上传（prepare / multipart / 15MB 上限仅见前端文案）
- LLSIF 渠道完整发帖
- `content` 富文本（emoji / link / 5000 字如何计）
- `diff`/`level` 全值域
- **非空 `tags` 发帖 / 编辑**（读路径形态已见 §3.3；写路径、条数/长度上限未测）
- 429 阈值
- 谱面对象数量 / body 体积上限（本次 865 对象、约 43KB 可通过）

