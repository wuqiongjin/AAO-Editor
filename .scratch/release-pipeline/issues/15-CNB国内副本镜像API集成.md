# 15-CNB 国内副本镜像 API 集成（三轮校准：404 → 406 → 400 → 跑通）

Type: bug
Status: resolved

**来源**：用户报「票 14（cron 修好）后每日任务仍失败」。此后三轮验收逐层剥开同一处的三个想当然（路径前缀 / Accept 媒体类型 / 上传全链口径），第 3 轮跑通；逐轮实录见下方 Comments。

## 症状（按验收轮次）

- 第 1 轮：建 CNB release 即 HTTP 404，1.1s 即败。
- 第 2 轮：查 release 即 HTTP 406（内容协商）。
- 第 3 轮前：发起上传 ✓ → COS 直传 ✓ → 确认步 HTTP 400。

## 根因（三层，各自独立）

- **路径**：三个 CNB 端点都在 base 与 slug 之间多插一层前缀，而 CNB 仓库级路由一律 `/{repo}/-/…`。实证：同 slug 正确路径匿名请求 401「未登录」（路由存在、待鉴权），带前缀 404（路由不存在）。且 GET 的 404 被当成「release 不存在」静默吞掉，问题一路憋到 POST 创建才响亮失败——所以票 14 修完 cron 才暴露本票。
- **媒体类型**：Node fetch 默认 `Accept: */*`，CNB 网关要求显式版本化媒体类型。
- **上传全链**：python-cnb SDK 的 `upload_releases` + `asset-upload-confirmation` 是走不通的旧口径——发起响应里没有 `token` 字段，拼出的确认 URL 里是 undefined，必 400。

## 修法（终态）

- 上传全链换成 cnbcool/attachments 插件 TS / Go 两版实现交叉验证的同型流程：`asset-upload-url` 发起（体 `asset_name/size/ttl`）→ PUT 直传（octet-stream + 显式 Content-Length）→ POST 响应里的 `verify_url` 回认；路径去前缀层；全链 Accept 统一 `vnd.cnb.api+json`；鉴权 Bearer；CNB 失败日志带服务端错误体。
- 创建体补 `draft/prerelease: false`（ADR-0022 §6 正式 Release 口径）；幂等（附件齐则跳过）不变。

## 锁测

- `tests/static/ReleasePipeline.test.ts` 两条：路径前缀正负锁 + 插件同型全链形状（旧端点 / `?filename=` / 手拼确认 URL 负锁），21/21 绿。
- 脚本内 TODO（上传字段名待冒烟校准）已在第 2 轮按插件实现落地后移除。

## Comments

### 2026-10-22 验收第 1 轮：406（内容协商）

- 路径修好后 GET-by-tag 报 406。根因：Node fetch 默认 `Accept: */*`，CNB 网关要求显式版本化媒体类型。按 python-cnb SDK 校准：release 系 `vnd.cnb.api+json`，附件上传 / 确认 `vnd.cnb.web+json`（两套不同）；鉴权统一 `Bearer`（原 GitHub 式 `token` scheme 换掉）。
- 借校准一并落实 SDK 证据：发起上传的 filename 走 body `name` 字段（原 query `?filename=` 不被识别）、响应取 `upload_url`（原取 `url` 必 undefined）、新增直传后 confirm 回认步（缺它字节到了 COS 但附件不挂 release，需 release_id）、创建体补 `draft/prerelease: false`（ADR-0022 §6 正式 Release 口径）。
- 锁测扩一条：媒体类型 / Bearer / 上传全链形状（含 `?filename=` 负锁）。
- 待验收第 2 轮：重跑后关注「发起上传 → COS 直传 → 上传确认」三步与幂等跳过。

### 2026-10-22 验收第 2 轮：确认步 400（端点整套换掉）

- 第 2 轮走到「发起上传 ✓ → COS 直传 ✓ → 确认 ✗ 400」。根因：SDK 文档的
  `AssetsApi.upload_releases` + `asset-upload-confirmation/{release_id}/{token}/{asset_path}`
  是一套**走不通的旧口径**——发起响应里没有 `token` 字段，拼出的确认 URL 里是
  `undefined`，必 400。
- 处置：clone cnbcool/attachments 的 TS 与 Go 两版实现（`cnb.cool/cnb/plugins/cnbcool/attachments`、
  `cnb.cool/svn/attachments`）交叉验证，全链换成插件同型：
  ① 发起 `POST /{repo}/-/releases/{release_id}/asset-upload-url`，体
  `{asset_name, size, ttl: 0}`（SDK 的 `name` 服务端不识别）；
  ② 直传 **PUT** `upload_url`，octet-stream + 显式 Content-Length（对象存储拒 chunked）；
  ③ 回认 **POST 响应里的 `verify_url` 绝对地址**（Bearer + api+json），不自己拼路径。
  全链 Accept 统一 api+json（web+json 是那套旧端点的，随之作废）。
- 顺手：CNB 失败日志带服务端错误体（插件同型 describeError，光有状态码没法定位）。
- 锁测两条同步改写（asset-upload-url / PUT octet-stream / verify_url，负锁旧端点）。
- 待验收第 3 轮：预期「创建 → 下载 → 上传 → 确认」全过 + 幂等跳过（附件齐则跳过）。

### 2026-10-22 验收第 3 轮：通过（用户确认）

- 创建 → 下载 → 上传 → 确认全过，幂等跳过正常。三轮迭代 commit 同日 squash 为一笔（用户拍板合并且自行 push；归档见本票与 map 指针）。
