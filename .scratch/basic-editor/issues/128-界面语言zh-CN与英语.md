# 128 · 界面语言：zh-CN 与英语

Type: grilling
Status: resolved
Blocked by: 122

## 来源

产品要做多语言。122 只盘点、不拍开工。2026-09-19 grilling 定案后本票为执行载体（含 ADR-0003 / CONTEXT 已改术语与配置段）。

调研：[122](./122-多语言硬编码字符串盘点.md)，成本细表 `docs/research/i18n-engineering-cost.md`。

## 定案（用户 2026-09-19）

| # | 定案 |
| --- | --- |
| 1 | **交付**：第一种外语可切换；用户可见文案全翻（壳 / 四内容页 / 工作台 / 快捷键表 / 校验与确认 / Electron 对话框）。开发者日志、覆盖规则内部 `message` 不翻。 |
| 2 | 本期 locale = **`zh-CN` + `en`**。日语、繁体中文后续各加字典，本票不做。 |
| 3 | 设置**外观**一项，**运行时切换**，写入 `settings.uiLanguage`；**不进谱面工程**。导入导出**覆盖**语言（与主题相同）。 |
| 4 | 无已存/非法值：OS `zh-CN`/`zh-Hans`/`zh` → `zh-CN`；`en*` → `en`；**`zh-TW`/`zh-HK`/`zh-Hant` 暂用 `zh-CN`**（繁中出货后再跟 OS）；其余 → `en`。 |
| 5 | 缺某句译文 → 回退 **`zh-CN`**（可 `console.warn`）。 |
| 6 | **手搓** locale JSON + 类型化 key + 小 `t()` / 英语 `one`/`other`。**不**引进 i18next。主进程与渲染共用同一份字典。 |
| 7 | 缓动族/型/模板：每个语言自己写完整展示串（中文可留 `Sine（正弦）`，英文可以是 `Sine`）。不拆键。 |
| 8 | 键型英语跟 JSON/CONTEXT：Single / Flick / Skill / Slide。方向键全称 **Left Directional Flick** / **Right Directional Flick**。键型格只图标；顶栏当前工具等窄处 **Left** / **Right**；快捷键表与 tooltip 用全称。 |
| 9 | **不翻译**：画布 START/END、时间码、BPM 缩写、谱面 JSON 字段名、应用名 `BangDream Editor`、开发者日志。 |
| 10 | **RTL 不做**；画布轨道序永远 LTR。界面字体栈仍不随语言自动换。 |
| 11 | `index.html` / `document.documentElement.lang` 跟当前界面语言（修掉「界面中文、html lang=en」）。 |

## 本轮实现口径（待验收）

- `uiLanguage` additive，**不 bump `schemaVersion`**；脏值走 OS 解析规则。
- 英文字典由实现稿一版，你页面验收时改词。
- 日语 / `zh-TW` 只保证接缝能再加一份 JSON，不预填译文。

## 不做

- i18next、按语言打两份包、RTL、繁中/日语出货、开发者日志翻译、画布标线拉丁化词条。

## 实现落点

- 字典 + `t()`：渲染与 `electron/*.cjs` 都能读（系统对话框跟当前语言）。
- `AppSettings` / 外观设置行 / `mergeSettings`；切语言立即换文案并写 `lang`。
- 抽 122 分层里的用户可见硬编码；`ShortcutConfig` 与工具栏专名同源，避免再双份中文。
- 修订 [ADR-0003 §6](../../../docs/adr/0003-工作台UI与配置系统.md)（已写入界面语言条）；CONTEXT「界面语言」已更新。

## 锁测

- `mergeSettings`：缺/脏 `uiLanguage` → OS 映射表（单测注入假 OS tag）；导入导出带上该字段。
- 缺键：`en` 缺句回退 `zh-CN` 原文。
- OS 表：`zh-TW`→`zh-CN`、`fr`→`en`、`en-GB`→`en`。
- 静态：`package.json` 无 i18next；源码零 `i18next`。
- 方向键：英语全称锁 `Left Directional Flick` / `Right Directional Flick`；顶栏短名不是全称。
- 手工：外观切换立即整页换语言（含下次 Electron 选文件夹对话框）；画布 START/END 不变。

## Answer

手搓 `src/i18n` + `electron/i18n.cjs` 共用 locale JSON；`settings.uiLanguage` additive 不 bump schema；外观运行时切换并写 `document.documentElement.lang` / Electron `i18n:setLanguage`。缺键回退 zh-CN。锁测在 `tests/unit/UiLanguageSettings.test.ts`。布局原型 `?prototype=page-shell` 未翻（非产品壳）。

## Comments

- 2026-09-19 grill：Q1=A、Q2=A（日后日语）、Q3=A、Q4=A、Q5=A、Q6=A、Q7=B 且未知 OS→en、Q8=A、Q9=A 且 Left/Right + Directional Flick、Q10=A、Q11=A、Q12=B（键型格仅图标；短名在顶栏当前工具）、Q13=A、Q14=B（本期 zh-CN，繁中未来单开）、Q15=A、Q16=A（繁中前 zh-TW/HK 暂用 zh-CN）。
