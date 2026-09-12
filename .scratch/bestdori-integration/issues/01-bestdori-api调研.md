Type: research
Status: resolved
Blocked by:

## Question

三个需求的前置调研（用户 2026-09-12 提出）：

- a) 当前素材资源的获取方式（自研脚本拉 bestdori.com）是否合规？产品开放大众使用时要不要换？
- b) 未来适配 Bestdori 已上传全部谱面（官方 + 社区）的浏览功能 → 需要能拿谱面代码的 API。
- c) 未来适配谱面代码上传到 Bestdori → 需要账号登录授权、谱面上传、音频/封面上传的 API。

## Answer（结论）

完整实测报告：**`docs/bestdori-api.md`**（版本化，端点均于 2026-09-12 实测）。要点：

- **a）脚本不是合规风险点，素材再分发才是。** 现状是 dev 期一次性脚本（低并发 3、自报 UA、断点重跑，`scripts/fetch-bestdori-skins.mjs`）拉归档到本地 `docs/resource/bestdori/`（gitignore），运行时零外域请求。产品公开要拍板的是「捆绑素材（仓库内 1.9MB 皮肤 + 244KB 键音）是否随公开版分发」→ 拆 `issues/02`。
- **b）端点全齐，浏览器直连不可行（无 CORS）。** 官方谱面 `GET /api/charts/{songId}/{diff}.json` 返回的就是本编辑器谱面代码格式；社区谱面 = `SELF_POST/chart` 帖子（`POST /api/post/list` 分页搜索 + `GET /api/post/details?id=` 匿名取完整 chart 数组），存量 47491 张。**所有 Bestdori 端点无 CORS 头** → web 版必须经代理 → 拆 `issues/03`。
- **c）API 齐备但无 OAuth**：`POST /api/user/login {username,password}` 换 Cookie 会话；文件上传 = prepare→multipart→status 三步（SHA-1 寻址）；发布 = `POST /api/post`（谱面代码数组 + `song{type:'custom',audio,cover}`）。授权形态（用户凭据怎么经手）需拍板 → 拆 `issues/04`。
- 谱面格式互通性已在 `basic-editor/issues/02` 定案（高度兼容，仅需导出字段规范化）；官方谱面实测进一步证实。

## Comments

- 2026-09-12 调研完成。`docs/resource/SampleChartCode/Official/`、`MocaCoffee/` 空目录（当日 09:18 建）应是官方谱面样本的准备位，官方谱面样本可直接从 `/api/charts/{id}/{diff}.json` 拉取。
