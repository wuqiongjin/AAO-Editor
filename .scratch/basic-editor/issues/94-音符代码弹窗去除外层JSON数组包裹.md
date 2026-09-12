# 94 · 音符代码弹窗对象视图去除外层 `[ ]` 包裹

Type: bug
Status: resolved（2026-09-12 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-12 第五批复报：音符代码工具展示代码时，JSON 最外层的 `[ ]` 是多余的。

## 症状 / 根因

对象视图三档（整条音符 / 滑条结点 / 子段代码）初值都走 `convertNotesToChartCode([单条])`（`NoteCodeOps.ts:81`、段 `:97`、结点 `:77`），一律展示成**单元素数组**（2026-09-12 页面实测：结点视图 `[ { "beat": 8, … } ]`、段视图 `[{ "type": "Slide", … }]`）。单条音符外面再包数组只是「与完整代码同形态」的实现口径，对用户是噪音。

## 修法

- 三档对象视图初值改序列化**裸对象**（无 `[ ]`）；完整谱面代码视图保持数组不变（数组本身就是谱面格式）。
- 回写容错：对象视图「应用」解析时裸对象与单元素数组**都接受**（先 coerce 再走既有 parse + 恰好 1 条校验），多元素数组仍拒绝；纯逻辑下沉 `NoteCodeOps`/`ChartConverter`（可单测），弹窗只调用。
- 「复制」复制的就是所见裸对象，行为随之，不另处理。

## 锁测

- `NoteCodeOps.test.ts` 新增组：裸对象代码 → 三档 `applyNoteCode` 各自回写成功；单元素数组形态仍接受（兼容旧习惯）；多元素数组仍拒绝。
- textarea 初值 = 裸对象 JSON 属 DOM 展示，单测覆盖不到 → 静态源码断言（初值构造走新的裸对象序列化入口）+ 手工验收：三档打开均无 `[ ]`、编辑裸对象可应用、画布同步。

## Comments

- 2026-09-12 实现 + 锁测（tsc 0 / NoteCodeOps.test.ts 43 例全绿 / 页面实测通过）：
  - `NoteCodeOps` 新增三纯函数：`noteViewCodeToJSON`（单条 → 裸对象 JSON，4 空格缩进）、
    `coerceNoteViewCode`（裸对象/数组都收 → 统一成数组；语法错误与非对象输入 → 定位 noteIndex -1 的错误，不抛异常）、
    `validateNoteViewCodeText`（容错后走与完整视图同一套 §1.2 规则）。
  - `ChartCodeEditorModal`：初值/「从画布刷新」收敛到 `currentViewText()`（对象视图 = 裸对象，完整视图 = 数组不变）；
    `validateCode` 按视图分叉；`handleApply` 对象视图分支改走 coerce → `applyNoteCode(notes, target, coerced.code)`，
    `parseChartCodeFromJSON` 只剩完整视图分支在用。
  - 锁测：NoteCodeOps.test.ts 新增 issue 94 组 12 例（展示 2 / 容错 5 / 校验 3 / 弹窗接线静态断言 2）。
  - 页面实测：结点视图显示 `{ "beat": 8, … }` 裸对象；编辑裸对象应用成功、画布回写、弹窗关闭、重开可见新值。
