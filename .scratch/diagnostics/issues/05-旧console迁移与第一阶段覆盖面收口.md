Type: chore
Status: open
Blocked by: 01

## 来源

ADR-0019 §2 第一阶段范围。现状：`src/` 18 处 `console.*` + 约 30 处 try/catch，失败路径有降级 / Toast 但无落盘。

## 范围与落点

- **迁移**：18 处 `console.*` 全量切到 logger（`src/i18n/t.ts`、`src/project/useChartProjectPersistence.ts`、`src/preview/video/encode/exportVideo.ts`、`src/rendering/skin/backgroundSkin.ts`、`src/ui/CanvasSpriteIcon.tsx`、`src/pages/assets/AssetsPage.tsx` 等），保留现有模块前缀。
- **第一阶段覆盖核查**：导出（PNG/MP4/WebM）、谱面工程保存 / 加载、资产 / IO 失败路径确保 error / warn 落盘；Bestdori 合并后的网络 / 登录 / 上传失败路径在合并后同批核查（ADR-0019 §2）。
- 用户可见文案**不变**：不把技术错误漏给普通用户（`useVideoExport` 既有口径保持）。

## 锁测

- 静态源码断言：`src/` 不再出现裸 `console.*`（dev 守卫除外）——全树锁一条，单条用例管不住整棵树（照票 03 of release-pipeline 惯例）。
- 单测：关键失败路径（导出失败、工程落盘失败）触发 `logger.error`——在既有 degrade 测试旁补断言。
- 手工验收：诱发一次导出失败 + 一次保存失败，检查 `errors-*.log` 有对应记录。

## Comments

### 2026-10-13 开票备注（合并前）

- 正文的「18 处 `console.*`」与文件清单均为**合并前快照**；`feature/bestdori-integration` 分支很大，可能新增 / 移动 console 点。合并后重新计数——全树静态锁（`src/` 无裸 `console.*`）才是权威判据，清单只作起点。
