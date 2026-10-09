# ADR-0011: Bestdori 集成与本地客户端网络/素材边界

- **状态**：Accepted（定案于 Bestdori API 调研对齐，2026-09-12）
- **修订**：2026-10-08 §2 / §4 回写（release-pipeline 02 运行时素材迁出，用户 2026-10-07 拍板、2026-10-09 验收）——只改**指针与事实**，决策结论（网络边界、凭据红线、风险档）一字不动。
- **背景**：产品需要与 Bestdori 平台互通——浏览其已上传的全部谱面（官方 + 社区）、未来将自制谱面上传发布。前置调研（`.scratch/bestdori-integration/issues/01`，实测报告 `docs/research/bestdori-api.md`）确认：Bestdori 无官方 API 文档与授权体系（无 OAuth，仅账密换 Cookie 会话）；**所有端点无 CORS 头**，浏览器跨域 fetch 不可行；官方谱面代码与本编辑器格式一致可直接导入。经与用户对齐确定产品形态与集成边界。**本次仅定案方向，不实现。**
- **结论**：见本文件全文。
- **变更触发**：任何 Bestdori 网络访问、素材分发、账号凭据处理与本文件冲突时，须先更新本文件并经用户确认。
- **关联**：issue [01 API 调研](../../.scratch/bestdori-integration/issues/01-bestdori-api调研.md)、[02 素材策略](../../.scratch/bestdori-integration/issues/02-公开版素材策略.md)、[03 浏览架构](../../.scratch/bestdori-integration/issues/03-谱面浏览的网络架构与数据边界.md)、[04 上传形态](../../.scratch/bestdori-integration/issues/04-Bestdori账号授权与上传形态.md)、[05 版权调查](../../.scratch/bestdori-integration/issues/05-素材版权与使用边界调查.md)；[ADR-0003 §12.4 素材边界](./0003-工作台UI与配置系统.md)；`basic-editor/issues/02`（谱面格式互通定案）；事实依据 `docs/research/bestdori-api.md`。

---

## 1. 产品形态（定案）

- **本地客户端（Electron）为唯一正式形态**；不考虑 Web 端运营。
- Web 侧仅允许**纯前端静态演示版**（可部署到 GitHub Pages 之类静态托管）：它**不承载任何 Bestdori 在线功能**（浏览 / 登录 / 上传）。原因：CORS 禁止浏览器直连，静态部署又没有后端可代理。演示版的谱面数据一律离线（粘贴导入或捆绑样本）。
- 实现含义：网络相关功能必须带运行环境检测，静态演示版优雅降级（隐藏或标注「仅桌面版」），不得白屏或报错循环。

## 2. Bestdori 数据通道（定案）

- **唯一通道：Electron 主进程网络层**（`net` 模块 / 自定义 IPC），渲染进程**不直连** Bestdori。不用「关闭 webSecurity」之类捷径。
- `electron/main.cjs` 现无任何网络能力，需新增受控的网络 IPC 面（preload 白名单暴露），并统一做：低速率、重试退避、超时、响应校验（参照 `scripts/lib/bestdori-http.mjs` 的工程化口径——它 import 了 `node:fs` / `process`，**只作口径参照、不可直接复用**）。<br>**2026-10-08 回写**：本条原指的 `scripts/fetch-bestdori-skins.mjs` 已随 release-pipeline 02 删除（抓取链迁出主仓），工程化口径现在唯一的参照物就是 `scripts/lib/bestdori-http.mjs`（留在仓内，供开发期拉谱面用）。
- 开发调试期浏览器内可用 vite `server.proxy` 临时验证，但这不是产品通道。
- 谱面代码数据（官方 `/api/charts/{id}/{diff}.json`、社区 `post/list` + `post/details`）导入编辑器走 `ChartConverter` 既有链路；音频/封面等大文件的磁盘缓存位置归实现票设计。
- 官方/社区谱面代码与编辑器「谱面代码」格式一致（`basic-editor/issues/02` 定案 + 2026-09-12 实测证实），导入不做格式重设计。

## 3. 账号与上传（定案：内置登录直传）

- **形态**：产品内置 Bestdori 登录，登录后在产品内直接发布（谱面 + 音频 + 封面经 `/api/upload` 三步上传 + `POST /api/post` 发布，流程见 `docs/research/bestdori-api.md` §4–5）。
- **凭据红线**：用户凭据只存在于用户本机、只经本机直达 Bestdori——**不经任何第三方服务器中转**（产品无服务器）。密码不落盘（会话结束即弃），仅持久化会话 Cookie（存 Electron 安全存储 / 加密存储），提供登出清除。
- **残余风险（接受并记录）**：① Bestdori 无官方 API 承诺，端点/校验可能无预告变动，功能可能失效（维护成本，非法律风险）；② 程序化发帖存在账号被风控的理论可能（第三方 wrapper 多年公开存在，实际容忍度高；仍须自控发布速率、不做批量行为）；③ 静态演示版不提供本能力（§1）。

## 4. 素材边界（定案：维持现状，运营前复审）

- **维持现状**：捆绑素材（`public/assets/skins/` 12 包 + 键音 244KB）继续随仓库/构建分发；获取脚本（`scripts/fetch-*.mjs`）仅开发期自用——低并发、自报 UA、只在本机跑，**不构成**合规风险点。
- 调研结论：素材合规的真正风险在「公开再分发版权素材」，与获取方式无关。当前仅本地客户端阶段风险窗口小；**「开放给大众运营 / 任何变现」之前必须复审**本节，走 issue 05 的版权调查结论（风险梯度与缓解路径：客户端运行时按需拉取 > 素材包导入用户自备 > 捆绑分发）。
- 未来浏览功能如外链官方音频/封面（Bestdori 直链）：由用户客户端按需取用，不落入我们的分发物，性质轻于捆绑；具体边界在浏览功能实现票里结合 issue 05 结论执行。

> **2026-10-08 回写（release-pipeline 02：运行时素材迁出，用户 2026-10-07 拍板）**：上面首条「捆绑素材继续**随仓库**分发」的事实已经改了——skins / 键音 / 仿真场素材一律**迁出 git**，主仓不含二进制，取件走 `npm run assets:sync`（外部快照仓库），**发布物仍携带**（CI 构建期注入；否决了"release 附素材包 + 用户自己导入"）。关键区分：**仓库里有没有 ≠ 发布物里有没有**，所以本节的**风险档不降**——「捆绑进分发物」仍是最高风险档，复审时点（开放运营 / 变现前）与缓解路径（运行时拉取 > 素材包导入 > 捆绑）一字不变。素材分发边界的现行口径见 `.scratch/release-pipeline/issues/02-素材迁出与内部镜像同步.md` 与 `CONTEXT.md`「音符皮肤」词条。

## 5. 待验证清单

登录成功形态（Cookie 名/有效期）、发布字段合法值域、musicjacket 分桶规则、429 阈值等实现期必须先实测的点，见 `docs/research/bestdori-api.md` §8。
