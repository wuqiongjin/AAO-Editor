# 04-preview扩展骨架

Type: feature
Status: open
Blocked by: 03

> **2026-09-29 复核修订**（原票名 `04-upload与preview扩展骨架`）：
> 1. **upload 段移出本票**：`bestdori-integration` 已定案「落地实现时按 ADR-0011 开实现票（网络 IPC 面 → 谱面浏览 → 登录/上传，三期递进）」。上传目录分层与类型契约随那张实现票一次定，避免现在凭空拍板。`src/upload/bestdori/sanitizeChart.ts` 原样保留（目前**只有单测消费者**、无生产调用，见 tests/unit/upload/bestdori/sanitizeChart.test.ts）。
> 2. **视频段有先决条件**：录制方案（WebCodecs vs MediaRecorder vs Electron 后台合成）未定案，`docs/adr/` 里也没有预览相关约定。开工前先 grill，本票只落"驱动契约"的形状，不落实现。
> 3. **静态长图段可直接做**：它是 03 合并后的 `src/rendering/` 基元第一次接到真实调用方，正适合把 seam 验出来。

## 来源与目标

- **来源**：核心路线里的两项预览能力没有归属：
  1. 「完整谱面预览（静态）」：长图分栏排版、离屏全景导出；
  2. 「谱面视频预览（动态）」：游戏仿真回放、时间轴帧录制、视频导出。
  03 完成后渲染基元已唯一（`src/rendering/`），需要为预览建立规范的目录骨架与类型边界，避免后续特性开发时再次随意安放或重蹈"胖工作台"覆辙。
- **目标**：
  1. 新增 `src/preview/` 顶层域，`static/` 与 `video/` 两个子域各立骨架与类型契约；
  2. 梳理预览与 `src/chart/`（数据）、`src/rendering/`（绘制）、`src/audio/`（音频）、`src/playback/`（时钟）的**单向依赖**规则。

## 前置事实（2026-09-29）

- `src/preview/` 不存在，全仓无任何预览 / 导出成图代码。
- `docs/adr/` 无预览相关 ADR；本图 Fog 挂着两条待验证：静态分栏算法 + 离屏 Canvas 大图尺寸上限；视频录制方案三选一。
- 03 完成后 `src/rendering/index.ts` 是对外唯一绘制入口。
- 仓库没有 `npm run typecheck`；类型门禁用 `npx tsc -b`。

## 落点

1. `src/preview/static/`：
   - `sheetLayout.ts`：把整首谱面（按小节 / 秒）切片分栏的几何布局**纯函数**契约——输入谱面数据 + 画布尺寸，输出每栏的窗口区间与坐标变换；
   - `staticSheetRenderer.ts`：调用 `src/rendering/` 基元把一栏画进离屏 canvas 的骨架（先不做整图导出与分栏算法调优）。
2. `src/preview/video/`：
   - `simulationRenderer.ts`：定义「接收播放时钟毫秒 → 输出当前帧画面到 Canvas」的驱动契约；
   - `recorder.ts`：媒体录制器（MediaRecorder / Canvas stream）抽象接口。
   - **只落接口与类型**，实现留给特性票；若开工时方案仍未定案，video 段整段推迟，先交 static 段。
3. 依赖规则（写进新目录头注释）：`preview → rendering / chart`、`preview → playback`（时钟）允许；`chart` / `rendering` / `playback` **不得** import `preview`；`preview` 不得 import `pages/`。
4. ADR 不预设：是否落《静态导出与视频预览架构约定》由 grill 定案后另记，本票不预先写结论。

## 锁测要求

- 新增骨架通过 `npx tsc -b`；既有 `npm test`（164 文件 / 1919 用例）保持全绿。
- `sheetLayout.ts` 的几何纯函数按 unit 单测锁：`tests/unit/preview/SheetLayout.test.ts`（分栏边界、末栏残段、空谱面、单小节）。
- **替代验证**（Canvas 像素 / 离屏尺寸无法用 node 单测）：`staticSheetRenderer` 的离屏尺寸上限与大图内存用 Playwright 实测或手工验收清单兜底，票内落清单后再实现。
- 既有测试无需改动（新目录，无存量引用）；`tests/unit/upload/bestdori/sanitizeChart.test.ts` 不受本票影响。

## Comments
