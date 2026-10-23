# Map: 测试基建

> Effort: `test-infra` · 2026-10-23 · 开于 CI 门禁竞态红（本地全绿、CI 事件循环相位翻转）

## Destination

测试基建问题的家：共享测试代码（`tests/support/`、provider 替身、假桥）、时序 / 环境依赖（jsdom、事件循环相位、vitest 配置）、跨 feature 的测试失败与模式收敛。**应用功能不归**。

**边界**（建议，用户可调）——满足任一即收：

1. 根因在共享测试基建（`tests/support/*`、替身 / 假桥、时序环境、vitest 配置）；
2. 修复落点横跨 ≥2 个 feature 目录、没有单一归属；
3. 测试基建自身的重构 / 补网 chore（跨 feature 收敛重复模式、补公共 helper）。

**门禁红只是发现渠道，不是归属依据**：锁测红在哪条 feature 的语义上、修的是哪个 feature 的行为，就进哪个 feature 的票。判例：本 effort 的 01（根因 = RTL × React 调度基建，落点 = 15 处 / 9 文件）留下；反之，账号区逻辑写错红一条 AccountBar 用例 → 进 bestdori-integration；某 feature 改动踩坏别家锁测 → 仍是该 feature 的回归票。

## Notes

- 01 进工程详情的 DOM 测试与目录加载竞态（bug，**resolved 2026-10-23**，待门禁连续绿）：等待信号从「全部工程」标题（pending 态也渲染）改为等 `.pb-card[data-project-id]`（pending 占位卡 class 也是 `pb-card`，选择器必须带属性），15 处同模式一并收敛；验收口径与证据见票内 Comments。
