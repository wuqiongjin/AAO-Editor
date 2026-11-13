# 227 · 音符代码弹窗「对象视图」应用成功无 toast

Type: bug
Status: resolved
Blocked by: —

## 来源

用户 2026-11-10 验收反馈 #1：在音符代码弹窗里只针对音符代码编辑后点「应用更改」，没有任何 toast 提示。

## 症状

- 对象视图（整条音符 / 子段 / 结点代码）编辑后应用成功：画布已更新、弹窗关闭，但无成功提示。
- 对照：完整谱面代码视图（`target.kind === 'chart'`）应用成功会弹 `chartCode.applyOk`「谱面代码已成功应用到编辑器」。
- 对象视图应用失败（校验不过 / coerce 失败 / 回写异常）反而有 danger toast，唯独成功路径没有。

## 根因

`ChartCodeEditorModal.handleApply` 两条成功出口不对等：完整视图走 `commitApply()` → `showToast(t('chartCode.applyOk'), 'success')`（`ChartCodeEditorModal.tsx:295`）；对象视图（`target.kind === 'note'`）走 `handleNotesChange(r.notes); close(); return`（:322-330），**完全没有 toast 调用**。`handleNotesChange`（`EditingProvider.tsx:92`）只 `commitNotes`、不发 toast；`ToastHost` portal 到 `document.body`（`ui/Toast.tsx:84`），`close()` 也不会顶掉 toast ⇒ 不是「被弹窗关闭吞掉」，而是这一分支从没发过成功反馈。成功 toast 只加在了 `commitApply` 一侧，对象视图回写分支漏了。

## 修法（已实现）

`handleApply` 对象视图成功分支：`handleNotesChange(r.notes)` 之后、`close()` 之前补 `showToast(t('chartCode.applyOk'), 'success')` —— 与 `commitApply` 逐字同款（`ChartCodeEditorModal.tsx:328`）。复用既有文案键，不加对象视图专用文案；失败 / 校验 / `needBpm0` / 覆盖确认路径全部不动。toast 是 `document.body` portal，`close()` 不影响其显示。

## 锁测（已落地）

- `tests/static/ChartCodeNoteViewApplyToast.test.ts`（新增，4 例）：照 `ChartCodeParseOnce.test.ts` / `ChartCodeDurationSync.test.ts` 的 `readStripped` 静态看守惯例 —— toast 是模块级 emit + portal 的 DOM 时序，单测盖不到「调用点有没有接上」。
  1. 全弹窗里 `showToast(t('chartCode.applyOk'), 'success')` **恰好两处**（完整视图 `commitApply` + 对象视图 `handleApply`）；删任一处即变红（正是本 bug 的形态）。
  2. 对象视图分支：含 `handleNotesChange(r.notes)`、含该 toast、含 `close()`，且 toast 在 `close()` 之前。
  3. 对象视图回写被拒仍走 `rejectNoteApply`，且失败路径不落到 success toast（`/code-review` 后加固：断言两处 `rejectNoteApply(...); return;` 成对存在 —— 仅用「第一条 reject 在 toast 之前」的位置断言会在删掉 `return` 时假绿）。
  4. `chartCode.applyOk` 文案键在 `zh-CN.json` 存在（两条出口同源）。
- 既有看守 `tests/static/NoWindowAlert.test.ts` 数着弹窗内 `showToast(` 调用点总数：新增第 9 处后由 `toBe(8)` 同步改为 `toBe(9)`、清单补「对象视图应用成功」，属预期内计数更新（非回归）。
- 本仓**没有**该弹窗的 DOM 挂载测试（相关测试全是 static / 纯函数单测），故「DOM spy」一项以静态断言替代，符合票内「单测覆盖不到的写明替代验证」口径。
- **手工验收（2026-11-11 用户全部通过）**：分别用「完整谱面代码」与「音符代码」编辑后应用，两视图都弹同款成功 toast；失败路径仍弹 danger；对象视图应用后仍自动关闭（issue 59 定案不变）。

## Comments

- 2026-11-11 用户补充：完整谱面代码视图「应用」后**不自动关闭**，对象视图「应用」后**自动关闭**，问是否统一。核实：这是 **issue 59 已拍板的设计**（`59-谱面代码入口与单音符视图.md:183`「对象视图应用成功后关闭弹窗（完整代码视图保持原样：alert 后继续停留）——理由：对象视图是『点谁看谁』，回写即完成」），且 `noteCode` 是「态驻留」持工具态（`UIProvider.tsx:19`、issue 59 §2/§3）：关掉弹窗后可直接点下一个音符 ⇒ 自动关闭是该流程的一环，不是遗漏。
  - 完整视图停留的理由：`lastAppliedCode` / `isDirty` / `isStale` / `askOverwrite` 覆盖确认 /「从画布刷新」/ 警告面板都活在弹窗内，自动关闭会丢整套迭代编辑上下文（`ChartCodeEditorModal.tsx:278-299` 的 `commitApply` 无 `close()`）；另有 `target` 失效自动关闭守卫（:175）。
  - 结论：**建议保持现状、不统一**。本票 227 的 toast 与 `close()` 顺序无关（toast 是 `document.body` portal，`ui/Toast.tsx:84`），照常补即可。若用户决定要统一（任一方向都需改 `handleApply` 收尾），再单独开 `grilling` 票，**不并入本票**。
- 2026-11-11 用户确认：**不重开定案**，issue 59 已拍板，保持现状。本票只保留「对象视图应用成功无 toast」这一条待修缺陷，不扩成关闭行为票。
- 2026-11-11 用户**界面手工验收全部通过**（两视图成功 toast 一致、失败路径 danger、对象视图应用后自动关闭），本票收尾并提交；`/code-review` 两轴意见已处理（map.md 流水账回清、227 静态锁测第 3 条加固），其余惯例类判断按理由保留现状。

## Answer

**resolved（2026-11-11）**。对象视图应用成功分支补上与完整视图同款的 success toast，两条成功出口对齐。
- 改动：`src/chart/components/code-editor/ChartCodeEditorModal.tsx` 一行（含注释）；新增 `tests/static/ChartCodeNoteViewApplyToast.test.ts` 4 例静态锁测。
- 验证：`npx vitest run` 全量通过、`npx tsc -b` 0 错误（详见本轮全量验证记录）。
- 手工验收：2026-11-11 用户全部通过；本票随 227/229 修复一并提交（2026-11-11）。
- 自动关闭行为差异按 issue 59 保持现状，未改动、未另开票（见 `## Comments`）。
