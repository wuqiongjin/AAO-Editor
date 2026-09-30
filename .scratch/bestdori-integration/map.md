# map — bestdori-integration

## Notes

- 目标：让编辑器与 Bestdori 平台互通（官方/社区谱面浏览 → 内置登录直传发布）。
- 事实底座：`docs/research/bestdori-api.md`（只读端点）+ `docs/research/bestdori-community-upload.md`（2026-09-24 写路径实测）。
- 格式互通已在 `basic-editor/issues/02` 定案：编辑器谱面代码与 Bestdori 高度兼容，仅需导出字段规范化。
- 产品形态定案（2026-09-12）：本地客户端（Electron）为唯一正式形态；Web 仅纯前端静态演示（不带 Bestdori 在线功能）。

## Decisions-so-far

- 01 Bestdori API 全量调研（research，resolved）：a 脚本非风险点（再分发才是）/ b 端点齐但无 CORS 需代理 / c 无 OAuth 仅账密会话。
- 02 公开版素材策略（grilling，resolved）：维持现状继续捆绑；版权问题拆 05；公开运营/变现前复审（ADR-0011 §4）。
- 03 谱面浏览的网络架构与数据边界（grilling，resolved）：本地客户端形态 → Electron 主进程网络层为唯一产品通道；静态演示版离线降级（ADR-0011 §1–2）。
- 04 Bestdori 账号授权与上传形态（grilling，resolved）：内置登录直传；密码不落盘、仅本地会话 Cookie、凭据不经第三方服务器（ADR-0011 §3）。
- 05 素材版权与使用边界调查（research，open）：本轮事实结论已记录在票内（无官方授权/粉丝惯例容忍/风险梯度）；待查版权方 guideline 与同类案例后回填 ADR-0011 §4。
- 06 社区能力层地基（grilling，resolved 2026-09-30）：能力域目录 `src/community/` + 平台子目录、薄主进程（方案 a）、16 项能力清单、**上传 / 发布**二分、**谱师**、会话与 Cookie 存放；地基先于业务场景落地，实现票 07–11。
- 07 网络 IPC 面与主进程网关（feature，open）：主进程只做发请求 + 管 Cookie + 限流；二进制不过 IPC（回落路径）；锁测口径改为「域名白名单 + 出口唯一」，取代 03 那条旧口径。
- 08 曲库浏览与官方曲导入（feature，open，T1 竖切）：A 素材默认 / B 官方谱面代码默认关、产出空 Expert 谱面、等级不预填、下载暂存、换音频即把曲目来源置 `custom`。
- 09 社区帖浏览与导入（feature，open）：`post/list` 上拉加载 + 客户端过滤等级难度、谱面名称留空不预填帖子标题、按 `song.type` 处理曲目。
- 10 账号与会话（feature，open）：内置登录直传、Cookie 存 `safeStorage`、会话唯一真相、失效 = 写能力变灰而读能力保留。
- 11 发布（feature，open）：三步二进制上传 + 必填预检 + 静默 sanitize + 实底红确认 + **首次写入 `upload` 记录**。

## Fog

- 实现期必测：Cookie TTL / 多端登录、Custom 上传、LLSIF 发帖、429 阈值 → `docs/research/bestdori-api.md` §8；写路径已测部分见 `docs/research/bestdori-community-upload.md`。
- 浏览功能数据边界（官方音频/封面外链与缓存）留实现票设计，结合 05 结论。
- 决策已收敛：落地实现时按 ADR-0011 开实现票（网络 IPC 面 → 谱面浏览 → 登录/上传，三期递进）。
- 上传入口与上传记录在 [chart-projects](../chart-projects/map.md)（ADR-0015 §4：每张谱面至多上传一次、已上传只读）；上传实现票要写入该记录。[chart-projects 07 从 Bestdori 新建工程](../chart-projects/issues/07-从Bestdori新建工程.md) 被网络 IPC 实现票阻塞。
