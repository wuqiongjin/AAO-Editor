# 07 · 网络 IPC 面与主进程网关

Type: feature
Status: open
Blocked by: —

## 来源

ADR-0011 §2（Electron 主进程为唯一产品通道）、issues/03（浏览架构定案）、issues/06 的 grill Q1 + Q14（2026-09-30 拍板）。

现状事实：`electron/main.cjs` 无任何网络能力；`electron/preload.js` 的 `electronAPI` 只暴露 projectStore / chartCodeExport / preview.saveBinary / dataRoot / backgroundSkin / windowChrome / i18n，**没有网络通道**；`vite.config.ts` 也没有 `server.proxy`。

**2026-10-09 变基复记**（本票写于 2026-09-30，期间仓库有变动，逐条对账过）：

- 上面三条现状事实**仍然成立**（`electron/main.cjs:56-243` 注册的 14 个通道全是本地磁盘 / 窗体 / 语言，无一处网络；`preload.js:4-42` 与上文清单一致；`vite.config.ts:66-80` 只有 host/port/hmr/watch，无 `proxy`）。
- `scripts/lib/bestdori-http.mjs` **仍在**，仍 import `node:fs` / `process`（`log` 走 `process.stderr`、`downloadToFile` 落盘）→ 「工程化口径照它重写、它本身不可复用」这句成立。
- **锁测口径 Q14 有一处现有反例**：`src/pages/projects/components/ProjectDetail.tsx:190` 硬编码了 `https://bestdori.com/community/charts/${postId}`（上传记录的外链，i18n `projects.postLink`，由 chart-projects 04 落地时写下）。它不是变基引进来的新债 —— 写 06 / 07 时就没扫到它，**重扫才知道 06 那套"唯一允许出现域名的文件"在今天的树上是空谈**：照 Q14 原口径写断言会**直接判红**。改道办法见「实现落点」。
- **ADR-0011 §2 里点名的 `scripts/fetch-bestdori-skins.mjs` 已于 2026-10-08 随 release-pipeline 02 删除**（脚本迁出主仓）；本条不回改 ADR 结论，只记指针已换（工程化口径现在唯一的参照物就是 `scripts/lib/bestdori-http.mjs`）。

## 定案（用户 2026-09-30）

- **薄主进程（方案 a）**：主进程只做三件事 —— 发 HTTP、管 Cookie、限流。端点、领域转换、搜索全在 renderer，靠注入的 transport 收发。
- **二进制不过 IPC**：音频 / 封面在主进程落到数据根下的**下载暂存**后回一串路径，不回字节流。
- **锁测口径（Q14）**：
  1. 整个 `src/` 里，只有 `src/community/<平台>/endpoints.ts` 允许出现 `bestdori.com`；
  2. `src/` 内不存在指向外部域的 `fetch` / `XMLHttpRequest`，transport 只有一个走 IPC 的实现。
  3. 这两条取代 issues/03 原来那条「渲染进程源码不出现 bestdori.com」——按 Q1 端点落在了 renderer 侧，原口径会直接判红。
  4. **白名单不是空集**：跑断言前先把既有反例收进来（`ProjectDetail.tsx` 的帖子外链，见「现状事实」）。做法是**把域名收进端点文件**、让 UI 引用它，不是给断言开例外——例外一旦开，白名单就失去"唯一出口"这个可检验的含义。

## 实现落点

- `src/community/transport.ts`：`CommunityTransport` 接口 + 统一错误域（离线 / 超时 / 限流 / 未授权 / 平台不支持 / 响应非法）。
- `src/community/rateLimit.ts`、`availability.ts`：限流、重试退避、超时、可用性探测。
- `src/community/bestdori/endpoints.ts`：端点、UA、重试策略常量 —— **唯一允许出现域名的文件**。
- **既有外链改道**：`endpoints.ts` 顺带导出面向 UI 的 `postUrl(postId)`（社区帖地址）；`ProjectDetail.tsx:190` 的上传记录外链改引用它（文案键 `projects.postLink` 不动）。这样白名单断言从落地第一天就是绿的，而不是先欠一条例外。
- `electron/` 侧：受控网络面 + `preload.js` 白名单新增一个网络通道（形态照既有 `projectStore` 桥）。
- 工程化口径照 `scripts/lib/bestdori-http.mjs` 重写（它 import 了 `node:fs` / `Buffer` / `process`，**不可复用**）。
- 降级（ADR-0011 §1）：静态演示版 / 离线时**不白屏、不循环报错** —— 写能力灰掉，读能力提示不可用。

## 锁测

1. `tests/static/` 新增静态源码断言（照 `DialogTokenWiring.test.ts` 的 `readSource` 惯例）：扫描 `src/`，白名单之外不得出现 `bestdori.com`。**落地前先确认 `ProjectDetail.tsx` 已改道**（见「实现落点」）——否则这条断言第一天就红，而且红的是**旧账**（Q14 写的时候漏扫了既有代码），不是新写的接线。
2. 同一文件第二条断言：`src/` 无直连外域的 `fetch` / `XMLHttpRequest`，且 `CommunityTransport` 的实现只有主进程那一个。
3. `tests/unit/community/`：给 transport 注入假出口 + 假时钟，锁「429 按退避重试后成功」「超时抛统一错误」「二进制请求回路径不回字节」。
4. 单测覆盖不到的：IPC 契约与 preload 白名单的跨进程语义 —— 照 `tests/platform/electron/` 既有惯例补平台测试；真机三态（在线 / 断网 / 静态演示版）走手工验收清单。

## Comments
