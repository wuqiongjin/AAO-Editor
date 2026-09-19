# map — bestdori-integration

## Notes

- 目标：让编辑器与 Bestdori 平台互通（官方/社区谱面浏览 → 内置登录直传发布）。
- 事实底座：`docs/research/bestdori-api.md`（2026-09-12 实测端点报告，版本化维护）。
- 格式互通已在 `basic-editor/issues/02` 定案：编辑器谱面代码与 Bestdori 高度兼容，仅需导出字段规范化。
- 产品形态定案（2026-09-12）：本地客户端（Electron）为唯一正式形态；Web 仅纯前端静态演示（不带 Bestdori 在线功能）。

## Decisions-so-far

- 01 Bestdori API 全量调研（research，resolved）：a 脚本非风险点（再分发才是）/ b 端点齐但无 CORS 需代理 / c 无 OAuth 仅账密会话。
- 02 公开版素材策略（grilling，resolved）：维持现状继续捆绑；版权问题拆 05；公开运营/变现前复审（ADR-0011 §4）。
- 03 谱面浏览的网络架构与数据边界（grilling，resolved）：本地客户端形态 → Electron 主进程网络层为唯一产品通道；静态演示版离线降级（ADR-0011 §1–2）。
- 04 Bestdori 账号授权与上传形态（grilling，resolved）：内置登录直传；密码不落盘、仅本地会话 Cookie、凭据不经第三方服务器（ADR-0011 §3）。
- 05 素材版权与使用边界调查（research，open）：本轮事实结论已记录在票内（无官方授权/粉丝惯例容忍/风险梯度）；待查版权方 guideline 与同类案例后回填 ADR-0011 §4。

## Fog

- 实现期必测：登录成功形态（Cookie 名/TTL）、发布字段合法值域、musicjacket 分桶规则、429 阈值 → `docs/research/bestdori-api.md` §8。
- 浏览功能数据边界（官方音频/封面外链与缓存）留实现票设计，结合 05 结论。
- 决策已收敛：落地实现时按 ADR-0011 开实现票（网络 IPC 面 → 谱面浏览 → 登录/上传，三期递进）。
