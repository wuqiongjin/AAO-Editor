# 210 · macOS能耗异常与音频硬件及应用壳保活优化

Type: bug
Status: resolved

## 来源

用户在 macOS（macOS 26 / Apple Silicon M4 / 16GB）环境反馈：
mac 端能耗极高，尚未开始导入谱面或播放，机器已异常发烫。活动监视器显示对能耗影响高达 4,135.9，系统标记「防止睡眠: 是」、「App小憩: 否」。

## 症状与根因

1. **音频保活死循环阻止系统休眠并打穿 App Nap（主因）**：
   - **症状**：用户任意点击或按键后，系统即常驻「防止睡眠: 是」，能耗迅速飙升至数千，即使静置不动也持续发烫。
   - **根因**：
     - 在 [AudioEngine.ts](file:///d:/Company/WorkSpace/MocaCoffee/bangdream-editor/src/audio/AudioEngine.ts#L363-L373) 中，`onUserGesture` 与 `primeAudioGraph` 为防止移动端/声卡休眠，启动了一个死循环余弦波（`src.loop = true`）并连接至 `ctx.destination`。
     - 该 AudioNode **永久未 stop 或 disconnect**。在 macOS 底层，Chromium 检测到持续的音频硬件输出管道处于活动态，向 CoreAudio 和 IOKit 发送断言，创建 `PreventUserIdleSystemSleep` 电源锁，并完全禁用了 macOS 的 App Nap（小憩机制），使得音频线程和 CoreAudio 驱动保持最高采样率轮询。
2. **后台保活页面未脱离渲染树导致 GPU 合成开销（次因）**：
   - **症状**：在非工作台页面（如工程页、设置页），GPU 仍有较高开销。
   - **根因**：
     - 在 [AppShell.css](file:///d:/Company/WorkSpace/MocaCoffee/bangdream-editor/src/layouts/AppShell.css#L10) 中，非激活页面仅使用 `opacity: 0; pointer-events: none;` 隐藏，缺少 `visibility: hidden` 或 `content-visibility: hidden`。
     - 复杂的 Retina 画布（数百万物理像素）仍常驻在浏览器 Compositor 图层树中，参与合成与显存占用。

## 修法

1. **改造静音保活机制（按需短脉冲唤醒 / 无音频态及时挂起）**：
   - 保留手势解锁与短静音缓冲，但将永久死循环节点（`src.loop = true`）改为单次微秒级短脉冲（如 10ms 静音），或在连续空闲静置（如 30 秒无音效播放）后优雅调用 `ctx.suspend()`；
   - 在用户重新触发播放、打击音或按键交互时，无缝 `ctx.resume()`。
   - 彻底释放 macOS `PreventUserIdleSystemSleep` 锁，恢复 App Nap 机制。
2. **非激活页面脱离 Compositor 合成树**：
   - 修改 [AppShell.css](file:///d:/Company/WorkSpace/MocaCoffee/bangdream-editor/src/layouts/AppShell.css)，当页面为非激活态时追加 `visibility: hidden`；
   - 确保 DOM 实例与内部状态保活（ADR-0007），同时彻底停止后台图层的无谓 GPU 合成。

## 锁测与不变量保护

1. **既有功能不变量**：
   - 保留 Windows WASAPI 声卡唤醒能力，保证首音符播放与打键音无首音吞音（防回归 Issue 179 / 188）；
   - 保留 7 页面单例挂载与草稿/滚动位置无缝恢复。
2. **锁测**：
   - `tests/unit/AudioEngine.idle.test.ts`：验证空闲时音频上下文不泄漏常驻 loop 节点，支持按需唤醒；
   - `tests/static/AppShellVisibility.test.ts`：验证非激活页面样式规则具备 `visibility: hidden`。
