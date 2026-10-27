# 53 · 动态预览导出：开场人潮 SE 的 stop 早于 start，导出必失败

Type: bug
Status: resolved（2026-10-27 实现；**待用户验收**）
Blocked by: —

## 来源与症状

用户 2026-10-27 报：动态预览「导出视频」每次都失败（点几次都一样），
`InvalidStateError: Failed to execute 'stop' on 'AudioScheduledSourceNode': cannot call stop without calling start first`
（栈 `scheduleSfx` → `renderAudioTrack` → `runVideoExport` → `useVideoExport.start`），卡在进度卡 `audio`（渲染离线音轨）阶段。用户怀疑与上次导出中途切走有关。

## 根因

- `src/preview/video/encode/renderAudioTrack.ts:126-135`：截断分支先 `src.stop(endAt)`（:131），`src.start(cue.at)` 在 :135；Web Audio 规定 `stop()` 必须在 `start()` 之后，否则抛 `InvalidStateError`。
- 触发确定：开场默认开（`AppSettings.ts:288`）⇒ `openingSfxCues(6.75)` 给 `{ at: 0, endAt: 6.75 }`；素材 `SE_RHYTHM_GAYA.mp3` 实测 7.105 s > 6.75 s ⇒ 每次必进分支（结尾两条 cue 无 `endAt`，不触发）。旁证：关掉「开场」或素材缺失（`loadSfx` → null）可绕过。
- 引入于 `4db5600`（票 52/31 两端音效）。**与上次中断无关**：每次导出新建 `OfflineAudioContext`（:153），跨导出只共享解码缓存（`sfxBank` / `keySoundBank`），不存调度；`loadSfx` 失败被 `.catch(() => null)` 吞掉（:89），最坏是静音降级。

## 修法

- `scheduleSfx` 顺序改为 connect → `start(cue.at)` → `stop(endAt)`；包络 / 淡出时间不动。
- 顺带：音轨渲染在 `runVideoExport` 的 try 之外（`exportVideo.ts:321`，try 自 :349 起），异常会绕过域层错误口径——纳入 try 或局部 catch。票 31 / 52 不回改。

## 锁测

- 新增 `tests/unit/preview/video/RenderAudioTrackSfx.test.ts`：stub `OfflineAudioContext`（node / jsdom 无 Web Audio），记录 source 的 `start` / `stop` 调用序，断言 start 早于 stop；用 `openingSfxCues(6.75)` + 7.105 s 假 buffer 锁截断分支。现有 `Sfx.test.ts` 只锁 cue 组装、不覆盖调度顺序（漏网原因）。
- 手工验收：开场 + 结尾都开导一次，开场人潮收在 BGM 起点、结尾两声同起。

## Comments

- 2026-10-27 用户报障（附完整日志与栈），要求先分析不改代码；本轮定位完成，方案确认后开票。
- 结论：非「上次导出中断」残留 —— 新增两端音效代码的确定性顺序缺陷，凡开场打开且人潮素材存在即必现。

### 实现记录（2026-10-27）

- `src/preview/video/encode/renderAudioTrack.ts`：`scheduleSfx` 改为 connect → `start(cue.at)` → 截断分支 `stop(endAt)`；淡入 / 淡出 / 峰值时间一律未动。
- `src/preview/video/encode/exportVideo.ts`：`renderAudioTrack` 包进局部 try/catch（`logger.error('[preview]', '导出音轨失败', err)` → `failure: 'unknown'` + 当前容器），异常不再越过域层冒到 `useVideoExport` 的通用 catch。
- 锁测：新增 `tests/unit/preview/video/RenderAudioTrackSfx.test.ts` 3 例（开场截断的 start→stop 顺序 + 淡出终点、结尾无 endAt 只 start、开场+结尾真实三 cue 表逐 source 独立）；`tests/static/VideoExportWiring.test.ts` 追加 1 例锁「音轨渲染在 try 内且 catch 回统一失败档」。
- 证据：先红（stub 复刻浏览器 `InvalidStateError`，落点 `renderAudioTrack.ts:131`，与用户栈一致）→ 修后绿；`npm test` 340 文件 / 3792 例全绿；改动文件 eslint 干净；`tsc -p tsconfig.test.json` 无本票文件错误（仓库既有 77 条测试类型错误与本票无关）。
- 评审：Standards / Spec 两轴已跑；包络未锁、单 source 断言过宽、静态锁依赖字符距离三项已按票内范围收紧，其余（`sfxBank` 与实时口径的重复、CONTEXT 词条/数值失同步）属票 52 既有问题，不在本票范围。
- 手工验收（待用户）：开场 + 结尾都开，导一次拿到成片；开场人潮收在 BGM 起点、结尾两声同起。
