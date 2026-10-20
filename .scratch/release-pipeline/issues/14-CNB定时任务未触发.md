# 14-CNB 每日 22:00 定时任务不触发（cron 表达式六字段，平台不注册）

Type: bug
Status: resolved
Blocked by: —

**来源**：用户 2026-10-20 报「每天晚上 10 点的 cnb 的任务没触发」。

## 症状

- `.cnb.yml` 配了 `"crontab: 0 22 * * * *"`，但 2026-10-20 22:00（Asia/Shanghai）到点无任何 cron 构建。
- 构建历史实证（`cnb build get-build-logs`，10-18 ~ 10-20）：cron 运行只发生在 10-19，事件名 `crontab: */30 * * * *`（10:30 / 11:00 / 11:30 UTC 红，12:00 UTC 绿）；10-19 22:35 推送六字段表达式后至今零 cron 构建；同期 push / tag_push / pull_request 流水线全部正常——只有 cron 触发消失。

## 根因

- CNB 定时任务只支持**标准 POSIX cron 五字段**（`分 时 日 月 周`），**无秒字段**（官方文档 docs.cnb.cool/zh/build/crontab.md 原文：「标准 `POSIX cron` 表达式」，示例 `crontab: 30 5,17 * * *`）。
- 配置写成六字段 `0 22 * * * *` → 非法表达式，平台**不注册该定时任务且静默**：`.cnb.yml` 整体解析不受影响（其他事件流水线照跑），只是到点不触发，无任何报错——所以门禁全绿也发现不了。
- 时区无嫌疑：平台固定 Asia/Shanghai（文档明示），且 10-19 的 `*/30` 运行时刻（UTC 10:30/11:00/11:30/12:00 = 北京 18:30/19:00/19:30/20:00）与东八区口径吻合。

## 修法

- `.cnb.yml`：`"crontab: 0 22 * * * *"` → `"crontab: 0 22 * * *"`（五字段），注释写明五字段约束与「不注册且静默」的失效形态。
- 生效前提：修复需**推送到 CNB**（cron 随 `.cnb.yml` push 重新注册；负责人 = 推送者）。若页面「定时任务」仍显示旧态，可手动 `cnb build build-crontab-sync --repo AsterPicker/AAO-Editor --branch main` 同步。

## 锁测

- `tests/static/ReleasePipeline.test.ts`「五种触发俱全」条：`crontab: 0 22 * * *"`（收尾引号锁死五字段）+ 负锁 `not.toContain('crontab: 0 22 * * * *')` 防回退六字段。
- 平台注册行为单测覆盖不到；替代验证 = 推送后构建历史出现 `crontab: 0 22 * * *` 事件构建（或定时任务页面可见下次执行时间）。

## Comments

### 2026-10-20 调查与修复

- 排查路径：官方文档（crontab.md / trigger-rule.md）→ git 历史（六字段自 202fbd6c 引入，`*/30` 五字段版从未提交过）→ CNB 构建历史 API 实证（零 cron 构建，其他事件正常）→ 定位为表达式字段数。
- 组织级「允许定时任务自动触发」无嫌疑：10-19 cron 实际跑通过，开关为开。
- 落地：修复以单笔提交推送到 CNB main 并经镜像同步 GitHub；`build-crontab-sync` 手动同步过一次；push 门禁全量测试绿。
