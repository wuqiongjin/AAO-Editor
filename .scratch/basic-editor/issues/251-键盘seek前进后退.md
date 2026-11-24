# 251 · 键盘 seek 前进 / 后退

Type: grilling
Status: claimed（2026-11-24 定案；原 tmp.diff 编号 235，与已落地的曲线模板 235 撞号，本仓顺延为 251）
Blocked by: —

## 来源

用户 2026-11-24：动态预览进页后指针还在页头顶，播放条在舞台底，每次纵穿一屏才能摸到条。起初想要 ← → 调进度、自定义步长，或滚轮 / 可调播放条位置。经 `/grill-with-docs` 多轮后收口为：**不用鼠标也能在播放时钟上前进 / 后退**。本票记录全部定案与实现落点。

痛点发生在动态预览，解在快捷键系统（工作台一并接上）。播放条交互前史见 [chart-preview/22](../../chart-preview/issues/22-动态预览播放条与工作台播放器的关系.md)；倍速 / 音量四键与预览 `PLAY_ONLY` 见 [230](./230-倍速与音量快捷键.md)；快捷键行齿轮先例见 [216](./216-节拍吸附快捷键切换与常用档位循环.md)。

## 根因与背景（现状事实）

- 动态预览播放 / 暂停（空格）、倍速（`,` `.`）、音量（`;` `'`）已是页面级，本来不用摸播放条（票 22 / 230）。播放条上**还没有键**的只有拖进度。
- 进度条是 `role="slider"` 的 div，无键盘处理；时间码可双击跳秒。工作台暂停时滚动画布 = seek；动态预览没有这条路。
- ADR-0002 §2.3：**seek 不纳入快捷键系统、不配键**。issue 230 写明 `,` / `.` 已给倍速，「将来若做逐帧 / 逐拍 seek 须另选键」。
- 预览页 `PLAY_ONLY` = `play` + `PLAYBACK_SHORTCUT_IDS`（四键）；其余绑定放行原生。`noRepeat` 只过滤这四键的 `e.repeat`。`useShortcutDispatch` 只有 `keydown`，没有按住节拍器。
- 方向键未绑定任何 `FunctionId`。工程启动台网格用方向键导航，与播放页分发不重叠。时间码 / 倍速自定义输入在焦点内由 `isEditableTarget` 放行。
- 设置页已无独立「播放」分区；`settings.playbar` 只有工作台标记点按钮显隐。

## 定案（用户 2026-11-24 逐轮拍板，frontier 为空）

### 1. 做 / 不做

- **做**：键盘 seek 两个具体功能，出厂 ← / →；工作台与动态预览都能用。
- **不做**：滚轮 seek（条上滚轮不省路程；场上滚轮与静态预览横滚 / Ctrl 缩放抢语义）；挪播放条 / 可调位置（条贴舞台底是定案，全屏仍浮底缘；HUD 在顶、场地判定线在底；票 19/26 已把底栏挤到 32px）；设置页 / 工作台显示面板 / 预览设置面板 / 播放条上的步长控件；自定义连发频率；按 beat / 节拍吸附步进；系统 `e.repeat` 连发。

### 2. 两个功能与默认键

| FunctionId | 默认键 | 动作 |
| --- | --- | --- |
| `seekBack` | `arrowleft`（←） | 播放时钟减去**后退步长** |
| `seekForward` | `arrowright`（→） | 播放时钟加上**前进步长** |

- `category: 'play'`、`scope: 'canvas'`。走快捷键表：可改键、可屏蔽、一键不多功能；升级时新增键撞用户既有绑定则新功能退让为 `null`（issue 230 载入去重，不 bump schema）。
- 不写死在播放条 DOM 上。动态预览 `PLAY_ONLY` / `runFunction` 追加这两个 id（按了没反应会被当成坏掉，与 230 同一口径）。工作台一并接：播放中画布滚动是锁的，键盘 seek 同样有用。
- 这会**修订 ADR-0002「seek 不配键」**。`,` / `.` 仍给倍速，本票用方向键，不改 230 的四键。

### 3. seek 合同

- 只动**播放时钟**的秒，不按 beat、不跟节拍吸附。
- 播放中按 = 从新位置续播；暂停中按 = 停在新位置；不自动开播。钳在 `[0, 谱面长度]`，端点停住。与现有拖条 / `onSeek` 同一合同。
- 焦点在时间码等输入框内：方向键走原生（挪光标），不 seek。

### 4. 连发（自管节拍）

- 第一次 keydown **立刻**跳一步。
- 按住约 **400ms** 之后每 **250ms** 再跳一步（4 次/秒）。
- 松手、窗口失焦、焦点进可编辑控件、**本页 `active` 变 false（切页）**立刻停。
- **连发频率不是设置项**。走多快走两边的 seek 步长调节。步长 10 秒时按住大约每秒推进 40 秒谱面，用户已接受、不另加按住限速。
- **必须同时做到两件事**（2026-11-24 自检补写，不是新的产品选择）：
  1. **丢掉系统 `e.repeat`**：OS 连发大约 30Hz。现有 `useShortcutDispatch` 对未列入 `noRepeat` 的功能会把每一次 `e.repeat` 的 keydown 都派发出去。若自管节拍还叠在上面，就是 30Hz + 4Hz 双发。
  2. **不要复用 230 的 `noRepeat` 名单**：那个名单的语义是「按住完全不连发」（倍速 / 音量）。seek 要自管连发，不能进 `PLAYBACK_SHORTCUT_IDS`。实现上是另一条路径：seek 的 keydown 若 `e.repeat` 则直接 return；真正的连发只来自 keyup 停、自己的 400ms / 250ms 计时器。

### 5. 后退步长 / 前进步长

- 两套独立秒数：**后退步长** / **前进步长**。出厂都是 **1 秒**；允许调散。调散之后，同样次数的前进再后退不必回到原点（用户接受此代价）。不做「锁定成相同」开关。
- 范围 **0.1–10** 秒，0.1 一档。再小接近逐帧（另开票）；再大叠加连发会把谱飞掉，10 秒封顶用户已接受。
- 按住时哪个键用哪边的步长。
- **入口**：快捷键页 `seekBack` / `seekForward` 两行功能名旁各一枚齿轮（照 216 `beatSnapCycle`）。点哪一枚都打开**同一弹窗、两格数字**。不进设置页、不进显示面板、不进播放条。
- 弹窗**只配步长**，不配连发 400ms / 250ms。弹窗内「恢复默认」两格都回 1 秒。
- **存储**：设置对象上独立字段（additive、不 bump schema），与 `settings.shortcuts` 解耦；快捷键页「恢复默认」只重置键位，**不清步长**。缺字段 / 脏值回落 1。导入导出带走。
- **不**写入 `settings.playbar`（那是工作台标记点按钮 chrome）。

### 6. 文档

- ADR-0002 三处都要改，只改 §2.3 会自相矛盾：
  - **§2.3**「全选、缩放、seek 不配键」→ seek 两条进系统；缩放 / 全选仍不配键。
  - **§2.2 选键原则**（issue 230 那段）「缩放 / seek 的既有排除口径不变」→ seek 除外，并写明本票是**按秒步进**，不是逐帧 / 逐拍；`,` / `.` 仍给倍速。
  - **§6 预览页例外** + 头部 230 修订：`PLAY_ONLY` 从「play + 四键」扩成再加 `seekBack` / `seekForward`。
- CONTEXT.md：补 **后退步长** / **前进步长**（一次键盘 seek 推进的播放时钟秒数；两套独立、默认相同）。
- `docs-site/guide/features.md` 与 `README.md` 播放控制键表补 ← / →。
- i18n：两个功能名 + 齿轮 aria + 弹窗文案（zh-CN / en）。

## 实现落点

> 下列落点是实现接线，不是第二份产品定案。标「本轮实现口径」的细节实现时选定、锁测钉住，不冒充用户逐项拍过。

- `src/settings/ShortcutConfig.ts`：`FunctionId` + `FUNCTIONS` 登记 `seekBack` / `seekForward`（`category: 'play'`，默认 `arrowleft` / `arrowright`）。`formatKey` 把 `arrowleft` / `arrowright` 显示成 ← / → 或 Left / Right（本轮实现口径：勿渲染成 `ARROWLEFT`）。
- `src/settings/AppSettings.ts` + `ConfigProvider`：additive 字段（建议名 `seekStepBackSeconds` / `seekStepForwardSeconds`，本轮实现口径）+ 归一化 0.1–10、一位小数、缺/脏 → 1；`setSeekStep*` 或一次写两格。
- `src/settings/useShortcutDispatch.ts`：为 seek 两 id 接 **首次 keydown 立刻派发 + 自管 400ms / 250ms 节拍器**；`e.repeat === true` 的 keydown **不派发、不重开计时器**。keyup / blur / `active === false` 停节拍器。两键同时按住：后按下的方向覆盖前一个（本轮实现口径）。
- `src/playback/playbackShortcuts.ts`：seek 步进函数（读两边步长、`current ± step`、clamp `[0, duration]`）。**`PLAYBACK_SHORTCUT_IDS` 现在身兼两职**（预览 `PLAY_ONLY` 的追加项 + `noRepeat` 名单）。seek 只进 `PLAY_ONLY`，**不许**塞进这个常量，否则按住会变成 230 那种完全不连发。实现时另列 `SEEK_SHORTCUT_IDS`（或等价），`PLAY_ONLY = ['play', ...PLAYBACK_SHORTCUT_IDS, ...SEEK_SHORTCUT_IDS]`，`noRepeat` 仍只有四键。
- `src/pages/workspace/WorkspacePage.tsx` / `src/pages/preview/PreviewVideoStage.tsx`：`runFunction` 接 `seekBack` / `seekForward` → 现有 `seek` / `seekTo`。静态形态不挂 `PreviewVideoStage`，方向键不 seek（本轮实现口径：不给静态预览另绑方向键）。
- `src/pages/settings/ShortcutsPage.tsx`：两行齿轮，开同一弹窗（可复用 216 的齿轮按钮 class；弹窗新组件，走全站 `Dialog` 壳）。
- 不改 `PlayBar` 进度条指针交互；不改静态预览滚轮。

## 锁测

1. **unit（`tests/unit/settings/ShortcutConfig.test.ts` + 新 AppSettings 用例，照 `PlaybarSettings.test.ts` / `ShortcutBeatSnapConfig.test.ts`）**：出厂默认含 `arrowleft` / `arrowright` 且 `getDefaultConfig()` 零冲突；载入去重「老功能保键、新功能退让」；步长归一化（缺 / 非数 / `0` / 负数 → 1，`10.04` → 10，`0.09` → 0.1，再量化到 0.1）；步进 clamp 两端；`restoreDefaultsInFilter` / 快捷键重置不清步长。
2. **unit（连发节拍器，新文件，假时钟）**：第一次 keydown 立刻派发；随后带 `e.repeat` 的 keydown **0 次**派发；400ms 后按 250ms 间隔由计时器派发；keyup / blur / `active: false` 停止。不依赖真实键盘。
3. **DOM（`tests/dom` 快捷键页，照节拍吸附齿轮）**：播放桶两行有齿轮；点任一枚弹出两格（后退 / 前进）；改一格另一格不变；弹窗内恢复默认两格回 1。
4. **DOM（`tests/dom/preview/PreviewVideoControls.test.tsx` + 工作台播放分发）**：页面 `active` 时 ← / → 调 `seek`；焦点在时间码 input 内不 seek；预览失活不接管。静态源码断言：`PLAY_ONLY` 含两 id；`PLAYBACK_SHORTCUT_IDS` 与 `noRepeat` **不含**它们。
5. **单测覆盖不到**：`formatKey` 方向键展示串（勿变成 `ARROWLEFT`）、按住肉眼手感、工作台播放中 vs 暂停、动态预览全屏台上态、静态形态方向键不 seek —— **手工验收清单**（不引入 e2e）。

## Comments

- 2026-11-24 grill：先否「暂停微调 / 自定义步长绑死方向键」误诊；用户改口为进页摸条路程 → 再收成「不用鼠标前进后退」。否决滚轮与可调播放条位置。Q1 功能 + 两页都能用、Q3 播放时钟合同拍板。Q2 从「固定 1 秒不连发」改成连发 + 可调步长；入口从显示面板改到快捷键齿轮；两套步长默认相同允许调散；范围 0.1–5 再改为 0.1–10。整包确认 Q1=OK Q2=OK，先开票跟踪。
- 2026-11-24 自检：产品定案无改。修正实现口径自相矛盾 —— 「不要进 `noRepeat`」且「不要用 `e.repeat`」在现有 dispatch 下会 30Hz 双发；补 ADR §2.2 / §6 漏改；点名 `PLAYBACK_SHORTCUT_IDS` 身兼两职；切页必须停节拍器。
- 2026-11-24 编号：tmp.diff 写 235，但本仓 235–250 已占用（235 为曲线模板选型），落地为 251。
