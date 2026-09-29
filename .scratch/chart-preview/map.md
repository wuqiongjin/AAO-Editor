# Map: 谱面预览能力

> Effort: `chart-preview` · 2026-09-29

## Destination

走到尽头 = 谱面作者可以在编辑器画布之外，看到 / 导出自己的谱面：

1. **静态长图预览**：整首谱面切片分栏，离屏全景导出为长图；
2. **动态视频预览**：游戏仿真回放 + 时间轴帧录制 + 视频导出，效果**流畅、可定制、便捷、快速**——尤其服务"观赏性谱面"作者；
3. 预览与 `src/chart/`（数据）、`src/rendering/`（绘制）、`src/audio/`（音频）、`src/playback/`（时钟）保持**单向依赖**。

## Notes

- **从零开始的基础能力**：仓库当前无任何预览 / 导出成图代码，是新建能力（非对已有能力的增强）。
- **质量门槛是验收维度，不是能力分类**：流畅度 / 可定制 / 便捷 / 快速写入各票锁测，不写进 effort 名。
- **跨 effort 依赖**：本能力依赖 `architecture-refactor/03` 完成后 `src/rendering/index.ts` 成为唯一绘制入口。03 未 resolved 前不开工。
- 具体要做哪些子能力（静态 / 视频先做哪个、视频录制方案等）尚待定，开工时再细化。
- 仓库没有 `npm run typecheck`；类型门禁 = `npx tsc -b`。
- 既有的 `npm test`（164 文件 / 1919 用例）对新目录无存量引用，新增骨架只需保证 `npx tsc -b` 通过、既有测试不红。

## Decisions so far

- 命名定为 `chart-preview`（谱面预览）。

## Frontier

- [01 谱面预览](./issues/01-谱面预览.md) — Blocked by: architecture-refactor/03；待领

## Fog

- 静态预览分栏导出算法与离屏 Canvas 大图尺寸上限待具体实现时验证。
- 视频录制导出方案（WebCodecs vs MediaRecorder vs Electron 后台合成）待定案。
- 是否落《静态导出与视频预览架构约定》ADR 待定。
- upload 骨架不属本 effort：随 `bestdori-integration` 实现票一次定（ADR-0011 三期递进：网络 IPC → 谱面浏览 → 登录 / 上传）。
