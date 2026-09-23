# 152 · Ctrl+Space 回跳标记视觉表达

Type: feature
Status: open
Blocked by: —

## 来源

用户 2026-09-23 反馈：Ctrl+Space 设置的回跳播放标记当前看起来只是一个难以理解的箭头。关联 [17](./17-播放预览交互重做.md) 与 [65](./65-Slide临时锚点与幽灵hover.md)。

## 定案

- 语义仍是播放用的**临时起点标记**，不进入谱面代码，也不是判定线。
- 保持现有交互：左侧沟槽双击设置/替换/删除，`Ctrl+Space` 跳回该位置并播放。
- 视觉改为左侧沟槽内的横向标记线，加明确表达“回跳并播放”的图标组合（回转箭头 + 播放三角）。
- 不绘制贯穿整条谱面的长线，避免与 BPM、起始线、结束线混淆。
- 悬停时提供说明 `Ctrl+Space` 的 tooltip；不增加常驻长文案。

## 修法

改造 `src/visual/render.ts` 的 `renderStartMarker` 绘制层，并保持 `FinalVirtualCanvas`、播放协调器和双击手势的状态/交互契约不变。

## 锁测

- 新增 `tests/unit/visual/render/PlaybackMarker.test.ts`：锁定沟槽横线、回跳图标、播放三角和不贯穿轨道的几何范围。
- 保持 `tests/unit/settings/ShortcutConfig.test.ts` 的 `Ctrl+Space` 注册回归。
- DOM tooltip、Canvas 图标可辨识度和双击/快捷键联动无法由纯单测完整覆盖，补 Playwright 截图与交互验收。
