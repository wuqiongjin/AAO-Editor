# 64 · 视频导出立刻「导出失败」：chunk.duration 非法

Type: bug
Status: resolved 实现（2026-11-12 已实现；Edge 真机验收待做）
Blocked by: none

## 来源与症状
2026-11-11 用户报「网页端动态预览点导出，马上弹导出失败、无报错」；17:51:47Z 现场 console 抓到 `ERROR [preview] 导出视频失败` + `TypeError: addVideoChunkRaw's fourth argument (duration) must be a non-negative real number.`（Edge / mp4-muxer 路径）。

## 根因（实测确认）
`frameDriver.ts` 的 `VideoFrame` 与 `muxer.ts` 的 `AudioData` 只给 timestamp、不给 duration；`EncodedVideoChunk.duration` 可选，Edge 输出非有限数 ⇒ `mp4-muxer@5.2.2` 的 `addVideoChunkRaw` / `addAudioChunkRaw` 断言有限非负数，第一个输出 chunk 就抛 → `fail()` → 下一帧 `addFrame` 抛 → `exportVideo.ts` 兜底 catch 只给通用「导出失败」，逐帧尚未开始。
`webm-muxer` 不读 duration ⇒ 只有 MP4 中招，`auto` 按 AAC / codec 探测选容器 ⇒「经常」；本仓 Chromium 153 省略 duration 时给 `0`（不崩但全帧零时长，与 [63](./63-MP4导出在部分播放器与剪辑软件卡顿或无法加载.md) 的播放异常同源），带上给 16667。

## 实现（2026-11-12）
`exportSpec.frameDurationUs(fps)` 作唯一口径、`VideoFrame` 带 duration；`muxer.withValidDuration()` 在视频 / 音频 output 用 Proxy 把非有限或 ≤0 的 duration 兜成帧间隔 / 音频块长（保住 `instanceof` 与 `copyTo`，合法值原样透传）；`fail(e)` **仅首次失败**当刻 `logger.error`，带容器、codec、message、stack。`AudioDataInit` 无 duration 字段，音频只靠 output 兜住。
**未做（另轮）**：UI 文案分档（新增 `failure` 档 + 两份 i18n + `noticeFor` + DOM 测试），修复后该异常不再发生，不冒充本轮已做。

## 锁测与验证
`tests/unit/preview/video/ChunkDuration.test.ts`（7 条）：四种非法值走真 `mp4-muxer`，断言 `finish()` 产出真 MP4 且 `stts` delta > 0 —— undefined / null / NaN 修前抛现场异常，`0` 修前写出全帧零时长（靠 delta > 0 判红）；另锁合法值原样、Proxy 的 `instanceof` / `copyTo`、WebM 共用 sink 不抛、`readStripped` 源码断言锁两处接线。单测到不了 Edge 真编码器 ⇒ 本地一次性探针 `/tmp/verify-export-chunk-duration.mjs`（**不入库**）：修前 `RED` / exit 1，修后 `GREEN`（bytes=627）/ exit 0；`npm test` 419 文件 / 4620 例绿、`npx tsc -b` 干净、改动文件 eslint 干净，`npm run test:types` 的存量错见 `ci-gate.sh:7-8`（不进门禁）。

## 待用户真机验收
Edge 按原步骤导一条非静音、带 BGM 的真视频（不立刻失败、能播放），同一条在票 63 报障播放器 / 剪辑软件复验；可选回填 `chunk.duration` 实际值、容器与静音开关、Edge 版本。现场取值脚本见本地探针②环境层。

## Comments
- 2026-11-12 根因闭环：与 [33](./33-导出背压在慢编码器上失效.md) 不同，本票有现场 console 原文，且用产品 `createVideoSink` + 真 `EncodedVideoChunk` 在 Chromium 复现同一异常。第一版重建 chunk 让 `MuxerBackpressure.test.ts` 5 条红（`chunk.copyTo is not a function`）⇒ 改 Proxy；评审后补 stack、WebM 用例、`readStripped`、`stts` count 上界校验与票面措辞。
