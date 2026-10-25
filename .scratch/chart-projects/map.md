# Map: 谱面工程管理

> Effort: `chart-projects` · 2026-09-26

## Destination

走到尽头 = 应用启动落在工程管理页，可以新建 / 打开 / 复制 / 删除歌曲级谱面工程，一个工程里多张谱面可切换，谱面状态可见、已上传谱面只读；从 Bestdori 新建工程落地或被划出范围。上传链路本身不在本地图（归 bestdori-integration）。

## Notes

- **每次会话必读**：`CONTEXT.md`、[ADR-0015](../../docs/adr/0015-歌曲级谱面工程与工程管理页入口.md)、[ADR-0005](../../docs/adr/0005-显式谱面长度与谱面工程持久化.md)、[ADR-0011](../../docs/adr/0011-Bestdori集成与本地客户端网络素材边界.md)。
- 取代 basic-editor issue 26（多谱面工作区）。
- 产品未对外发布：不写旧数据迁移。

## Decisions so far

- [01 谱面工程管理与启动流程定案](./issues/01-谱面工程管理与启动流程定案.md)：工程 = 一首歌的容器（多谱面、难度可重复）；启动落应用壳第一项工程管理页（`⇧⌘0`）；单一当前工程，直接进工作台 = 最近打开的未完成工程 / 否则新建；状态 = 未完成 / 已完成 / 已上传，已上传只读、至多传一次，改就复制谱面；剪贴板切换不清；不写迁移。
- [02 歌曲级工程存储模型](./issues/02-歌曲级工程存储模型.md)：`schemaVersion` 保持 1（未发布不 bump）；一工程多谱面 + 封面分离存字节；list/get/save/delete；旧 `default`（无 `charts[]`）不读不删。
- [03 启动落点与当前工程](./issues/03-启动落点与当前工程规则.md)：启动落工程管理页 `⇧⌘0`；当前工程 `ensure/open`；进工作台 = 最近未完成 / 否则新建未命名 Expert；切工程换编辑态、剪贴板不清。
- [04 工程管理页](./issues/04-工程管理页.md) UI：**工程启动台（B）+ 工程详情（C）**；新建 = 空白 / 复制 / Bestdori，不含从谱面代码（Q25）；音频走音频页、封面走工程信息（Q26）。用户 2026-09-26 接受原型。落地：`ProjectsPage` 为默认入口，原型不再劫持该页。
- [05 工作台谱面切换](./issues/05-工作台谱面切换与复制谱面.md) UI：面包屑下拉；新增谱面可可选贴 JSON。用户 2026-09-26 接受原型。落地：顶栏 `ChartSwitcher`，原型目录已删。
- [08 DOM 组件测试基建](./issues/08-DOM组件测试基建.md)：定了 RTL+jsdom 进 `tests/dom/`，全局 environment 保持 node（文件内 docblock 开启）， batch 09~15 的锁测依赖它。
- [09 工程管理页空状态与引导横幅](./issues/09-工程管理页空状态与引导横幅.md)：定了 0 工程时横幅位放引导横幅（同 hero 尺寸）、网格区用 EmptyState；有工程时横幅常显。
- [10 未命名工程不同步](./issues/10-自动创建的未命名工程不同步.md)：定了 ensure 新建时须 notifyCatalogChanged；Q9 规则（最近未完成优先 / 否则新建未命名 / 下次仍进它）用纯函数单测锁住。
- [12 编辑信息封面上传改版](./issues/12-编辑信息封面上传改版.md)：封面字段抽成 `src/ui/CoverField.tsx` 自绘上传区；编辑弹窗改**左封面（160px 方块）/ 右表单**分栏，封面升为弹窗主角；更换/清除为等宽 26px 描边小按钮贴图下；原生 input 藏 `visually-hidden-input`，patch 出参不变。
- [13 删除/覆盖确认统一为自定义确认弹窗](./issues/13-删除确认换自定义弹窗.md)：新建 `src/ui/ConfirmDialog.tsx`（Esc / 点遮罩 / 焦点落确认键 / Tab 内循环 / `aria-modal`），替换全部 4 处 `window.confirm`；`window.alert` 不动（另开票）。例外清单为空，`tests/static/NoWindowConfirm.test.ts` 是防回潮总闸。
- [16 通用弹窗壳与全站弹窗视觉整改](./issues/16-通用弹窗壳与全站弹窗视觉整改.md)：13 落地后用户判「弹窗单调丑陋」+ grill 定案——**D 方向排版（无图标、问句标题、注意行正文、分隔线+底栏、120ms 渐入）+ 实底红危险键**；定一个通用 Dialog 壳，把 `.pp-dialog`（新建/编辑工程/谱面信息）与代码编辑器自绘弹窗收编进来；**不引 shadcn/Tailwind**；危险分寸规则＝**不可逆=实底红，可逆=红字点到为止**（issue 12 分寸是后者，不动）。
- [14 卡片网格键盘导航与横幅跟随](./issues/14-卡片网格键盘导航与横幅跟随.md)：定了方向键操控卡片网格（非横幅）、横幅是选中投影、选中≠当前工程、排序沿用 `lastOpened` 不新增 `updatedAt`。
- [15 音频归属谱面工程](./issues/15-音频归属谱面工程.md)（resolved）：音频页 = **工程音频的唯一管理入口**（工程详情只读展示 + 带作用域的「设置音频」跳转）；作用对象**默认当前工程、可临时作用于其它工程**；写路径按 projectId 参数化（`projectAudio` 接缝）+ 一次性时长探针（不常驻第二份解码音频）；锁保留、**锁定工程可被选为作用域**（只挡写、不挡看与播）；无当前工程空态、进页不 ensure。09-27「收进详情」与 09-28 早间「不做跳转」均已被推翻，讨论存档在票内。
- [22 页面作用域机制](./issues/22-页面作用域机制.md)（resolved）：定了**页面作用域**（页面此刻作用于哪个工程的临时指向）与「当前工程」彻底分家——**入口决定 scope**（左栏入口先清、跳转先写）、不持久化、失效回落当前工程 + 提示；作用域住**区块头右侧**（不是页级横条），`当前` / `非当前工程` 由徽标 + 容器描边区分（中性色，非警示）；切换器常驻搜索（匹配显示名 + 歌手、不做拼音）、当前项置顶分组；机制落 **ADR-0015 §6**（不落 ADR-0007）。是票 15 的前置。
- [19 2026-09-28 工程管理页验收批次](./issues/19-20260928-工程管理页验收批次.md)：定了 ①hub↔detail 方向滑入（170ms；工作台切换不另加）②难度/等级徽标就地浮层编辑（已上传 → toast）③封面 objectURL 缓存（首帧即有图）④排序四键存 `settings.projects.sort`、默认选中恒为最近打开 ⑤卡片流式铺满 ⑥工程/谱面副本命名同口径递增。
- [20 当前工程跨刷新](./issues/20-当前工程跨刷新.md)：定了当前工程 `{projectId, chartId}` 落盘（独立存储、不进设置对象），启动即恢复、进工作台直接回到它；ADR-0015 §3 补「优先恢复」优先级。
- [21 编辑操作后全封面闪一下](./issues/21-编辑操作后全封面闪一下.md)：改成 store 层稳定封面 Blob 实例（尺寸不变即沿用）——reload 不再换身份，#3 的 URL 缓存不再被编辑操作打穿。
- [23 2026-09-28 工程详情页验收批次](./issues/23-20260928-工程详情页验收批次.md)（**done**，09-28 落地）：定了 ①创建/复制工程统一落点=**留在详情页 + 新工程成为当前工程 + 视图切到它**（不再跳工作台；`openWorkspace` 拆 `setCurrent`/`enterWorkspace`，静态断言锁"跳工作台全仓仅一处"）②详情页左栏可拖拽分栏（形状对齐工作台但**不抽公共抽象**；宽度 `clamp(220,300,420)` 落 `settings.layout.projectList`，双击复位）③复制工程后视图不切副本=**bug**（`copyProject` 连 `detailId` 都没切）④详情页左栏 ↑↓ 只**翻看**、永不碰当前工程（复用 `moveGridSelection`，守卫照抄 hub）⑤头部按钮组改锚**标题块右缘**（去 `margin-left:auto` 的"飘"根源；窄窗口整组折行右对齐）。**收尾时真渲染又暴露同病症第二处**：谱面行把标题挤成竖排 + 760px 横向溢出 → 谱面行由 grid 改 `flex-wrap`（已一并修）。另给 `TokenUsageWiring` 闸加参数化 token 白名单。
- [24 「当前工程」的语义与切换](./issues/24-当前工程语义grilling.md)：**待 grill** —— 由票 23 Q1 分离（用户判定"切换当前工程一定要进工作台吗 / 当前这个状态用户能明白吗"值得单独立场）。承载「↑↓ 改当前工程」待定项与四种"进入工作台"文案的收敛；可能产出 ADR-0015 §3 修订。
- [25 工程名含中文把详情页列表行撑高 1px](./issues/25-20260929-工程名含中文撑高列表行.md)（resolved）：**行高不许跟着字体回落走** —— `line-height: normal` 的行盒高取"实际命中字体"的度量（拉丁 Geist 13px→17px、中文回落雅黑 13px→18px），名字行是行内最高项，1px 一路传给谱面行/左栏工程行/列表盒/其后区块 y。修法 = 名字行由同一条规则钉 `line-height: 1.3`（unitless，随字号档缩放）。与 23 #4 同源：**布局判据不许依赖文字内容**（那边宽度、这边高度）。
- [26 切谱面进工作台画面残留](./issues/26-切谱面进工作台画面残留.md)（resolved）：进工作台前置同步数据恢复，消除切换空档期残影与播放打断。
- [2026-10-09 用户拍板，记录在 bestdori-integration 12](../bestdori-integration/issues/12-导入入口四项归类.md)：**新建来源改按用户视角归四项** —— 空白创建 / **从本地谱面导入**（= 既有「复制工程」的归位改叫法，不新增文件级导入）/ 从官方谱面导入 / 从社区谱面导入。本地图 01 定案 11 / 13 的三来源与 04 落地的两个入口（`.pb-tiles` + 分裂按钮菜单 + `NewSource`）都按此重排；官方 / 社区两支的实做在 bestdori-integration 08 / 09，本图的 07 只保留「被网络 IPC 阻塞」这一条前置。

## Frontier

- [23 2026-09-28 工程详情页验收批次](./issues/23-20260928-工程详情页验收批次.md) — **已完成**（#1~#4 全 done，全量测试绿）。
- [06 谱面状态与已上传只读](./issues/06-谱面状态与已上传只读.md) — 05 已 resolved，可做（上传记录可先手工注入）。
- 07 被 bestdori-integration 的网络 IPC 实现阻塞。
- 24 待 grill：**23 已落地**，可开场（用户已能体验到"创建/复制不跳页"）。

- 27 工程主页启动时自动滚到中间（bug，open，2026-10-10 验收开票）：选中卡片自动滚入视口的 effect 未排除首次挂载，启动即滚到「最近打开」卡片。**定案 = 只在键盘导航真正移动选中项时才滚**。
- 28 工程管理页面文案整改与去冗余（chore，resolved）：移除头部冗余 hint（`projects.newHint`/`coverHint` 及新增谱面两处小字提示），统一精炼新建 4 项入口及说明（复制工程、曲库导入音频封面等），官方选曲改「搜索曲名或乐队」，全站工程文案彻底去 Bestdori 化。
- 29 工程管理页启动先闪 0 工程空态、再被真实列表替换（bug，resolved）：**「未就绪」与「空」混用同一 state 值 `[]`** 且无加载态 → 首帧必落空态分支。改成 `projects: ChartProject[] | null` + `ready` 区分三态（未就绪渲染等高占位，微光走 `SLOW_LOADING_MS`）+ `ChartProjectStore.list()` 进行中去重 + Provider 挂载预载目录。4 条锁测均验过「撤下修复即红」。`listProjects` 封面串行读并发化仍未做。
- 31 relTime 增「N 分钟前」档（feature，resolved 2026-10-14）：「刚刚」收缩到 <1 分钟 + 1–59 分钟显示「N 分钟前」，其余三档边界不动（四档变五档），补 10 条边界锁测；`lastOpened` 语义维持现状（创建/复制也算打开）——该字段兼排序键与启动恢复锚，拆 created/opened 撞未结论的 24。
- 32 详情页撤「复制工程」常驻钮（chore，resolved 2026-10-14）：复制收敛为 hub 两处（卡片 ⋯ 菜单 + 新建弹窗），详情页动作行收缩为 打开/编辑/删除；`ProjectCreateCopyLanding` 两条复制锁测改走 hub 卡片菜单，动画用例「不重挂载」断言经用户确认改锁 forward/非 back（hub→detail 合法换包裹层；不重挂载由 `ProjectsViewTransition` 左栏切换锁定），并补「详情页无复制钮 / hub 菜单仍有」防回潮断言。
- 33 音频资源异常（被替换 / 被删除）的检测与对齐（feature，resolved 2026-10-14）：记录与音频字节零绑定；两信号——替换 = 解码落地后比时长（0.5s 容差，落地信号 = `AudioSession` 快照新增的 `audioLoadGeneration`，同时长替换/切工程不漏检），丢失 = 半态判定 `audioName≠null && audioBlob=null`（免费）；工作台 hydrate 路径检出，同族横幅双动作（替换：realign 写时长 + `source` 转 custom；丢失：带作用域重新导入 / force 清除记录翻 custom）；修复写不走锁闸（记录对齐 ≠ 换音频，与 ADR-0015「入口只此一处」字面冲突已显式记录，措辞收敛待拍板）；同时长/重编码替换仍检测不到，`cover.bin` 同病无廉价信号不做。
- 34 i18n 时间档英文单复数（bug，resolved 2026-10-14）：四计数档迁 `tPlural`（键拆 `.one`/`.other`、变量 `{{n}}`→`{{count}}`，en 得 "1 minute ago"）；tag 映射改 `PLURAL_TAGS` 数据驱动 + parity 锁测（每语言按自己的 PluralRules 查键、四时间档防空转守卫）——为计划中的日语铺路，加语言漏配映射编译红、缺键测试红。
- 35 lastModified 戳机口径与两个时间戳定义（bug，resolved 2026-10-14）：谱面行「N 分钟前」实际是「上次落盘」不是「上次编辑」——不改音符的时长/音频同步、切 tab flush 也重戳，还污染「最近修改」排序键；改成条件戳：新增 `chartModifiedStamp.ts`（`stampChartModified`，记录内容级深比较，notes/保真真变才戳 `Date.now()`），hook 经它落盘；`lastOpened`/`lastModified` 两字段定义立档 CONTEXT.md（模型无「谱面打开时间」，「打开时间=最近打开谱面时间」在存储里无法求值）。
- 36 relTime 定时刷新（feature，resolved 2026-10-14）：分钟档让「N 分钟前」的静止感显形——纯函数渲染时求值、两页无 tick；落地单一共享 ticker（`NowProvider` + `useNow`，30s 一跳，挂 `ProviderTree` 最内层），hub/详情 5 处 `relTime` 显式传注入 now，工程两页零自建定时器（静态锁根因侧）。
- 37 列表时间戳跟随排序键（feature，resolved 2026-10-15）：**定了**：hub 卡片 / hero / 详情左栏的工程时间戳跟随排序键（`lastModified` → 派生修改时间，其余键 → `lastOpened`）并贴短标签（打开 / 修改），hero 标签随之切换；两个时间键都保留——删键否决（`lastModified` 是 35 刚修好的戳机，`lastOpened` 是 hero 选中锚与工作台恢复锚）。**落地**：`projectSort.projectTimeAt(project, key)` 纯函数 + `projectFormat.projectTimeTag` 短标签，hub hero/卡片与详情左栏（`sort` prop 同源 `settings.projects.sort`）共用；锁测三件（单测四键 / DOM 标签与 hero 切换 / 静态断言防回溜写死 `p.lastOpened`）。
- 38 回工程页时列表不重读（bug，**resolved 2026-10-15，同日复验补根因修复**）：工作台编辑后回工程页，音符数还是上次编辑后的——保活页只认 catalogEpoch、防抖落盘不通知目录、切页不 flush 不重读，晚一次导航；**落地**：`ProjectsPage` 收 `active` prop + 激活 effect（`false→true` 先 `flushPersist` 再 `reload`，照 `usePreviewScope`/`useAudioScope` 范式；hub 卡片与详情谱面行同出 `projects` state，一处修两边）。**复验发现首修不完整**：激活 effect 的 `flushPersist()` 打到空注册柄——React 一个 commit 内先 cleanup 后 setup、setup 按树序（projects 在 workspace 之前），而工作台每次渲染换新 `persistNow` 闭包使注册 effect 反复 cleanup→setup，导航提交里注册柄被清空后激活 effect 先跑、重注册又晚于它（预览/音频页没踩到只因树序排在工作台之后）。二修：hook 的 `saveNow`/返回值求稳（churn 根因）+ WorkspacePage 注册改 ref 包装挂载一次。锁测与真机验收记账见票内 Comments。
- [30 编辑工程信息曲目归属改只读与LLSIF下线](./issues/30-编辑工程信息曲目归属改只读与LLSIF下线.md)（grilling，**resolved 2026-10-13**）：推演剥离“换源”伪需求（不换音频谱面脱节、换了等于新建）；**定了**：① 彻底取消编辑弹窗中修改曲目归属/换源能力，曲目归属是工程创建时的出生属性；② 弹窗内改用轻量只读徽标展示（官方曲显示 `BanG Dream 官方曲 (#ID)`、自定义显示 `自定义曲目`，删除 select 与 sourceId 输入框）；③ 彻底下线 LLSIF，反序列化遇旧值平滑归一 custom；④ 换封面/工程名/歌手完整保留，换音频保留在音频页（换后自动改归属 custom）；⑤ 导入谱面收敛于工程详情页谱面列表区（后续另开票，开在本图）。
- [39 切换数据目录后工程管理页未即时刷新](./issues/39-切换数据目录后工程管理页未即时刷新.md)（bug，**resolved 2026-10-15**）：切根成功即联动（带路径守卫，「打开数据目录」不触发）——`notifyCatalogChanged()` 递增 `catalogEpoch` 让所有目录消费者即时刷新（不依赖导航时序，38 盖住的那层留着）；旧工程不在新目录 → `reset()` 会话（与 notify 同批，工作台进飞防抖再无旧根内容可写进新目录，38 激活 flush 的反向污染由此防住）；单例失效 = `BackgroundSkinStore.reload()`（新方法，幂等闸关不掉、旧 URL 装载完成后回收）+ `cacheStats` 重拉；`ChartProjectStore.resetCatalogCaches()`（新方法）作废 `lastOpenedFloor`/`coverInstances`——新旧目录同 id 工程不再漏旧根的 Blob 身份与时间戳（单测含漏值现象复现）。锁测：DOM 六条 + 单测十二例 + 六种破坏验红；`tsc -b` 净、全量 3326 绿；真机验收待补。
- [40 横幅锚：跟随排序键 + 打开工程后不滞留老工程](./issues/40-横幅锚跟随排序与最近打开.md)（grilling → **resolved 2026-10-18**）：**定了**——① 横幅锚 = 排序头**活派生**：`lastOpened` → 最近打开、`lastModified` → 最近修改，`chartCount`/`name` 回落最近打开（与 `projectTimeAt` 同源，并列按 id 是有意为之：锚须确定且 = 展示序的头）；② 方向键手动浏览焦点是**临时覆盖**——排序切换 / 打开工程清空回落排序头，编辑与切页回来不动它（issue 14 Q10 的「横幅 = 选中投影」在浏览期间保持）；③ 眉题「继续创作」不动。**落地**：`projectSort.sortAnchorId` 纯函数 + hub 撤锚快照 effect + `openProject` 包装打开出口 + 排序切换 render 期校正。锁测与门禁数字见票内。
- [42 Windows 覆盖 cover.bin 时 rename EPERM](./issues/42-Windows覆盖cover.bin时rename-EPERM.md)（bug，resolved 2026-10-25）—— **改成什么** = `renameOver` 在 Win32 EPERM 时重试替换；封面/音频原子写与缓存拷贝共用。
- 41 谱面状态徽标就地状态菜单（grilling，**定案 2026-10-18 用户拍板；实现 open**）：**定了**——详情页撤独立「标为完成」文字按钮，`StatusBadge` 点开**垂直小菜单**（复用 `Menu`+`ProjectMenuItem`，当前态 ✓）就地切「未完成/已完成」；已上传徽标 inert；hub hero / 切换器下拉行 / 预览页行内徽标一律只读（组件加 `interactive` 默认 false）；**工作台菜单项删除、全局唯一入口收敛到详情页**（显式覆盖票 06「两处都能标/撤」，用户频率论证）；切换不加确认；新增 `projects.statusEdit`、清理四组 markComplete i18n key。

路线（2026-09-26 规划）：

1. ~~并行：02 存储模型 ‖ UI prototype~~ 原型已接受并随 04/05 落地删除。
2. ~~**02 歌曲级工程存储模型**~~（resolved）。
3. ~~**03 启动落点与当前工程**~~（resolved）：`CurrentProjectSession` + persistence 按当前工程 flush/load，切工程不再走固定 `workspace` id。
4. ~~并行：04 工程管理页（按原型 D）‖ 05 谱面切换与复制谱面（按原型 B）~~（resolved）。
5. 06 谱面状态与已上传只读（上传记录先手工注入测试）。
6. ~~**22 页面作用域机制 ‖ 15 音频归属谱面工程**~~（resolved，09-28 同一笔）：作用域机制 + 壳接口 + 作用域条组件；音频页成为工程音频的唯一管理入口（写路径按 projectId 参数化）。原型定案 A 落地后删除。
7. ~~**23 工程详情页验收批次**~~（09-28 落地）：创建/复制落点、可拖拽分栏、头部布局、左栏 ↑↓；原型定案 A 落地后删除。收尾真渲染又补修了谱面行的同病症。
8. **24 当前工程语义 grill** —— 23 已落地，可开场。
9. 本地图外：bestdori-integration 网络 IPC → 上传实现（写入上传记录）；解阻 07。basic-editor 164 片段收藏随时可独立 grill。

## Fog

- 07 的具体交互（选曲 / 选帖界面、下载音频封面的缓存位置、官方谱导入哪些难度）待 07 grill。
- 上传入口的具体 UI 等 bestdori-integration 开实现票时一起定。
- 24 的结论形状未知：可能是「当前工程」概念收敛（徽标降级为一句说明）、也可能是显式「设为当前工程」动作；与票 22 的"作用域 vs 当前"两个词的分工要在那里再校一遍。
