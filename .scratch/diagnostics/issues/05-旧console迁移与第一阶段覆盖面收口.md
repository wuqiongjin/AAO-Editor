Type: chore
Status: open
Blocked by: 01

## 来源

ADR-0019 §2 第一阶段范围。2026-10-13 快照：`src/` 18 处 `console.*` + 约 30 处 try/catch，失败路径有降级 / Toast 但无落盘。

## 范围与落点（2026-10-19 收窄）

**成功标准不是 `src/` 零 `console.*`。** 本票把第一阶段失败写进票 01 的 logger；噪音级 warn（缺 i18n key、皮肤 / 精灵预加载失败）可仍留 `console`，或顺手切 logger 但不作为收口条件。

必须落盘的失败路径（UI 文案不变，技术细节进 logger）：

| 路径 | 现状 | 落点 |
| --- | --- | --- |
| 谱面工程保存 / 加载 | `useChartProjectPersistence.ts` 只 `console.warn`，**无 Toast** | `logger.error/warn('[chart-project]', …)`；是否补用户可见提示本票不改语义，只补落盘 |
| 视频导出 | `exportVideo.ts` / `useVideoExport.ts`：`console.error` + 界面 notice | catch 里加 `logger.error('[preview]', …)` |
| 静态图导出 | `PreviewPage.tsx`：`console.error` + Toast | 同上 |
| 资产 / 皮肤 IO | `AssetsPage.tsx`、`backgroundSkin.ts` | 保存 / 清除失败走 logger |
| Bestdori 网络 / 登录 / 上传 | `CommunityError.message` 注释写明只作诊断，但无处可写；`src/community/` 无 `console.*` | 在 transport / 登录 / 发布失败汇聚点 `logger.error('[community]', message, { kind, httpStatus, platformCode })`——**不要**把 Cookie / 密码放进 extra |
| 应用更新 | `SettingsPage` Toast | 检查 / 安装失败走 logger |
| 主进程工程存储 | `electron/projectStore.cjs` 三条 `console.warn` | 改调票 01 的主进程 sink |

用户可见文案**不变**：不把技术错误漏给普通用户。

## 锁测

- 单测：关键失败路径（导出失败、工程落盘失败、一份 `CommunityError`）触发 `logger.error`——在既有 degrade 测试旁补断言。
- 静态源码断言：**不要**锁「`src/` 无裸 `console.*`」。可锁「上表列出的文件在失败分支调用 logger」（或抽一层包装后锁包装被调用）。
- 手工验收：诱发一次导出失败 + 一次保存失败 + 一次社区请求失败（断网即可），检查 `errors-*.log` 有对应记录。

## Comments

### 2026-10-13 开票备注（合并前，存档）

- 正文曾要求 18 处 `console.*` 全量切到 logger，并以全树无裸 `console.*` 为权威判据。2026-10-19 改为上表覆盖面；全树清零不作本票目标。

### 2026-10-19 现状复核（计数，仅作起点）

- `src/` 仍约 18 处 `console.warn/error`（i18n、持久化、导出、皮肤、画布精灵、设置页数据根切换后读目录等）。
- `electron/`：`projectStore.cjs` 3、`i18n.cjs` 1。
- `src/community/`：0 处 `console.*`，失败已结构化，缺的是落盘。
