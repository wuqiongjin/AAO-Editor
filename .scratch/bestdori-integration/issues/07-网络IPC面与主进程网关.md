# 07 · 网络 IPC 面与主进程网关

Type: feature
Status: resolved
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

### 2026-10-09 · 落地前 grill（用户拍板四问）

| # | 分叉 | 定案 |
| --- | --- | --- |
| Q1 | Cookie 归属 | **07 带内存 jar**（`electron/communityCookies.cjs`）：解析 / 附着 / 捕获 / 快照都在 07，**不落盘**；10 用 `snapshot()` / `restore()` 接 safeStorage 并接登录流程 |
| Q2 | 主进程 HTTP 栈 | **Electron `net.fetch`**（ADR-0011 §2 的 net 模块，走 Chromium 栈、尊重系统代理）。只能在 app ready 之后调用 → main.cjs 里包成 thunk，加载期不发请求 |
| Q3 | 重试层 | **主进程硬限流 + renderer 退避重试**：主进程单飞队列 + 最小间隔 400ms + 单次超时 + 响应校验；`src/community/rateLimit.ts` 管 429 / 5xx / 超时 / 离线的指数退避（800ms × 2ⁿ + 250ms 抖动，3 次） |
| Q4 | 下载暂存 | **`<数据根>/downloads/`，启动清空**（`resetCommunityStaging` 在 app ready 时跑）；CONTEXT「数据根」「下载暂存」两个词条同步补了目录 |

### 2026-10-09 · 落地记录

renderer 能力层（新）：`src/community/transport.ts`（`CommunityTransport` 接口 + 跨 IPC 载荷形状 + 统一错误域）、`electronTransport.ts`（**唯一**实现，经 `window.electronAPI.communityNet` 收发；无桥 = `kind:'none'`）、`rateLimit.ts`（`withRetry` + `backoffDelayMs`，时间与随机数注入）、`availability.ts`（可用性状态机，**不轮询**：`check()` + 真实请求成败回报；`capabilitiesFor` 降级矩阵）、`bestdori/endpoints.ts`（**唯一允许出现域名的文件**，顺带导出 `postUrl`）。

Electron 侧（新）：`electron/communityNet.cjs`（主机白名单 https-only、单飞 + 最小间隔、单次超时 JSON 30s / 二进制 120s、响应校验含 `{"result":false,"code"}` 按码翻、二进制落暂存回路径、`registerCommunityNetIpc`）、`electron/communityCookies.cjs`（内存 jar）。

改动：`electron/preload.js` 白名单新增 `communityNet.request` 一条通道；`electron/main.cjs` 接 `net.fetch` 与数据根暂存目录、ready 清空暂存；`electron/dataRoot.cjs` 新增 `downloads/`（进布局）；`src/pages/projects/components/ProjectDetail.tsx` 上传记录外链改走 `postUrl()`（Q14 白名单从落地第一天就是绿的，不欠例外）。

错误域：票里点的六类（离线 / 超时 / 限流 / 未授权 / **运行环境不支持** / 响应非法）+ 三类网关自保（`http` = 非预期状态码、`request-rejected` = 载荷被网关拒、`staging-failed` = 本机暂存写失败）。第六类落地时定名 `unsupported-runtime` —— 票里写的是「平台不支持」，但 CONTEXT「社区平台」词条的 _Avoid_ 明确不许用「平台」指 Electron 运行环境，故避开。错误性质（能不能退避重试、算不算「连不上」）**只在一张 `KIND_TRAITS` 表里定义**，rateLimit 与 availability 都来查它；诊断 message 与界面文案分开：界面按 kind 走 i18n。

锁测（全绿）：`tests/static/CommunityDomainWhitelist.test.ts`（域名白名单非空集 + `postUrl` 改道 + 无 `XMLHttpRequest` + **裸 `fetch` 只准出现在键音采样那一处**（变量 URL 绕道也拦得住）+ `implements CommunityTransport` 只有一处）；`tests/unit/community/`（`transport.test.ts` 429 退避后成功 / 超时统一错误 / 二进制只回路径 / 无桥降级 / 判定表；`rateLimit.test.ts`；`availability.test.ts`；`bestdori/endpoints.test.ts`）；`tests/platform/electron/`（`CommunityNetGateway.test.ts` 白名单 / 单飞与间隔 / 超时 / 响应与业务码 / 暂存落盘与写失败 / Cookie 附着；`CommunityCookies.test.ts`；`CommunityNetWiring.test.ts` IPC 注册 + preload/main 接线静态断言 + `<数据根>/downloads/` + **主进程兜底常量与端点文件同值的互锁**）。

**口径补充（评审后写清，防止下游漂）**：
- 「最多 3 次」= **含首次的 3 次尝试**（即最多重试 2 次）。
- `withRetry` 只给**幂等**读路径用；11 的发布 / 上传是 POST，超时与 5xx 都可能「服务端其实已经收了」——写路径要不要退避由 11 自己定，别整段套上。
- 官方**音频 / 封面**的 `/assets/*` URL 构建器还没进端点文件（07 用不到；桶规则也待实测）——08 用的时候**加进 `endpoints.ts`**（它就是那个唯一允许拿域名的文件），不要就地拼串。
- `clear()` / `restore()` 是给 10 的登出与 safeStorage 接缝留的，07 不调用。

全量 `vitest run`：222 文件 / 2459 用例通过（改动文件零类型报错；仓内既有 57 条 `tsc -p tsconfig.test.json` 报错与本次无关，未动）。

### 2026-10-09 · 真机待验（单测覆盖不到，Fog）

1. **`net.fetch` 是否吐出 `Set-Cookie`**：Electron 官方文档没承诺（`communityCookies.cjs` 的头注已记）。网关会从 `getSetCookie()` / `set-cookie` 两处取，取不到 jar 就是空的 —— **10 接登录时的第一件事**；要换实现只动 main.cjs 一处（出口是注入的）。
2. 429 阈值 / Cookie TTL / 多点登录 → `docs/research/bestdori-api.md` §8。
3. **手工三态验收（07 阶段没有界面）**：① 在线 —— Electron 里 DevTools 跑 `await window.electronAPI.communityNet.request({ url: 'https://bestdori.com/api/songs/all.5.json' })` → `{ok:true,…}`；② 断网 —— 同一条 → `{ok:false, error:{kind:'offline'}}`（不白屏、不循环报错）；③ 静态演示版 —— 浏览器里建 transport → `kind === 'none'`、请求抛 `unsupported-platform`（08 起由界面呈现「仅桌面版」）。
4. **08 要接的缝**：二进制只回**暂存路径**。导入时怎么把暂存文件写进工程（扩 `projectStore` 收 stagedPath，还是主进程拷进工程目录）由 08 定 —— 07 只保证「字节不过 IPC」这条边界。
