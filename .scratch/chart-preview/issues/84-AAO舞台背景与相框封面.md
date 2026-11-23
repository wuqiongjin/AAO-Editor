# 84 · AAO 舞台背景与相框封面

Type: grilling
Status: resolved（用户 2026-11-23 逐问拍板 Q1–Q10；**同日实现完成**，见文末「实现记录」）
Blocked by: none

## 来源与诉求

2026-11-23 用户提需求（附 `aao-bg.webp` / `aao-bg.png` 原图）：

> 「动态预览，我想要支持让 aao-bg.webp 接入默认背景图。然后这个图片中间的相框部分，我想让其能填充当前谱面的封面图。」

## 现状（事实）与根因

- `aao-bg.webp`（2048×1024）与 `public/assets/preview/aao-stage-frame-bg.webp` **md5 相同**（`44b1797…`），全仓**零引用**；根目录另有 `aao-bg.png`（2752×1536，比例 1.79，与 webp 的 2.0 不是同一张图的重采样版）。
- 背景层 = `simField.drawSimBackground` + `simGeometry.backgroundRect`：`BACKGROUND_RATIO = 1.32W × 1.0065W`、上缘锚 `0.3775`，**源图被硬拉伸进该矩形**（`liveBG` 2048×1024 → 纵向 ×1.525，Bestdori 的舞台幕布口径）。
- 背景来源只有取件侧 `bgskin` 包（清单 `gen/simAssetPacks.gen.ts`，默认 `skin00`），**没有"应用自带包"这个概念**；`normalizeSimAssetPackId` 的回落目标就是 `SIM_DEFAULT_PACK_IDS.background`。
- **没有相框 / 画框常量**。webp 像素实测相框内屏 = `x 856..1190 / y 190..525`（334×335 正方形；外侧装饰带另有 `x 837 / 1210` 的亮边与一道暗缝，别把装饰带当成屏幕）。
- 场地图 `bg_line_rhythm.png`：**48.5% 全透明、其余 α≈0.38**，覆盖 `x 83..1250 / y 10..615` —— 相框区整片被这层半透"玻璃地板"压住。
- 封面是**工程级** `ChartProject.coverBlob`（`coverName` + `cover.bin` / IDB 内联）；`ProjectChart` 没有封面字段，谱面代码 `chart.json` 也不含封面。
- `assets-sync.mjs` 对 `public/assets/sim` 是 **`rmSync` 整根替换**、`gen/simAssetPacks.gen.ts` 每次同步覆盖 ⇒ 自带包**不能**放进这两个地方。
- 亮度黑罩（`rgba(0,0,0,1−bgBrightness)`）目前叠在 `drawSimBackground` **内部**、背景图之后。

## 定案（用户 2026-11-23）

1. **身份（Q1）**：新增背景包 `aao-stage`（显示名「AAO 舞台」），**占背景网格第一格并作出厂默认**；`skin00`–`skin14` 与主题包照旧可选。**老设置不迁移** —— 已存 `skin00` 继续显示 Bestdori 包，"出厂默认"只作用于新装 / 从没选过的用户。
2. **接缝（Q8）**：应用自带包由应用侧常量表 `sim/appAssetPacks` **前置合并**进 `listSimBackgroundPacks()`，`findSimBackgroundPack` / `normalizeSimAssetPackId` / URL 解析一处改动全通；**不碰** `gen/` 与取件侧清单（快照只搬上游素材，且会被覆盖 / 删除）。
3. **取景（Q2 + Q9'=A）**：**独立常量**，不套 `backgroundRect` —— 宽 `1.32W`（沿用幕布宽）、高按图片 2:1 自然比例、**图顶贴设计面顶**（`y_top = 0`）。相框因此落在设计面 `x 523..810 / y 163..451`（287×288，正方形）。否决：竖直居中 / 图底贴底 / 放大到 1.62W 让相框居中（会裁天花与音箱、且破 1.32W）/ 沿用 1.525 倍拉伸（相框变 287×439 竖长条）。
4. **相框区**：源图实测 `x 0.4180..0.5811` / `y 0.1855..0.5127` 写成比例常量 + 锁测；封面按该矩形 **cover 铺满**（不额外做方形裁切）。
5. **相框内容（Q4）**：**正在预览的那份工程**的封面（预览页作用域工程，不是"当前工程"）；**无封面留空**（不画首字母占位，导出头带那套占位不搬进来）。
6. **图层位置（Q3'）**：背景图 → **相框封面** → 亮度黑罩 → 场地图 → 判定线 → 音符。相框是舞台后墙的屏，被半透场地图压暗、车道线压在其上；**不能**画在场地图之上（会盖住车道线，下落音符失去参照 —— 用户原话「音符下落时都看不见轨道了」）。
7. **生效范围（Q5）**：实时预览 + 视频导出 + 开场第③段（入场过渡里"只有表演背景"那 1.75s）；静态预览面板与谱面图**不画背景**（ADR-0018 §5 既有口径）。
8. **hover 大预览（Q10）**：预览页「设置」面板的 `SimPackPreview`（同一份 `drawFieldLayers`）也填作用域工程封面，否则网格里看到的是空相框。
9. **亮度（Q7=B）**：**照吃** `bgBrightness`（默认 0.7），不按包豁免 —— 全站一个旋钮，豁免会在"导出与预览一致"之外再开例外口子。封面随之一起被压暗。
10. **素材（Q6）**：正式件 = `public/assets/preview/aao-stage-frame-bg.webp`（59 KB，`public/assets/preview/` 不在 `assets-sync` 的替换根里，随 vite `public/` 进发行物）；根目录散图 `aao-bg.webp` / `aao-bg.png` **已按用户确认删除**（2026-11-23，两者均为 untracked）。

设计记录：[ADR-0018 §7](../../../docs/adr/0018-表演背景与场地皮肤包的选择模型.md)（2026-11-23 修订）+ `CONTEXT.md` 词条「AAO 舞台」「相框区」。

## 实现落点

- **新** `src/preview/video/sim/appAssetPacks.ts`：`AAO_STAGE_PACK_ID = 'aao-stage'`、`APP_BACKGROUND_PACKS`（id / 文件名 / i18n 显示名键）、`isAppBackgroundPack(id)`、`appBackgroundUrl()`。文件名按 `BASE_URL` 拼（同 `SIM_ASSET_BASE` 口径，Electron `file://` 必需）。
- `src/preview/video/sim/simAssetPacks.ts`：`listSimBackgroundPacks()` 前置合并自带包（展示序第一格）、`SIM_DEFAULT_PACK_IDS.background = AAO_STAGE_PACK_ID`；`simPackDisplayName` 对自带包走 i18n 键。
- `src/preview/video/sim/simAssets.ts`：`simAssetUrls()` 遇到自带包返回 `appBackgroundUrl()`（不走 `<server>/<packId>_rip/`）；`probeSimServers` 的兜底探测不要把自带包当"某个服缺件"。
- `src/preview/video/sim/simGeometry.ts`：`AAO_STAGE_BG = { wRatio: 1.32, aspect: 2, top: 0 }`、`aaoStageBackgroundRect(m)`、`AAO_FRAME_RATIO`、`aaoFrameRect(m)`。
- `src/preview/video/sim/simField.ts`：**落笔点 = `drawSimBackground` 内部**（背景图之后、亮度黑罩之前），函数签名加一个可选 `cover` 参（`CanvasImageSource | null`），`drawFieldLayers` 只透传。为什么不是 `drawFieldLayers`：开场第③段**不走**它，而是直接调 `drawSimBackground`（`src/preview/video/opening/openingFrame.ts:368`）—— 落在 `drawSimBackground` 才能让实时 / 导出 / ③段三处一次对齐。"是不是 AAO 舞台"由上游解析后决定传不传 cover，绘制函数不认包 ID。
- `src/preview/video/sim/simPlayback.ts:143-147`：`fieldBitmap` 的重绘判据现在只比 `frame` / `scene.bgBrightness` / `density`，**要加封面版本**，否则换工程 / 换封面后仍显示旧相框内容。
- 页面：`src/pages/preview/PreviewPage.tsx`（作用域工程 `coverBlob` → `loadCoverImage`）、`PreviewVideoStage.tsx`（收封面图 props，传给 `drawSimFrameAt` 的 layers）、`PreviewDisplayPanel.tsx`（`SimPackPreview` 收封面）。
- 导出：`src/preview/video/encode/exportVideo.ts` 与 `src/preview/video/sim/prepareSimRendering.ts` —— 导出前 await 封面 `ImageBitmap`（复用 `src/preview/static/sheetHeader.ts:532` `loadCoverImage`，同开场片头口径）。
- i18n：`src/i18n/messages/zh-CN.json` / `en.json` 加 `preview.display.bgName.aao-stage`（AAO 舞台 / AAO Stage；键按包 ID 拼，与 `pickBackgroundSkinName` 的 `${id}` 口径一致）。
- 素材：`public/assets/preview/aao-stage-frame-bg.webp` 保留入库；根目录散图已删除，无需再处理。

## 锁测

- `tests/unit/preview/video/SimAssetPacks.test.ts`：`listSimBackgroundPacks()` 第一格是 `aao-stage`、`findSimBackgroundPack('aao-stage')` 命中、清单为空时 `normalizeSimAssetPackId('background', …)` 仍命中自带包（空快照不再退化成 404）、`simPackDisplayName` 对自带包走 i18n 键、`SIM_DEFAULT_PACK_IDS.background === 'aao-stage'`。
- `tests/unit/preview/video/SimAssets.test.ts`：自带包 URL 拼装（`BASE_URL + assets/preview/…`，不带 server / `_rip`），且 `probeSimServers` 不会把自带包当"某服缺件"。
- `tests/unit/preview/video/SimGeometry.test.ts`：`aaoStageBackgroundRect` 宽 = `1.32W`、高 = 宽/2、`y = 0`；`aaoFrameRect` 四个比例常量与设计面下的 287×288 落位。
- `tests/unit/preview/video/SimField.test.ts`：给了 cover 就画、没给不画；cover 的 `drawImage` 调用落在背景图**之后**、黑罩**之前**（用调用序断言，照既有 `SimField` 惯例）。
- `tests/unit/settings/*`：`DEFAULT_PREVIEW_SETTINGS.bgPackId === 'aao-stage'`；老设置存 `skin00` 读盘后仍是 `skin00`（不迁移）。
- `tests/unit/preview/static/exportPanels.test.ts`：`DEFAULT_PREVIEW_SETTINGS` 改默认后不引入形状回归（宽图不画背景）。
- **像素 / 人工验收**（单测覆盖不到 Canvas 合成顺序）：`node scripts/sim-shot.mjs` 抓一帧，确认相框封面**在**车道线之下、**被**场地图压暗；再导一条 1080p 视频看开场③段是否已带封面（而非④段才出现）；`PreviewDisplayPanel` hover 大预览与舞台一致。

## 自检（2026-11-23，与设计对照）

已修正的措辞 / 补上的口径（均已在票正文与 ADR/CONTEXT 里改成新口径）：

- 「当前工程封面」→ **作用域工程封面**（预览页可作用于非当前工程；`PreviewPage.tsx:277` 开场片头已是这个口径）。
- 图层顺序精确到「**亮度黑罩在封面之后**」：否则「照吃亮度」会退化成"封面不吃亮度"，与 Q7=B 矛盾。
- 原写的「`drawFieldLayers` 的③段复用同一路径」**是错的**：③段直调 `drawSimBackground`（`opening/openingFrame.ts:368`），所以落笔点必须是 `drawSimBackground` 内部。
- `fieldBitmap` 的失效判据不在 `prepareSimFieldBitmap` 自己身上，在调用侧 `simPlayback.ts:143-147`。
- 测试文件拆成两处：`SimAssetPacks.test.ts`（清单 / 默认值 / 显示名）与 `SimAssets.test.ts`（URL），别都塞进后者。
- i18n 键照 `pickBackgroundSkinName` 的直接查表口径写成 `preview.display.bgName.aao-stage`（它按 `${id}` 拼键，不走 `lookupMessage`，缺键不告警）。

未决 / 落地时注意：

1. **封面加载未就位**：实时舞台按"加载完再画，未到位留空"处理（与无封面同口径）；导出侧必须 await 到位（出图只有一次机会，复用 `static/sheetHeader.ts:532` 的 `loadCoverImage`）。
2. **结算章会跟着变**：票 52 定案「章背景 = 仿真场末帧（含轨道 / 判定线）」⇒ 末帧现在会带相框封面。这是"一致"而不是缺陷，验收时别当 bug 报。
3. **`assets:check` / CI**：确认多出的 `public/assets/preview/` 不会让 `npm run assets:check` 报错（它只校验取件根）。
4. ~~根目录散图~~ 已按用户 2026-11-23 确认删除（`aao-bg.webp` / `aao-bg.png`，前者与正式件 md5 相同、后者是 1.79 比例的另一版渲染）；一次性对比原型（`.cache/proto/`）同日清理。

## 实现记录（2026-11-23）

落了什么（与「实现落点」的差异都写在下面）：

- **新增** `src/preview/video/sim/appAssetPacks.ts`：`AAO_STAGE_PACK_ID` / `APP_BACKGROUND_PACKS` / `findAppBackgroundPack` / `isAppBackgroundPack` / `appAssetUrl`（拼 `BASE_URL`）。
- `simAssetPacks.ts`：`listSimBackgroundPacks()` **前置合并**自带包（第一格）；`SIM_DEFAULT_PACK_IDS.background = 'aao-stage'`；重导出 `AAO_STAGE_PACK_ID` / `isAppBackgroundPack`。
- `simAssets.ts`：`simAssetUrls()` / `simAssetPackThumbUrl()` 对自带包返回本地 URL（不拼 `bgskin/<server>_rip`）；`SimAssets` 增 `stageFrame: SimStageFrame | null`；`loadSimAssets({ cover })` 只在自带包时把它带出去。
- `simGeometry.ts`：`AAO_STAGE_BG_RATIO` / `aaoStageBackgroundRect()` / `AAO_FRAME_RATIO` / `aaoFrameRect()`。
- `simField.ts`：`drawSimBackground(..., paint: SimBackgroundPaint)` —— **第 6 参是选项对象**（`stageFrame`），因为取景矩形也要分叉；封面走 cover 裁切（`drawFrameCover`），落在背景图之后、黑罩之前。`SimFrameAssets` 增 `stageFrame: SimStageFrame | null`。
- `opening/openingFrame.ts`：`OpeningFieldImages` 加同名字段，③段直调 `drawSimBackground` 时透传（字段名与 `SimFrameAssets` 对齐 ⇒ `frame.assets` 直接结构兼容，`frameDriver` 无需改）。
- `encode/exportVideo.ts`：`VideoExportRequest.cover?: Blob | null`；导出前 `loadCoverImage` 解码（仅自带包）。
- 页面：`useStageCoverImage`（新 hook，`createImageBitmap` 解码，换封面不回退空帧）；`PreviewPage` 传 `cover` 给舞台 / 面板 / 导出请求；`PreviewVideoStage` 收 `cover` 并进 `loadSimAssets` 的 deps；`PreviewDisplayPanel` / `SimPackPreview` 收 `cover`，`kind==='background' ? packId : bgPackId` 判定自带包。
- i18n：`preview.display.bgName.aao-stage`（zh「AAO 舞台」/ en「AAO Stage」）。

两处与计划的偏差：

1. **`simPlayback.ts` 没改**：封面折进 `SimAssets`/`SimFrameAssets` 之后，`fieldBitmap` 的重绘判据 `frame.assets !== input.assets` 已经覆盖 —— 换封面 ⇒ 页面重新 `loadSimAssets` ⇒ 新 `assets` 对象 ⇒ 重建底图。票里写的"加封面版本"是多余的。
2. **`loadSimAssets` 收的是已解码的 `CanvasImageSource`，不是 Blob**：解码留在页面（`useStageCoverImage`）与导出（`loadCoverImage`）两个编排层，仿真场这一层不碰 createImageBitmap / objectURL，测试也好注入。

验收做了哪些：

- `tsc -b` 通过；`eslint` 只余 1 条既有的 fast-refresh warning。
- 单测：`SimAssetPacks` / `SimAssets` / `SimGeometry` / `SimField`（新增「相框封面」5 例：绘制顺序、自然比例取景、cover 裁切、无封面、空态）/ `AppSettingsSimPacks` 全绿；连带改的 `PreviewDisplayPanel` / `PreviewPageWiring` / `VideoExportWiring` 也全绿。
- 像素验收：本机 `docs/resource/SampleChartCode` 为空、`scripts/sim-shot.mjs` 跑不起来，改用一个一次性脚本在 **vite 现编译的真模块**（`simGeometry` / `simField`）+ **真素材**上画一帧存 `/workspace/.cache/aao-verify.png`（临时图，未入仓）：相框 287×288 落在 `x 522.6 / y 163.3`，背景 1760.9×880.4 顶贴 `y=0`，封面被压在车道线之下、整体被 0.7 亮度压暗 —— 与定案一致。

**还没人眼验收的一项**：真机导出一条 1080p 视频，确认开场第③段就带相框封面（而不是④段才出现），以及结算章末帧带上它。需要一份有封面的工程 + WebCodecs 环境，跑不了自动断言。

### code review 回修（2026-11-23，两轴并行）

Spec 轴与 Standards 轴各跑了一遍，落下来的修改：

1. **`backgroundCover` + `backgroundAppOwned` 两个字段合成一个 `stageFrame: SimStageFrame | null`**（Data Clumps）：两个值语义上不可分 —— 有值 = 背景是自带包（取景分叉 + 相框存在），`cover` 只是屏里的内容。原来那对字段在 `SimAssets` / `SimFrameAssets` / `OpeningFieldImages` / 绘制参数四处靠手抄对齐。
2. **注释口径补齐**：`simAssetPacks.ts` 头注释与 `normalizeSimAssetPackId` 的 doc、`simField.ts` 的 `SimScene.bgPackId`、`AppSettings.ts` 的 `bgPackId` 字段说明 + 默认值注释，原来还写着"默认 `skin00`"。
3. **删掉 `AppBackgroundPack.labelKey`**（Speculative Generality）：显示名实际由 `packDisplayName → pickBackgroundSkinName` 按 `${id}` 拼键，字段存两份真源会漏改。
4. **`useStageCoverImage` 改成"未到位返回 null"**：原来保留旧图防闪，但 Spec 写的是"未到位留空"；切工程时舞台会拿旧 `assets` 继续重绘，等于把**上一份工程的封面**多显示一次素材加载的时长。现在按 blob 身份校验，换封面立刻回 null。
5. **补锁测**：`simAssetPackThumbUrl('background', 'aao-stage')` → 本地原图 URL（Spec 轴指出网格缩略这条分叉没钉住）。

未改的两条（记下来备查）：`drawFrameCover` 在拿不到源尺寸时回退拉伸 —— 理论上不可达（`naturalWidth` / `ImageBitmap.width` 恒有），宁可画歪也不留空；`useStageCoverImage` 没有独立单测 —— 它是 15 行 hook，行为由 `SimAssets` 的 `stageFrame` 锁测 + 面板/舞台的传参覆盖。

## Comments

- 2026-11-23 grill 一轮（10 问，用户逐问拍板）：Q1 身份=OK；Q2 取景按 2:1 自然比例=OK；Q3 首答被追问后澄清「场地图」含义，用户改判为**封面必须在场地图之下**；Q4 无封面留空=OK；Q5 统一生效=OK；Q6 素材放 `public/assets/preview/`（并反问"为什么不放 `public/assets/sim/bgskin`"，已答：整根替换 + 清单覆盖 + 快照只收上游素材）；Q7 亮度照吃=B；Q8 接缝=OK；Q9 用户看图后再定=A；Q10 hover 预览也填封面=OK。相框内屏比例由 webp 像素扫描实测（初版按视觉估的 0.4072/0.5923/0.1855/0.5313 偏大，已改用 0.4180/0.5811/0.1855/0.5127）。

### 第二轮回修（2026-11-23 用户看完首版成片反馈三条）

1. **开场封面"直接出现、没有淡入"** → 成因：③④ 段的相框封面是满不透明度画在开场画面底下，
   开场一淡出它就整块露出来。改法：相框封面单独一层 alpha（`SimBackgroundPaint.coverAlpha`），
   ③ = 0（只留空相框）、④ 跟轨道同一条 1.8s 淡入窗（`openingTrackAlphaAt`）。
2. **封面登场"太简陋"** → 新增登场动效 `coverIntro`（`drawStageCover`）：从 1.16 倍缩回落定
   （ease-out-cubic、始终盖满玻璃屏）、一道横向扫光自上而下掠过、相框内沿亮一圈再收。全部纯合成、
   不碰 `ctx.filter` / 离屏模糊（导出逐帧扛得住）。④ 开头 0.7s 走完（`OPENING_COVER_INTRO_SECONDS` /
   `openingCoverIntroAt`），正片与实时预览不重放。落定后 scale 钉成 1（`1.16 − 0.16` 的浮点尾巴
   会把封面塞进半像素里糊掉）。
3. **结算背景与左半幅**（用户定案 B + ③）：
   - 结算舞台改用**固定**背景 `skin00/liveBG_normal.png`（`ENDING_STAGE_BG_PACK`），不跟打歌的背景包，
     也不放相框封面（`EndingContentInput.stageBackground`；`undefined` = 旧行为、`null` = 只剩深色底）。
     解决"结算同时出现两张封面"。
   - 左半幅不再铺虚化封面，改**取封面平均色**（8×8 降采样 + 向饱和拉 1.7×）铺一层左→右渐隐的氛围色
     （`ENDING_SPEC.bgWash`）。原 `bgBlur` / `bgBright` 删除。票 52 的相应定案已在其票内标注推翻。
4. **原型同步**（用户要求"不导出视频也能看到"）：`public/proto/scenes.html` 改 `bgPackId: 'aao-stage'`、
   给 `loadSimAssets` 传现画的相框封面、③④ 传 `coverAlpha` + `coverIntro`、结尾传
   `stageBackground`（另加载一份 `skin00` 背景）。`?scene=seq&t=5.2~6.3` 看登场、`?scene=ending` 看结算。

### 第三轮回修（2026-11-23 用户再看原型：结算背景换得太早）

用户口径：结尾的**中央章时间段**背景就变成固定那张了 —— **固定背景只属于结算画面**，
也就是黑幕转场后面的那一屏；中央章 / 幕布淡入仍应显示打歌末帧的舞台（AAO 舞台 + 相框封面）。

- 落点：`endingFrame.drawStage` —— 换景时刻 = `stampDur + transDur × 0.22`（新常量 `CURTAIN_IN_RATIO`，
  与 `curtainAlpha` 的淡入段共用）；那一帧黑幕已盖满，换景看不出来。
- 锁测：`EndingFrame.test.ts`「票 84 回修 · 结算固定背景只在黑幕盖满之后换上」—— 章内 / 0.2T 不换景且相框封面还在；
  0.3T 与结算换成固定背景、相框封面消失。
- 原型无需另改：它直接调 `drawEndingFrameAt`，行为随生产逻辑一起变。

### 第四轮回修（2026-11-23 用户第二轮看图 + 动效反馈）

1. **结算左半幅再改口径**（用户："'幅满'效果不太好，甚至感觉是'污染'…或者压根不加任何特效了？"）：
   整块平均色（88）+ 压暗（42）会把官方房间背景压成一块色板，渐变边界还正好落在白卡边缘。
   定案：半屏色板整条删掉（`bgScrim` / `bgFadeFrom` / `bgFadeTo` 一并删），改「封面卡背后的径向柔光」；
   用户在原型里对比「有 / 无」后**定档 `bgWash = 25` / `bgGlowSize = 1.15`**（`bgWash = 0` = 不画）。
   实拍对比（原型 1920×1080 截图）：0 = 干净、18 几乎看不出、30 / 55 像紫色雾 —— 25 / 1.15 是用户挑的那档。
2. **开场 ④ 相框封面登场**：先按"有点快"从 0.7 → 1.1s；用户随后在原型里把旋钮拉满定档
   **2.0s / 起始缩放 1.2 / 扫光 0.65 / 屏沿 1.1**（`OPENING_COVER_INTRO_SECONDS` + `STAGE_COVER_INTRO_STYLE`）。
   力度参数经 `SimBackgroundPaint.coverIntroStyle` 透传，`openingCoverIntroAt(t, timing, seconds)` 收覆盖时长。
   2.0 > ④ 段 1.8 ⇒ 尾段 0.2s 落在切到打歌之后，但 p = 0.9 时缩放差 0.02%、扫光 / 屏沿残影 ≤3%，接缝不可见。
3. **原型旋钮**：`?scene=opening` 右侧「封面登场（④ 相框封面）」= 动效时长 / 起始缩放 / 扫光强度 / 屏沿亮度；
   `?scene=ending` 右侧「结算 · 封面卡柔光（0 = 不加）」= 浓度 / 光斑半径。URL 同名参数可直接贴。
