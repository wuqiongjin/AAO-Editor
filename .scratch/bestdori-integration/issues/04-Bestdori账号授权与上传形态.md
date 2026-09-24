Type: grilling
Status: resolved
Blocked by:

## 来源

`bestdori-integration/issues/01` 调研（用户 2026-09-12 问题 c：适配谱面代码上传到 Bestdori）。

## 问题

Bestdori **没有 OAuth / API Token**，唯一授权方式是「用户名 + 密码 → `POST /api/user/login` → Cookie 会话」（实测错误形态；成功形态与 Cookie 名需真实账号验证）。上传链路 API 齐备（文件 prepare→multipart→status 三步 + `POST /api/post` 发布），**全部需登录态**。需要拍板的是「用户的 Bestdori 凭据怎么经手」：

## 选项

- **A. 半自动：产品不碰凭据（推荐起步）**：编辑器导出「谱面代码 + 上传素材清单 + 操作指引」，一键打开 Bestdori 官网上传页，用户自己登录粘贴。最合规、零信任成本、无服务器参与；代价是体验割裂（不能在产品内一键发布）。
- **B. 产品内置登录直传**：用户在产品内输入 Bestdori 账号密码。体验最好；代价：凭据/会话经产品经手（web 版必然经我们服务器中转 → 信任与安全设计成本高；Electron 版可主进程直连、凭据只存本地 IndexedDB/Keychain）。还需自控发布速率、处理账号风控风险。
- **C. 分期：先 A 后 B**：先交付 A（价值：谱面代码/格式已互通，搬运成本骤降），B 按用户呼声再立项。

## 定案

**内置登录直传（选项 B）（用户 2026-09-12，对话拍板）。** 用户补充关键前提：产品仅本地客户端形态 → 凭据不经任何第三方服务器（产品无服务器），web 信任风险消解。已落 ADR-0011 §3。

## 实现落点

- 凭据红线（随 ADR-0011 §3）：密码不落盘（会话结束即弃）；仅持久化会话 Cookie（Electron 安全存储/加密）；提供登出清除。
- 上传链路按 `docs/research/bestdori-api.md` §4–5 实现（prepare → multipart → status 轮询 → `POST /api/post`）；发布速率自控。
- 静态演示版不提供本能力（ADR-0011 §1）。
- 实现前先按 §8 待验证清单实测登录成功形态（真实账号）。

## Comments

- 2026-09-24：用户再次询问「能否在软件内上传到 Bestdori」。结论未变（API 齐备、无官方文档、无 OAuth、无 CORS）。当日对照现行 `CommunityChartsNew.b534f9a9.js` 再核了 `onPublish` 字段与默认 `diff=3/level=20`、正文 5000 字、谱面发布后不可改；细节写入 `docs/research/bestdori-api.md` §9。实现仍未开工（Electron 网络 IPC 尚未落地）。不另开调研票。
- 2026-09-24：用测试账号完成写路径实测（登录 Cookie 名 `token`、Bandori 渠道发帖、官方 JSON 须丢掉 System/`charge`、无删帖接口）。完整记录：`docs/research/bestdori-community-upload.md`。

## 锁测

决策票：实现票需补「密码不落盘」锁测（登录后本地持久化目录中不出现明文密码的静态/运行时断言）。
