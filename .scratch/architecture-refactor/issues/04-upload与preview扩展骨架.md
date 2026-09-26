# 04-upload与preview扩展骨架

Type: feature
Status: open
Blocked by: 03

## 来源与目标

- **来源**：未来核心路线规划了三大扩展能力：
  1. 「Bestdori 社区上传」（凭据、API、清洗、已上传只读回写）；
  2. 「完整谱面预览（静态）」（长图分栏排版、离屏全景导出）；
  3. 「谱面视频预览（动态）」（游戏仿真回放、时间轴帧录制、视频导出）。
  在完成 01~03 的目录收敛后，需要为这三项能力建立规范的目录骨架与类型边界契约，避免后续特性开发时再次引入代码随意安放或重蹈“胖工作台”覆辙。
- **目标**：
  1. 扩充并规范 `src/upload/` 目录：建立清晰的客户端通信（`client/`）、数据清洗（`sanitize/`）与弹窗界面（`ui/`）分层。
  2. 新增 `src/preview/` 顶层域：
     - `src/preview/static/`：静态全谱分栏排版契约与离屏渲染骨架。
     - `src/preview/video/`：动态视频仿真渲染契约与时间轴录制骨架。
  3. 梳理三项能力与 `src/chart/`（数据）、`src/rendering/`（绘制）、`src/audio/`（音频）、`src/playback/`（时钟）的单向依赖规则。

## 现状与重构落点

1. **`src/upload/` 目录规范**：
   - 现存 `src/upload/bestdori/sanitizeChart.ts` 归位至 `src/upload/sanitize/` 或保留为 `src/upload/bestdori/`。
   - 定义上传凭据管理、发帖契约与上传对话框骨架类型。
2. **`src/preview/` 骨架落地**：
   - `src/preview/static/`：
     - `sheetLayout.ts`：定义将整首谱面（按小节/秒数）切片分栏的几何布局契约。
     - `staticSheetRenderer.ts`：调用 `src/rendering/primitives/` 输出离屏 Canvas 的骨架。
   - `src/preview/video/`：
     - `simulationRenderer.ts`：定义接收当前播放时钟毫秒、输出当前帧画面至 Canvas 的驱动契约。
     - `recorder.ts`：媒体录制器（MediaRecorder / Canvas stream）抽象接口。
3. **架构文档落地**：
   - 在 `docs/adr/` 中落成《谱面静态导出与视频预览扩展架构约定》。

## 锁测要求

- 新增骨架与接口通过 TypeScript 类型检查（`npm run typecheck`）。
- 既有单元测试与上传清洗测试 `tests/unit/upload/bestdori/sanitizeChart.test.ts` 保持通过。

## Comments
