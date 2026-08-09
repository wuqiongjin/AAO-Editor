Type: task
Status: resolved
Blocked by:

## Question

ADR-0004 §7 定案"素材包 KeySoundSet（tap/flick/skill/slide 四类）+ 占位振荡器实现 + 切换持久化"。当前实现**用振荡器占位发声**（有声音），需替换为**真实 WAV 采样**：从文件加载真实音源，并按"音符 → 击打样式 → 采样"的匹配链路播放。

用户提出：此涉及**音符与音效的匹配**，需单独成 ticket 跟踪。

## 现状证据（2026-08-09 调查）

- 占位振荡器：[KeySound.ts](./src/utils/KeySound.ts) `KeySoundSample = { frequency, oscillatorType }`，`PLACEHOLDER` 四类全为振荡器；`KEY_SOUND_SETS` 注册表仅含占位包。
- 播放链路：[AudioEngine.ts](./src/utils/AudioEngine.ts) `playTick(kind)` 用 `sample.frequency`/`sample.oscillatorType` 新建 oscillator；`setKeySet` 切换素材包。
- 音符→样式匹配：[AudioTiming.ts](./src/utils/AudioTiming.ts) `buildKeyEvents` 已把音符映射为 `kind: 'tap'|'flick'|'skill'|'slide'`（普通 tap / flick+skill 优先 / 方向 flick / 滑条结点 slide）。
- 资源路径规范：[ELECTRON_RESOURCE_PATHS.md](./plans/ELECTRON_RESOURCE_PATHS.md) —— 静态资源放 `public/assets/`，vite `base:'./'` 相对路径，web/Electron 双环境可用。音频建议放 `public/assets/audio/`。
- 桌面端文件读入：ADR-0004 §7 注明"文件读入依赖 ticket 04 文件 IPC"（尚未实现）——但 **public 打包资源**不依赖 IPC，可直接 fetch/decode。

## 实现范围

- [ ] 素材接口扩展：`KeySoundSample` 增加 `src?: string`（采样文件 URL/相对路径），有 `src` 走真实采样、无 `src` 回退振荡器（兼容占位）。
- [ ] 真实采样播放：AudioEngine 增加 decodeAudioData 缓存（URL/路径 → AudioBuffer），`playTick` 有采样时用 AudioBufferSourceNode、无则振荡器兜底。
- [ ] 打包资源：真实 WAV 文件放 `public/assets/audio/`（web/Electron 皆可按相对路径加载），新增素材包注册。
- [ ] 音符→音效匹配核对：确认 `buildKeyEvents` 的 kind 分派与采样一一对应（tap/flick/skill/slide）。
- [ ] （可选，待定）用户自定义音效文件读入：依赖 ticket 04 文件 IP、或 `<input type=file>` 解码，另行评估。

## 备注

- 需用户提供真实 WAV 采样文件；或先生成占位 WAV 验证加载链路。
- 匹配边界（kind 归属）以 ADR-0004 §7 与 `buildKeyEvents` 现状为准，如需调整需先更新 ADR/CONTEXT。

## Answer（结论）

已实现（tsc -b / vite build 全绿，101 单测通过）。用户提供的真实音效映射如下：

- **真实采样**：`public/assets/audio/`（相对路径，web/Electron 双环境可用，Electron 资源路径规范见 `docs/plans/ELECTRON_RESOURCE_PATHS.md`）。
- **音符→音效匹配**（`AudioTiming.buildKeyEvents`）：
  - 方向键（LDirectional/RDirectional）→ 键种 `directional`，按组合长度 `length` 分档（`tier`）：1→`directional_fl.mp3`、2→`directional_fl_2.mp3`、3→`directional_fl_3.mp3`；
  - 滑键（flick）→ `flick.mp3`；
  - 技能键（skill）→ `SE_RHYTHM_TAP_SKILL.mp3`；
  - tap + 滑条结点（slide）→ `perfect.mp3`。
- **键种扩展**：`KeySoundKind` 由 `{tap,flick,skill,slide}` 扩为 `{tap,flick,skill,slide,directional}`；`KeySoundSample` 增加 `src`（真实文件）与 `tierSrcs`（方向键分档），欠文件时振荡器兜底。
- **播放链路**：`AudioEngine` 增 `fetch+decodeAudioData` 采样缓存/并发去重/`setKeySet` 预加载；`playTick` 有采样走 `AudioBufferSourceNode`、否则振荡器兜底；`tick()` 透传 `tier`。
- **默认素材**：默认激活"Bang Dream（官方）"真实包（持久化进 `bangdream.settings.v1`），"占位"包仍可切换回。ADR-0004 §7 已同步修订。
- **issue 20 修订【内联化，2026-08-09】**：音频文件从 `public/assets/audio/` 移至 `src/assets/audio/`，改由 Vite `?inline` 内联为 base64 data-URI（`src/assets/audio/xxx.mp3?inline`），**不产生任何 `.mp3` 网络请求**。规避浏览器下载插件（如 IDM）劫持运行时 `fetch()` 导致的"音符无声 + 频弹下载"（详见 issue 20）。

> 备注：技能键文件名为 `SE_RHYTHM_TAP_SKILL.mp3`（原 ticket 描述为 WAV，实际提供的为 MP3）；滑键用户最初给的路径是 `.ts` 源码，经确认实际音频为 `flick.mp3`。

## Comments

- 2026-08-09：用户明确方向键 3 档按组合长度 `length` 分档；滑键用 `flick.mp3`；tap+slide 均用 `perfect.mp3`。