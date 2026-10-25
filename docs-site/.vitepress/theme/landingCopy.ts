/**
 * 落地页文案：中文 / 英文两套，英文不是直译，按同一语气重写。
 *
 * 允许内联 HTML 的键（`heroAudience` / `heroMain` / `heroLede` / `cap*b*`）在模板里走 v-html，
 * 用来给关键词上色：
 * - `.hi`      人称按序号套色（`--c1…--c6`）+ 同色柔光
 * - `.hl`      主强调色（天蓝）
 * - `.hl-grad` 蓝→品红渐变字，只给首屏主标题
 *
 * 章节小标题（eyebrow / kicker / capNum / trust* / cueDown）也走 i18n，
 * 中文下不再混着 "FEATURES" 这类英文大写标签。
 */
export type Locale = 'zh-CN' | 'en'

const zh = {
  brandSub: 'BanG Dream! 自制谱编辑器',
  navFeatures: '功能特性',
  navDownload: '下载',
  navGuide: '文档',
  ctaDownload: '下载桌面版',
  ctaTry: '在线试用',
  ctaNoteLabel: '桌面安装包',
  themeToDark: '切换到深色外观',
  themeToLight: '切换到浅色外观',
  eyebrow: '自制谱编辑器',
  /* 首屏受众轮换：`|` 分隔，模板拆成数组逐条换。
     六条是六种画像（新手 → 爱好者 → 手感派 → 观赏谱 → 高产 → 你），不是同义改写。
     每条的人称用 `<b class="hi">` 包起来，按序号套 `--c1…--c6` 六种强调色。 */
  heroAudience:
    '初次尝试制谱的<b class="hi">音游玩家</b>|乐此不疲的<b class="hi">自制谱作者</b>|追求极致手感的<b class="hi">邦邦谱师</b>|天马行空的<b class="hi">观赏谱设计者</b>|掌控专业工作流的<b class="hi">高产谱师</b>|每一个想用节拍点亮舞台的<b class="hi">你</b>',
  leadPre: '为 ',
  leadPost: '打造的',
  heroLeadSr: '为自制谱作者打造的',
  heroMain: '桌面级<span class="hl-grad">谱面编辑器</span>',
  heroLede:
    '从工程管理、谱面编辑、预览试听，到谱面图与谱面视频导出，<b class="hl">全程都在一个应用里完成</b>。',
  heroShotCap: '工程启动台 — 一首歌，一个工程',
  kickerFeatures: '功能特性',
  featuresTitle: '制谱的每一步，都在一个应用里',
  featuresSub: '从空白工程到社区发布，中间不需第二款软件。',
  capNum01: '01 / 工程管理',
  cap01Title: '谱面工程管理',
  cap01b1: '<b>一首歌，一个工程</b>：全部难度、音频与封面集中一处，进度与发布状态自动标记',
  cap01b2: '<b>从任何起点开始</b>：空白新建、复制现有工程、从官方曲库取谱、导入社区现有谱面',
  cap01b3: '<b>Bestdori 社区集成</b>：应用内浏览曲库、登录账号，完成的谱面一键发布',
  cap01Shot1Cap: '从官方曲库创建工程',
  cap01Shot2Cap: '工程详情 — 多难度谱面',
  cap01Shot3Cap: '工程启动台 — 四路新建',
  capNum02: '02 / 编辑',
  cap02Title: '专业谱面编辑',
  cap02b1:
    '<b>与 Bestdori 制谱器无缝衔接</b>：键位布局与操作口径沿用社区习惯，谱面代码与社区格式一致，换过来不必重新上手',
  cap02b2: '<b>滑条深度编辑</b>与<b>曲线滑条绘制</b>：以轨迹直接绘出弯带，结点增删、拆条、镜像一应俱全',
  cap02b3: '<b>拖动编辑</b>：音符沿节拍线拖动、曲线沿轨迹拖动，框选一组后整体位移校正',
  cap02b4: '<b>快捷键全自定义</b>：每个功能恰好绑定一个键，冲突时直接拒绝，改完即刻生效',
  cap02ShotCap: '工作台 — 编辑与放置',
  demoLabel: '操作演示',
  gif1Cap: '放置滑条',
  gif2Cap: 'SP 曲线与画笔',
  capNum03: '03 / 预览与导出',
  cap03Title: '谱面预览与导出',
  cap03b1: '<b>静态预览</b>：整首谱面铺为长图，缩放连续可调，结构与疏密一览无余',
  cap03b2: '<b>动态预览</b>：在仿真场中完整回放，音符、特效与 combo 与实机一致',
  cap03b3: '<b>谱面图导出</b>：整谱长图带曲目信息头，直接用于社区发布',
  cap03b4: '<b>预览视频导出</b>：仿真场回放逐帧渲染为视频，直接用于视频平台',
  cap03Shot1Cap: '静态预览',
  cap03Shot2Cap: '仿真场回放',
  cap03Shot3Cap: '谱面图导出',
  trustLocal: '本地优先',
  trustLocalD: '工程与设置只存本机，不经过任何业务服务器。',
  trustNoTel: '无遥测',
  trustNoTelD: '排障靠应用内诊断包：版本 / 环境 / 日志 / 操作轨迹。',
  trustPort: '便携迁移',
  trustPortD: '设置可导入导出，换机迁移一个 JSON。',
  kickerDownload: '下载',
  downloadTitle: '下载 AAO Editor',
  dlTagPrimary: '主入口',
  dlTagMirror: '国内优选',
  dlGhP1: '安装包首发渠道，三平台齐发。',
  dlGhBtn: '前往 GitHub Releases',
  dlCnbP1: '国内网络下载同一批安装包，自动同步、略晚于 GitHub。',
  dlCnbBtn: '前往 CNB Releases',
  footTitle: '非官方声明',
  footLead:
    'AAO Editor 是一款非营利的粉丝自制工具，与 Bushiroad、Craft Egg 及 BanG Dream! 项目官方无任何关联，亦未获其背书。',
  footAssets:
    '应用内的音符皮肤、键音等游戏素材版权归 © BanG Dream! Project 所有；本仓库代码以 MIT 许可发布，仅覆盖 AAO Editor 自身代码，不覆盖上述素材。',
  footReport1: '如认为本仓库内容侵犯了您的权益，请通过 ',
  footReport2: ' 联系处理。',
  footGuide: '使用文档',
  footRepo: 'GitHub 仓库',
  footIssues: '问题反馈',
  cueDown: '向下滚动，看功能特性',
  lbAria: '图片查看',
  lbCloseAria: '关闭',
  carAria: '截图轮播',
  carPrevAria: '上一张',
  carNextAria: '下一张',
  carDot1: '第 1 张',
  carDot2: '第 2 张',
  carDot3: '第 3 张',
  altProjectHub: 'AAO Editor 工程启动台：最近工程列表与四种新建工程入口',
  altOfficialChart: '从官方曲库搜索、试听，并按难度一步创建工程',
  altProjectDetail: '工程详情：一首歌下的多难度谱面列表、封面与音频入口',
  altWorkspace: '谱面编辑工作台：节拍线上的音符与右侧属性面板',
  altPlaceSlide: '放置滑键的操作演示：从起点拖动到终点生成滑条',
  altCurveTool: '画笔绘制 SP 曲线的操作演示：沿轨迹实时采样自由段',
  altStaticPreview: '整首谱面的静态预览：竖切成面板横向排开，缩放连续可调',
  altSimulation: '仿真场回放：音符、打击特效与 combo 数字',
  altSheetExport: '导出的谱面图：带头带曲目信息的长图',
  docDesc:
    'AAO Editor 是一款为 BanG Dream! 自制谱作者打造的桌面级谱面编辑器：工程管理、谱面编辑、预览导出与 Bestdori 社区互通，制谱的每一步都在一个应用里完成。',
} as const

const en: Record<keyof typeof zh, string> = {
  brandSub: 'Chart editor for BanG Dream!',
  navFeatures: 'Features',
  navDownload: 'Download',
  navGuide: 'Docs',
  ctaDownload: 'Download for desktop',
  ctaTry: 'Try online',
  ctaNoteLabel: 'Desktop builds',
  themeToDark: 'Switch to dark appearance',
  themeToLight: 'Switch to light appearance',
  eyebrow: 'CUSTOM CHART EDITOR',
  heroAudience:
    'first-time <b class="hi">rhythm gamers</b>|tireless <b class="hi">chart authors</b>|BanG Dream! <b class="hi">charters</b> chasing feel|free-spirited <b class="hi">showcase designers</b>|workflow-first <b class="hi">pro charters</b>|<b class="hi">you</b>, lighting the stage',
  leadPre: 'Built for ',
  leadPost: '',
  heroLeadSr: 'Built for chart authors',
  heroMain: 'A desktop <span class="hl-grad">chart editor</span>',
  heroLede:
    'Project management, chart editing, preview and export — <b class="hl">all of it in one app</b>.',
  heroShotCap: 'Project hub — one project per song',
  kickerFeatures: 'FEATURES',
  featuresTitle: 'Every step of charting, in one app',
  featuresSub: 'From a blank project to a community release, without a second tool.',
  capNum01: '01 / PROJECT',
  cap01Title: 'Chart project management',
  cap01b1:
    '<b>One song, one project</b> — every difficulty, audio and cover in one place, with progress and release state tracked for you',
  cap01b2:
    '<b>Start from anywhere</b>: blank, a copied project, an official chart, or one imported from the community',
  cap01b3: '<b>Bestdori integration</b>: browse the library and sign in inside the app, then publish a finished chart in one click',
  cap01Shot1Cap: 'Create from the official library',
  cap01Shot2Cap: 'Project detail — every difficulty',
  cap01Shot3Cap: 'Project hub — four ways to start',
  capNum02: '02 / EDIT',
  cap02Title: 'Professional chart editing',
  cap02b1:
    '<b>Seamless with the Bestdori editor</b>: the same keys and conventions you already know, and chart code in the same community format',
  cap02b2:
    '<b>Deep slide editing</b> and a <b>curve brush</b>: draw a bend along its path, then add or remove joints, split and mirror',
  cap02b3: '<b>Drag to edit</b>: drag notes along the beat grid, drag curves along their path, or move a whole selection at once',
  cap02b4: '<b>Fully remappable shortcuts</b>: one key per action, conflicts rejected, applied the moment you change them',
  cap02ShotCap: 'Workspace — edit & place',
  demoLabel: 'Live demo',
  gif1Cap: 'Placing a slide',
  gif2Cap: 'SP curves & brush',
  capNum03: '03 / PREVIEW & EXPORT',
  cap03Title: 'Preview & export',
  cap03b1: '<b>Static preview</b>: the whole chart laid out as one sheet, with continuous zoom',
  cap03b2: '<b>Live preview</b>: a full replay on the simulation stage, matching in-game notes, effects and combo',
  cap03b3: '<b>Chart image export</b>: the whole chart as one long image with a song-info header, ready for community posts',
  cap03b4: '<b>Preview video export</b>: simulation replay rendered frame by frame into a video for video platforms',
  cap03Shot1Cap: 'Static preview',
  cap03Shot2Cap: 'Simulation replay',
  cap03Shot3Cap: 'Chart image',
  trustLocal: 'LOCAL-FIRST',
  trustLocalD: 'Projects and settings stay on your machine — no app servers.',
  trustNoTel: 'NO TELEMETRY',
  trustNoTelD: 'Troubleshoot with in-app diagnostic bundles: version, environment, logs, actions.',
  trustPort: 'PORTABLE',
  trustPortD: 'Export and import settings; move machines with a single JSON file.',
  kickerDownload: 'DOWNLOAD',
  downloadTitle: 'Download AAO Editor',
  dlTagPrimary: 'Primary',
  dlTagMirror: 'Mirror',
  dlGhP1: 'First release channel, with builds for all three platforms.',
  dlGhBtn: 'Go to GitHub Releases',
  dlCnbP1: 'The same installers for networks in China; synced automatically, slightly later than GitHub.',
  dlCnbBtn: 'Go to CNB Releases',
  footTitle: 'Unofficial disclaimer',
  footLead:
    'AAO Editor is a non-profit fan-made tool. It is not affiliated with, or endorsed by, Bushiroad, Craft Egg, or the BanG Dream! project.',
  footAssets:
    'In-game assets such as note skins and keysounds are © BanG Dream! Project; the repository’s MIT license covers only AAO Editor’s own code, not those assets.',
  footReport1: 'If you believe any content here infringes your rights, please contact us via ',
  footReport2: '.',
  footGuide: 'Documentation',
  footRepo: 'GitHub repo',
  footIssues: 'Report an issue',
  cueDown: 'Scroll down to features',
  lbAria: 'Image viewer',
  lbCloseAria: 'Close',
  carAria: 'Screenshot carousel',
  carPrevAria: 'Previous',
  carNextAria: 'Next',
  carDot1: 'Slide 1',
  carDot2: 'Slide 2',
  carDot3: 'Slide 3',
  altProjectHub: 'AAO Editor project hub: recent projects and four ways to start a new one',
  altOfficialChart: 'Search and audition in the official library, then create a project by difficulty',
  altProjectDetail: 'Project detail: chart list for one song with cover and audio entry',
  altWorkspace: 'Chart editing workspace: notes on the beat grid with the properties panel',
  altPlaceSlide: 'Demo of placing a slide: drag from start to end point',
  altCurveTool: 'Demo of drawing an SP curve with the brush: live sampling along the path',
  altStaticPreview: 'Static preview of a whole chart: sliced into panels, continuous zoom',
  altSimulation: 'Simulation replay: notes, hit effects and combo numbers',
  altSheetExport: 'Exported chart image with a song-info header',
  docDesc:
    'AAO Editor is a desktop chart editor for BanG Dream! custom chart creators: project management, chart editing, preview and export, plus Bestdori integration — every step of charting in one app.',
}

export const COPY: Record<Locale, Record<keyof typeof zh, string>> = { 'zh-CN': zh, en }

/** 一条文案的键；模板里按序号取键（`carDot1`、`cap02b3` 这类）时用它收窄类型。 */
export type CopyKey = keyof typeof zh

/**
 * 按前缀顺序收集能力块的要点（`cap01b1 / b2 / b3 …`），到第一个不存在的编号为止——
 * 加一条要点只改文案，模板不用动。
 */
export function bulletsOf(t: Record<CopyKey, string>, prefix: 'cap01' | 'cap02' | 'cap03'): string[] {
  const out: string[] = []
  for (let i = 1; ; i += 1) {
    const value = t[`${prefix}b${i}` as CopyKey]
    if (value === undefined) break
    out.push(value)
  }
  return out
}
