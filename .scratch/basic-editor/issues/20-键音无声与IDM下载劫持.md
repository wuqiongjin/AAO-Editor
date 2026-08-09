Type: bug
Status: resolved
Blocked by:

## Question

issue 18 实现后，用户播放谱面时**音符没有播放音效**，且 **IDM 下载器被频发触发下载请求**，形如 `http://127.0.0.1:5173/assets/audio/perfect.mp3`。

## 根因（2026-08-09 定位）

- issue 18 把真实音效放 `public/assets/audio/`，`AudioEngine` 在 `setKeySet` 预加载时用 `fetch('./assets/audio/xxx.mp3')` 请求。
- **浏览器下载插件（如 IDM）会劫持对 `.mp3`/`.wav` 等媒体 URL 的 `fetch()`/请求**，导致：1) 请求被插件接管、`fetch` 拿不到 ArrayBuffer（音频解码失败 → 无声）；2) 插件反复弹下载窗口。
- 在无该插件的干净浏览器实测：6 个 MP3 均 `fetch` 成功（200）、解码正常、无任何错误 → **证明代码本身正确，问题由插件劫持运行时媒体请求造成**。

## 修复（issue 20，2026-08-09）

**将音频内联为 base64 data-URI，彻底消除 `.mp3` 网络请求**：

1. 音频文件从 `public/assets/audio/` 移至 `src/assets/audio/`（不进 public）。
2. `KeySound.ts` 用 Vite `?inline` 导入：`import perfectMp3 from '../assets/audio/perfect.mp3?inline'` → 编译期内联为 `data:audio/mpeg;base64,...`。
3. `KeySoundSample.src/tierSrcs` 直接填该 data-URI；`AudioEngine` 的 `fetch(src)` 对 `data:` 同样走 `decodeAudioData`，逻辑不变。

**效果**：运行时**零媒体网络请求**，下载插件无从劫持 → 音效可靠发声、不再弹下载。web/Electron 构建后音频已并入 JS bundle（`dist/assets/*.js` 增大，构建日志可见内联）。

## 验证

- `npx tsc -b`、`npx vite build` 全绿；101 单测通过。
- 干净浏览器实测：进入编辑器，网络面板**无任何 `.mp3` 请求**（此前 6 条）；`fetch('./assets/audio/perfect.mp3')` 返回 404（因不再存在于 public，属预期）。

## Answer（结论）

已修复。音频改为 Vite `?inline` 内联 data-URI，消除全部媒体网络请求，规避下载插件劫持；音效在干净浏览器验证可加载（`decodeAudioData` 成功）。ADR-0004 §7、issue 18、map.md 已同步。

## Comments

- 2026-08-09：IDM 等下载插件会劫持 `.mp3` 的运行时 fetch，是本问题与 issue 18 无声现象的共同根因；内联化是既规避插件又保证 web/Electron 可靠的最小方案。
