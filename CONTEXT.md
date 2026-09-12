# CONTEXT（领域上下文）

> ⚠️ **文档权威性标注**：`docs/plans/` 目录内容多为基础期产物、可能过时，且**不纳入版本控制、未来不会上仓库**。权威依据仅以下两处：
> - **决策/规则** → `docs/adr/`（ADR，纳入版本控制）。
> - **术语** → 本文件（CONTEXT.md）词汇表。
> 实现与评审以 `docs/adr/` 与本文为准；`docs/plans/` 仅供历史参考，冲突时以 ADR 为准。

本文件的词汇为**通用语言**（Ubiquitous Language）。涉及"音符覆盖/滑条"的术语与规则以 [ADR-0001 音符覆盖与滑条规则](./docs/adr/0001-音符覆盖与滑条规则.md) 为准；编写代码、issue、测试、方案时使用下文术语，勿漂移到同义词。

## 领域

BanG Dream / Bestdori 自制谱编辑器。谱面代码 = Bestdori 风格 JSON 数组（见 `docs/plans/谱面代码规则文档.md`）。

## 核心实体

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 谱面 | Chart | 整份可编辑的音符集合（`ChartNote[]`） |
| 音符 | Note | 谱面中的基本元素，见下方各类型 |
| 谱面代码 | Chart code | Bestdori 风格 JSON 数组，编辑器内部数据 ↔ 代码的双向映射产物 |
| beat / subBeat | beat / subBeat | 时间坐标；subBeat 为细分，未设置时视为 `0` |
| lane | lane | 轨道编号 `0..6`（共 7 道） |

## 音符类型

| 术语 | 英文 / 类型 | 说明 |
| --- | --- | --- |
| 单键 | Single | 普通单点音符 |
| 滑键 | Flick | 带 `flick` 标记的单键 |
| 技能键 | Skill | 带 `skill` 标记的单键 |
| 方向键 | Directional | `LDirectional` / `RDirectional`，带 `length`（1..3） |
| 滑条 | Slide | 由多个**结点**（connections）组成的连线 |
| 长条 | Long | 由多个 connections 组成（与滑条同构） |
| BPM 线 / System | BPM / System | 非击打类元素 |

## 滑条相关（重点）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 滑条结点 | Node / connection | 滑条的一个连接点，含 beat/lane/subBeat 及可选 `flick`/`skill` 标记 |
| 端点 | Endpoint | 滑条的**头部**（`e0`）与**尾部**（`eN`）结点 |
| 中间节点 | Middle node / pathway | 滑条两端点之间的途经结点（`m1..m_{N-1}`），亦称"途径结点" |
| 覆盖 | Overwrite | 把音符放置到已有音符/结点所在位置的处理 |
| 拆条 | Split | 从滑条中拆出部分，得到独立音符与/或更短的滑条 |
| 组合 | Combine | 滑条与滑条的端点合并（合并为一条更长的滑条） |
| 隐藏结点 | Hidden node | 滑条/长条中标记 `hidden` 的过渡结点：不渲染图标、无判定、不计数，编辑态不可选中/悬停/独立拖动（ADR-0008 §6，Q36=D）；只作为曲线采样点或删除占位存在。**首/尾结点不得为 hidden**（校验拒绝） |
| 段 | Span | 相邻**可见**结点之间的滑条子部分，可含若干隐藏过渡结点（issue 93 口径：段 = 逻辑段含 hidden） |

## SP 绿条（issue 09 定案）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| SP 段 | SP span | 含隐藏结点的段；渲染采用 SP 无缝带材质（皮肤条目 `longNoteLine2`），**按段判定**，皮肤缺失时回退普通连接带 |
| SP 绿条 | SP slide | 含 SP 段的滑条。游戏内无专属判定/换色——本质 = 被隐藏采样点折弯的普通绿条 |
| 缓动 | Easing | 曲线的插值函数配置：10 族（Sine/Quad/Cubic/Quart/Quint/Expo/Circ/Back/Elastic/Bounce）× 4 型（In/Out/In-Out/Out-In），采样精度三档（每拍 1/16、1/32、1/64） |
| 烘焙 | Bake | 把段参数（缓动/形状）生成为密集隐藏采样结点的动作；**导出谱面代码时必然发生**（Bestdori 格式没有缓动字段，缓动只以隐藏点集形态存在） |
| 段参数 | Span param | 段的内部扩展属性（缓动配置/曲线形态），随谱面工程保存；隐藏采样点是渲染、命中、导出的**唯一真相**，参数只服务再生成。对段内结点的手工改动使参数清除、退化为普通点集段 |
| 曲线工具 | Curve tool | 直接放置 SP 段的持工具态工具：单击链式 = 按当前缓动配置烘焙缓动段；态内**空白拖动 = 画笔**（沿轨迹实时采样自由段），Shift+拖 = 框选（ADR-0008 §2 例外）；直线绿条仍归滑条工具 |
| 自由段 | Free span | 段参数为点集形态的段（画笔/导入/拨弯产物），无解析缓动参数，可拖带整形、可重新应用生成器覆盖 |
| 拉弓变形 | Bow bending | 拖动段（slideRegion）的整形语义：两端可见结点锚定、段内隐藏点按投影权重跟随位移；拨弯普通段 = 自动补隐藏点就地转化。拖带弯曲即参数清除（"一动就自由化"）；拖端点 = 移动意图，不自由化 |

## 交互状态（ADR-0008）

| 术语 | 说明 |
| --- | --- |
| 持工具态 | armedTool；所有工具共驻一根轴的互斥状态（键型放置/BPM/滑条/编辑动作/指针=空），默认**驻留**，仅 Esc/点当前工具/切换工具退出。_Avoid_: "选中态"（该词永远只指音符进入选区） |
| 选区 | selection；点选/框选/Shift 加选建立的音符（含滑条子部分）集合，常驻且**与持工具态解耦**；编辑类执行键的作用对象 |
| 执行 | 执行键的**瞬时动作**（非状态）：在谱面光标处/当前选区立即执行，非法则无事发生 |
| 框选组合 | 用框选把选中音符消耗为滑条结点的放置路径（形态归一表见 ADR-0008 §4）；区别于"组合"（滑条↔滑条端点合并） |
| 就地编辑 | 对象参数交互模式：参数挂在对象上、直接编辑、回车应用、无模态打断（BPM 数字→未来滑条结点缓动，ADR-0008 §5） |
| 选择条目 | SelectionItem，见 ADR-0001 §6 |
| 滑条子部分 | Slide 的三种可独立选中/编辑单元：区域（连接带）、端点、中间结点，见 ADR-0001 §6 |

## 快捷键系统（ADR-0002）

| 术语 | 说明 |
| --- | --- |
| 具体功能 | Function，可被快捷键触发的一项**具体操作**，有唯一 `functionId`（如「切换-单键」「执行-单键」「撤销」） |
| 单键绑定 | 每个具体功能**恰好绑定一个**按键组合（"1 功能 1 键"）；**一键不多功能**（冲突时拒绝） |
| 切换（switch） | 裸键（如 `F`），用于**切换持工具态** |
| 执行（exec） | `Ctrl+组合`（如 `Ctrl+F`），用于**立即执行**该具体功能（作用于当前选区/光标/历史/播放） |
| 类别（category） | 展示分组，把某类别的「切换/执行」合并成一行 tooltip |
| 预览 | 持工具态下、未执行时，光标悬停/框选显示的低透明度**真实图标**幽灵 |

> 规则细节：交互模型见 [ADR-0008 工具交互机制](./docs/adr/0008-工具交互机制.md)（取代 ADR-0002 §3）；覆盖/滑条规则见 [ADR-0001](./docs/adr/0001-音符覆盖与滑条规则.md)。

## 工作台与配置系统（ADR-0003）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 工作台 | Workspace | 进入应用后直达的全屏编辑界面（无独立上传页）；加载音频是工作台内的一次可选操作 |
| 音频面板 | Audio panel | 工作台内以页面/Tab 访问的独立面板，承载**导入 / 换 / 清除**音频与**无音频时长编辑**；无音频＝常态，可正常编辑 |
| 页面管理 | Page management | 以应用级页面切换组织工作台、音频、设置、快捷键等**单例功能目的地**；完整页面架构由 issue 28 实现，issue 27 先引入最简页面切换底层 |
| 应用页面 | Application page | 应用壳中的单例功能目的地；当前范围为工作台、音频、设置、快捷键。它负责功能导航，不代表一份谱面工程 |
| 工程文档标签 | Project document tab | 未来位于工作台内部、对应一份可重复打开谱面工程的文档标签；其创建、关闭、切换与隔离语义属于 issue 26，不与应用页面混为同一层 Tab |
| 布局预设 | Layout preset | 把当前 面板宽度/折叠态/缩放 存成的**命名快照**，可恢复；只存布局信息、不含谱面数据 |
| 设计令牌 | Design token | CSS variables 体系（颜色/间距/圆角/字号/阴影），主题与皮肤的取值来源 |
| 主题 | Theme | 亮/暗内置两套 + 注册机制；**谱面画布始终深色**，主题只作用于面板/工具栏/弹窗等 chrome |
| 设置对象 | Settings | 统一 versioned JSON：`{ schemaVersion, theme, layout, shortcuts }`；localStorage 持久化 + JSON 导入导出 |
| 上下文分域 | Context domains | 状态管理组织：`EditingContext`（音符/历史/选择）、`UIContext`（面板/缩放）、`ConfigContext`（设置）；`Editor` 只负责组装 |

## 应用页面壳（ADR-0007）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 应用壳 | App shell | `src/pages/AppShell.tsx`——5 页注册 + 保活挂载 + 切页快捷键 + 可折叠应用导航；issue 28 闭环；不在内容壳 ADR 范围 |
| 内容壳 | Content shell | `src/components/layout/AppPageShell.tsx`——4 个非工作台页共用的"页面头 + 紧贴 body 边的侧边索引 + 内容模式 + 自适应几何"模板；compound component 形态（namespace）；ADR-0007 范围 |
| 应用页面 | Application page | 应用壳中的单例功能目的地；当前范围为工作台、音频、素材、快捷键、设置（issue 28 §ADR-0003 既有定义） |
| 内容页 | Content page | 接入内容壳的应用页面；**工作台不接入**（内部布局专属，issue 28 P1+P2）；当前范围 = 音频、素材、快捷键、设置 |
| 工作台页 | Workspace page | **不接入内容壳**的应用页面（内部布局专属 + 黑盒接入应用壳，Editor 仅传 `active` 表面契约） |
| 页面头 | Page header | 内容壳 `<AppPageShell.Header eyebrow title description />`；沿用 `.page-intro` class，CSS 不动；4 页沿用现状字符串，文案语义统一后续单开 issue |
| 侧边索引 | Sidebar | 内容壳 `<AppPageShell.Sidebar>`——**独立于正文外**（不占正文空间，与"压在正文内"语义对立）；可空、可分组；激活态统一为"主色软底 + 主色文字 + 弱描边" |
| 侧边分组 | Sidebar group | `<AppPageShell.SidebarGroup title>`——带不可点的分组标题；用于"应用设置 / 功能设置"等场景 |
| 侧边项 | Sidebar item | `<AppPageShell.SidebarItem icon label>`——`icon` 为 `React.ComponentType`（lucide），size 17 由模板写死；激活态见上 |
| 内容模式 | Content mode | `<AppPageShell.Body mode>`——`"default"`（整页滚） / `"fill"`（整页不动 + 内部子元素自身滚）；显式 prop，默认 `default` |
| 几何自适应 | Adaptive geometry | sidebar 宽 = `clamp(140px, 12.5%, 200px)`；body 宽 = 锚点 920（主内容区 ≤1440 恒定）+ >1440 按 0.3/px 线性增长 + 整体 +12px（`--aps-body-bump`）；左边距 L=51 / 右边距 R=32；4 页 body 左缘严格相同 = L + sidebar 宽 + 24（`__slot` 占位槽对齐，不论有无 sidebar）；不传 prop，模板自管（issue 44 第四轮流体几何） |

## 播放与预览（ADR-0004）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 判定线 | Judgment line | 播放（含暂停停住态）时固定在**画布底部**的横线，代表"此刻"，谱面沿判定线向上滚动；常显（停/播同线） |
| 合成时间线 | Synthetic timeline | 无音频时的播放时钟（`performance.now` + RAF），与音频时间线行为同构 |
| 临时起点标记 | Start marker | 双击画布左侧沟槽（轨道外、画布内）标记的 beat 位；**Ctrl+空格** 跳回并播放；双击/选中后可删除；**不入谱面数据** |
| 播放条 | Playback bar | 画布底部的播放控件条（播放/暂停、时间码、进度条等） |
| 素材包 | KeySoundSet | 按键音素材集合，按击打样式分类（五类口径见下方「音频域」）；整包切换、持久化 |
| ~~谱面末端~~ | ~~Chart tail~~ | **已废弃**（被 ADR-0005 的"谱面长度"取代）：旧的"由音符推算可播时长"语义不再成立 |

> 播放时长的规则：有音频＝音频自身长度；无音频＝谱面长度（见下方 ADR-0005 谱面长度）。

## 谱面画布标线（2026-09 定案）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 起始线 | Start line | 谱面起点（beat 0）处的标线，横跨画布全宽；文字 `START` 位于线上方（保证在谱面范围内） |
| 结束线 | End line | 谱面长度末端处的标线，横跨画布全宽；文字 `END` 位于线下方 |
| 节拍线 | Beat line | 整拍位置的网格横线，层级最高 |
| 子节拍线 | Sub-beat line | 整拍之间的细分横线；按细分分母分层——分母越小越显眼（整拍 > 1/2 > 1/4、3/4 > 1/8 > 1/16）；层级靠**样式**区分而非仅亮度，最淡层级也不影响视觉判断 |
| 实时显示线 | Hover line | 鼠标在画布内时跟随鼠标 Y 的水平线，**连续跟随不吸附**；只在轨道宽度内绘制；两侧沟槽分别显示 分内时间（左）与已过音符数（右）；区别于判定线——判定线 = 播放位置，实时显示线 = 鼠标位置 |
| 分内时间 | In-minute time | 实时显示线左沟槽的时间格式 `SS.ss`（秒.厘秒）：00.00–59.99 循环，不含分钟位；与播放条/底部叠加的完整时间码互补（范围小、精度高） |
| BPM 数值 | BPM label | BPM 线旁的标注文字，**仅显示数值**（不带 "BPM" 前缀） |
| 外侧装饰文字 | Gutter label | 贴轨道外缘、恒定 CSS 像素间距的画布标注文字体系，缩放中位置稳定，如轨道外装饰。两类：**常显标线文字**（BPM 数值 / START / END，同一字号体系、主题色）与**实时信息文字**（实时显示线两侧，样式与字号刻意不同于前者，以区分"临时鼠标读数"与"常显装饰"） |
| 轨道样式 | Grid style preset | 网格线（节拍线 + 子节拍线）的整体样式预设；设置域 display 下，内置数种、全局生效 |

## 音频域（issue 29 切片 4 闭环 + issue 39 #7）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 音频域 | Audio domain | 设置对象 `settings.audio` 段：承载与**音源**相关的所有字段——`keySet`（键音素材包）、`seVolume`（节奏图示 SE 音量）；UI 集中在音频页（issue 29 切片 4 闭环） |
| 音频页 | Audio page | 应用级页面（导航第 2 项 `⇧⌘2`）；承载**音频素材导入/换/清除**、**谱面时长**、**键音素材包**、**节奏图示 SE 音量**（issue 29 切片 4 后） |
| 节奏图示 SE 音量 | SE volume | 键音（音符击打音效）的独立音量，0..1，**不影响 BGM**；原 issue 39 #7 落入设置页「功能设置·播放」，issue 29 切片 4 迁入音频页 |
| 键音素材包 | KeySoundSet | 按键音素材集合，按击打样式分类 `{ tap, flick, skill, slide, directional }`；整包切换，激活项持久化 `settings.audio.keySet`；UI 在音频页（同音频素材同域） |
| 击打样式 | KeySoundKind | `{ tap, flick, skill, slide, directional }` 五类（与 `KeySoundSet.samples` 一一对应） |

## 视觉素材域（issue 29）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 视觉素材页 | Visual assets page | 应用级页面（导航第 3 项 `⇧⌘3`）；原「素材页」收窄为视觉素材；页内**类别子 tab**：音符皮肤 / 背景皮肤，一次看一个类别，可扩展 |
| 音符皮肤 | Note skin | 音符外观素材包；注册表由 `scripts/build-note-skins.mjs` 从 Bestdori 归档解析 `.sprites` 官方坐标生成（`src/renderer/noteSkinRegistry.gen.ts`，产物入库） |
| 皮肤条目 | Note skin item | 六条目：单键 `tap` / 滑键 `flick` / 技能键 `skill` / 左方向 `dirL` / 右方向 `dirR` / 滑条 `slide`；slide 管三件套 = `longNoteLine` + `longNoteLine2` + `note_slide_among` |
| 整包预设 | Skin preset | 官方同名配对（skin0N + directionalflickskin0N）一键写入六条目；写入后各条目仍可独立覆盖 |
| per-lane | per-lane sprite | 官方精灵按轨道一张（透视观感差异）；方向键 length=N = N 条覆盖轨道各贴本轨图；滑条端点复用单键皮肤 |
| 谱面背景皮肤 | Chart background skin | 谱面画布的可选背景图层（画布固定深色主题不变）；**最小模型已实现**（Q4 + 同日三轮修订）：1 张本地图片（IndexedDB `bangdream.assets`）+ 启用开关 + 清除；**可调不透明度**（默认 55%）/ **填充方式**（铺满裁剪 cover / 完整显示 contain）/ **显示范围**（仅轨道外 outsideTrack 默认，不覆盖轨道本身 / 全画布 fullCanvas）；渲染进静态层；回工作台激活即补帧重绘 |

> 规则细节：皮肤与音符类型的完整映射、资源接入边界见 `.scratch/basic-editor/issues/29-素材页面-键音素材包与皮肤.md` 定案记录；归档使用边界见 `docs/resource/bestdori/README.md`。

## 谱面长度与谱面工程（ADR-0005）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 谱面长度 | Chart length | 显式、第一性、以**秒**为单位的属性，**与音符无关**；有音频时锁定为音频时长，无音频默认 30s 可手动调；驱动画布高度/网格/滚动范围/播放宽；放置音符**永不改变**它 |
| 谱面工程 | Chart project | 谱面级持久化单元 = { 谱面代码(Json) + **谱面时长** + 音频引用/数据 }；**谱面时长不入 Json**，是谱面工程显式字段；按谱面工程隔离、跨会话恢复 |
| 谱面时长 | Chart duration | 谱面工程内以秒存储的显式字段：有音频＝音频时长；无音频默认 30s，播放条可手动改并持久化 |
