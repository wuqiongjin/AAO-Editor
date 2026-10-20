# 12-workflow显示名与发布模式（GitHub 侧栏显示路径；草稿发布模式定案）

Type: chore
Status: resolved
Blocked by: —

**来源**：v0.1.0 发版复盘时暴露两个观察点：GitHub Actions 侧栏 workflow 显示为文件路径；electron-builder 默认创建草稿 release，发布链路末尾需人工放行。

## 症状

- Actions 左侧栏显示 `.github/workflows/ci.yml` / `.github/workflows/release.yml`（路径而非名称）。
- release.yml 全绿但仓库主页侧栏看不到 release——产物在草稿里。

## 根因

- 两个 workflow 文件均无 `name:` 字段，GitHub 即显示文件路径。
- electron-publish 的 GitHub 发布器默认 `releaseType = "draft"`（`options.draft === false ? "release" : "draft"`，源码 `electron-publish/out/gitHubPublisher.js`）。notes job 的 `gh release edit` 对草稿同样成功，故 run 全绿但无公开 release。

## 修法

- 两个 workflow 各加 `name:`（`Release（发版）` / `CI（PR 门禁）`），下次运行起侧栏显示名称。
- 发布模式**维持草稿默认、不设 `publish.releaseType`**：人工 Publish 作为公开前最后一道闸（核对三平台产物 + notes），与未签名包 + electron-updater 自动更新链路的风险相抵（用户 2026-10-20 拍板）。发版流程末尾增加手动 Publish 步骤。

## 锁测

- `tests/static/ReleasePipeline.test.ts`：既有断言只查 workflow 内容（无 bestdori 泄漏等）与 package.json scripts，不锁 `name:` 字段；本改动后相关断言全绿。
- YAML 合法性：js-yaml 解析两个文件，`name` 与 `on` 结构符合预期。

## Comments

### 2026-10-20 用户拍板：维持草稿 + 人工 Publish

- 用户要旨：`releaseType: "release"` 有风险——自动发布会撤掉人工检查点，推错 tag 时 `latest*.yml` 立即生效、自动更新客户端可直接拉到坏包；草稿 + 手动 Publish 更安全可控。
- ADR-0022「正式 Release 直发」的口径是否据此细化，留待后续复审，本票不改 ADR。
