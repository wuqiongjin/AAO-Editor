// chart-preview 03 落点锁：宽图导出的**接线事实**（DOM 测不到的那些）。
// 手法照 ChartCodeExportSaveAs.test.ts：读源码做字符串断言（preload / main / 渲染侧桥 / 降级分支），
// 外加两条本票特有的口径锁：色值一律走 token、导出不读窗口。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

const preloadSrc = readStripped('electron/preload.js');
const mainSrc = readStripped('electron/main.cjs');
const saveBinarySrc = readStripped('src/preview/static/saveBinary.ts');
const exportSrc = readStripped('src/preview/static/exportPanels.ts');
const viewSrc = readStripped('src/preview/static/StaticPreviewView.tsx');
const toolbarSrc = readStripped('src/pages/preview/PreviewStaticToolbar.tsx');
const pageCss = readStripped('src/pages/preview/PreviewPage.css');
const viewCss = readStripped('src/preview/static/StaticPreviewView.css');
/** hex 色值或 rgb/rgba()/hsl —— 样式里出现任何一个都说明色值绕过 token 了 */
const HARD_CODED_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;

describe('chart-preview 03 · 二进制另存通道（preload → main）', () => {
  it('preload 暴露 preview.saveBinary，走 preview:saveBinary 通道', () => {
    expect(preloadSrc).toMatch(/preview\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]preview:saveBinary['"]/);
  });

  it('main 注册 preview:saveBinary：弹保存对话框 + 写字节，defaultPath 只用 basename', () => {
    expect(mainSrc).toMatch(/ipcMain\.handle\(\s*['"]preview:saveBinary['"]/);
    expect(mainSrc).toMatch(/dialog\.showSaveDialog/);
    expect(mainSrc).toMatch(/path\.basename\(/);
    expect(mainSrc).toMatch(/fs\.promises\.writeFile\(result\.filePath/);
    // 二进制载荷的类型闸（照 backgroundSkin:put 先例）：不是 Uint8Array 直接拒
    const handler = mainSrc.slice(mainSrc.indexOf("preview:saveBinary"));
    expect(handler).toMatch(/bytes instanceof Uint8Array/);
    expect(handler).toMatch(/Buffer\.from\(bytes\)/);
  });

  it('取消对话框 = 正常返回值，不当异常抛', () => {
    const handler = mainSrc.slice(mainSrc.indexOf("preview:saveBinary"));
    expect(handler).toMatch(/cancelled:\s*true/);
    expect(handler).toMatch(/cancelled:\s*false/);
  });

  it('渲染侧的类型闸：收 Uint8Array + 建议文件名 + mime', () => {
    expect(saveBinarySrc).toMatch(/bytes:\s*Uint8Array/);
    expect(saveBinarySrc).toMatch(/suggestedName:\s*string/);
    expect(saveBinarySrc).toMatch(/mime:\s*string/);
    // 桥的形状在本模块自己声明（本仓惯例：无集中 d.ts）
    expect(saveBinarySrc).toMatch(/electronAPI/);
  });

  it('浏览器降级：Blob + <a download>（照 exportChartCode 先例）', () => {
    expect(saveBinarySrc).toMatch(/new Blob\(/);
    expect(saveBinarySrc).toMatch(/createObjectURL/);
    expect(saveBinarySrc).toMatch(/revokeObjectURL/);
    expect(saveBinarySrc).toMatch(/a\.download\s*=/);
  });
});

describe('chart-preview 03 · 导出与预览解耦（固定档、不读窗口）', () => {
  it('导出档是常量：面板高 3,222 / dpr 2 / 生效缩放 0.74（面板 289，与预览基准解耦）', () => {
    // 宽 289 值来自 issue 13 实测（805 张：85% 单行、0 拒绝）；高 3,222 是 issue 14 定案（2026-10-06，
    // = 6 × 537），复跑实测 100% 单行、0 拒绝、仅最长 715.3s 一条降密度——改档必须重跑实测。
    expect(exportSrc).toMatch(/EXPORT_PANEL_H\s*=\s*3222/);
    expect(exportSrc).toMatch(/EXPORT_DPR\s*=\s*2/);
    expect(exportSrc).toMatch(/EXPORT_ES\s*=\s*0\.74/);
    // 不跟预览基准走：导出面板宽不能随 PREVIEW_ES_STANDARD（2026-10-02 重定基）一起漂移
    //（可以"取"预览默认档当日的数当值，但必须是字面量、不能是引用——2026-10-05 加大后这条照旧）
    expect(exportSrc).not.toMatch(/esForZoom|PREVIEW_ES_STANDARD/);
  });

  it('导出不读 window（devicePixelRatio / 窗口尺寸）：dpr 只从固定档与显式入参来', () => {
    expect(exportSrc).not.toMatch(/devicePixelRatio/);
    expect(exportSrc).not.toMatch(/resolveCanvasDpr/);
    expect(exportSrc).not.toMatch(/window\.inner/);
    expect(exportSrc).not.toMatch(/clientHeight|clientWidth/);
  });

  it('导出只走 panelPainter（同一份面板模型），不新开第二种画笔', () => {
    expect(exportSrc).toMatch(/createPanelPainter/);
    expect(exportSrc).toMatch(/planSheetExport/);
    expect(exportSrc).toMatch(/sheetCellRect/);
  });

  it('画面把指针交给同一渲染入口（hover 读数由渲染域画，不另写一份）', () => {
    const painterSrc = readStripped('src/preview/static/panelPainter.ts');
    expect(viewSrc).toMatch(/from '\.\/panelPainter'/);
    expect(viewSrc).toMatch(/painter\.blitInto\(/);
    expect(viewSrc).toMatch(/hovering\?\.panel === panelIndex \? \{ cx: 0, cy: hovering\.cy \}/);
    // 出图器把它原样填进 FrameView（横线与两侧读数由渲染域的 renderHoverInfo 画）
    expect(painterSrc).toMatch(/hoverPos: hover/);
    expect(painterSrc).toMatch(/from '\.\.\/\.\.\/rendering'/);
  });

  it('页面装配走预览域 barrel，不直接摸 static/ 内部文件', () => {
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/from '\.\.\/\.\.\/preview'/);
    expect(page).not.toMatch(/from '\.\.\/\.\.\/preview\/static/);
  });
});

describe('chart-preview 03 · 预览页样式一律走 token', () => {
  it.each([
    ['preview/StaticPreviewView.css', viewCss],
    ['preview/PreviewPage.css', pageCss],
    ['preview/PreviewStaticToolbar.tsx', toolbarSrc],
  ])('%s 里没有一个硬编码色值', (_name, src) => {
    expect(src).not.toMatch(HARD_CODED_COLOR);
  });

  it('扫描没扫空（免得文件改名后静默放行）', () => {
    expect(viewCss.length).toBeGreaterThan(200);
    expect(pageCss.length).toBeGreaterThan(500);
    expect(toolbarSrc.length).toBeGreaterThan(500);
  });
});

describe('chart-preview 03 · 预览页消费静态形态', () => {
  it('静态模式把 StaticPreviewView 放进舞台、把控件注入工具栏行', () => {
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/<StaticPreviewView/);
    expect(page).toMatch(/<PreviewStaticToolbar/);
    expect(page).toMatch(/mode === 'static'/);
    // 没音符时不装样子：走空态文案
    expect(page).toMatch(/preview\.static\.empty/);
  });

  it('源码层面留个把手：页面不自己算面板（排布数学在 preview/static，页面只调 planSheet）', () => {
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/planSheet\(/);
    expect(page).not.toMatch(/panelH\s*\/\s*es/);
    expect(page).not.toMatch(/panelH\s*:/);
  });

  it('原生 select / checkbox 不是预览工具栏的形态（滑杆 + 图标钮）', () => {
    expect(toolbarSrc).not.toMatch(/<select/);
    expect(toolbarSrc).not.toMatch(/type="checkbox"/);
    expect(toolbarSrc).toMatch(/type="range"/);
    expect(toolbarSrc).toMatch(/PREVIEW_ZOOM_RANGE/);
    expect(toolbarSrc).toMatch(/IconButton/);
  });

  it('「起止线」开关已撤（130px 面板里那两条虚线读不出信息）', () => {
    // 显示档仍把 boundLines 定为精简（不画），但工具栏不再给用户这个开关
    expect(toolbarSrc).not.toMatch(/boundLines/);
    const profileSrc = readStripped('src/preview/static/displayProfile.ts');
    expect(profileSrc).toMatch(/boundLines:\s*false/);
  });

  it('全屏预览：舞台进全屏 + 全屏后只留一枚退出钮（issue 12）', () => {
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/requestFullscreen/);
    expect(page).toMatch(/fullscreenchange/);
    expect(page).toMatch(/preview-fs/);
    // 这一排控件只剩页面工具栏一份：全屏浮层不再整体挂它（2026-10-05 定案：太长、压画面）
    expect(page.match(/<PreviewStaticToolbar/g)?.length).toBe(1);
    expect(page).toMatch(/<PreviewExitFullscreenButton/);
  });

  it('滚轮接缝：预览区内拦下默认行为（横滚 + Ctrl/⌘ 缩放），缩放不改整页', () => {
    const viewSrcStripped = readStripped('src/preview/static/StaticPreviewView.tsx');
    expect(viewSrcStripped).toMatch(/addEventListener\(\s*'wheel'/);
    expect(viewSrcStripped).toMatch(/passive:\s*false/);
    expect(viewSrcStripped).toMatch(/preventDefault\(\)/);
    expect(viewSrcStripped).toMatch(/ctrlKey \|\| event\.metaKey/);
  });

  it('原型壳已撤（不再有独立预览原型入口）', () => {
    expect(readSource('src/App.tsx')).not.toMatch(/StaticPreviewPrototype/);
  });
});

// ---------------------------------------------------------------- chart-preview 16

describe('chart-preview 16 · 导出按钮即时反馈（先画「导出中」再开干 + 逐块让出）', () => {
  it('页面顺序：setExporting(true) → 等这一帧真画出来 → 才开导出', () => {
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    const mark = page.indexOf('setExporting(true)');
    const wait = page.indexOf('await waitForPaint()');
    const start = page.indexOf('await exportSheetAs(');
    expect(mark).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(mark);
    expect(start).toBeGreaterThan(wait);
  });

  it('出图循环逐块让出：blit 之后按块边界 await，格子算法与出图顺序原样', () => {
    expect(exportSrc).toMatch(/for \(let k = 0; k < layout\.panelCount; k\+\+\) \{/);
    expect(exportSrc).toMatch(/const cell = sheetCellRect\(plan, k\);/);
    expect(exportSrc).toMatch(/painter\.blitInto\(k, ctx, cell\.x, cell\.y\);/);
    expect(exportSrc).toMatch(/if \(\(k \+ 1\) % EXPORT_PANEL_CHUNK === 0\) await yieldToMainThread\(\);/);
  });

  it('让出原语：scheduler.yield 优先 / setTimeout 0 降级；等绘制 = rAF + 帧后宏任务', () => {
    expect(exportSrc).toMatch(/scheduler\?\.yield/);
    expect(exportSrc).toMatch(/scheduler\.yield\(\)/);
    expect(exportSrc).toMatch(/new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\)/);
    expect(exportSrc).toMatch(/requestAnimationFrame\(\(\) => setTimeout\(resolve, 0\)\)/);
  });

  it('waitForPaint 走两个 barrel 出到页面（页面不直摸 static/ 内部）', () => {
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/waitForPaint/);
    expect(page).not.toMatch(/from '\.\.\/\.\.\/preview\/static/);
    expect(readStripped('src/preview/static/index.ts')).toMatch(/\bwaitForPaint,/);
    expect(readStripped('src/preview/index.ts')).toMatch(/\bwaitForPaint,/);
  });
});

// ---------------------------------------------------------------- chart-preview 14

describe('chart-preview 14 · 导出图文版头带（封面区 + 信息区 + 谱面区）', () => {
  const sheetHeaderSrc = readStripped('src/preview/static/sheetHeader.ts');
  const panelLayoutSrc = readStripped('src/preview/static/panelLayout.ts');
  const pageSrc = readStripped('src/pages/preview/PreviewPage.tsx');
  const displayPanelSrc = readStripped('src/pages/preview/PreviewDisplayPanel.tsx');
  const appSettingsSrc = readStripped('src/chart/config/AppSettings.ts');

  it('头带高 440 是常量真源（= 392 封面 + 上下各 24）；改它必须同步复算宽图面积上限', () => {
    expect(sheetHeaderSrc).toMatch(/EXPORT_HEADER_H\s*=\s*440/);
  });

  it('头带高开关说了算：planSheet 把 headerH 交给排布，关掉就是 0（纯面板宽图）', () => {
    expect(exportSrc).toMatch(/function exportHeaderHeight\(headerEnabled: boolean\): number/);
    expect(exportSrc).toMatch(/headerEnabled \? EXPORT_HEADER_H : 0/);
    expect(exportSrc).toMatch(/function planSheet\(\s*\n?\s*scene: PanelSceneInput,\s*\n?\s*headerEnabled: boolean,/);
    expect(exportSrc).toMatch(/planSheet\(scene, headerOn\)/);
    expect(exportSrc).toMatch(/headerH:\s*exportHeaderHeight\(headerEnabled\)/);
    expect(panelLayoutSrc).toMatch(/const sheetH = headerH \+ rows \* req\.panelH/);
    expect(panelLayoutSrc).toMatch(/y: plan\.headerH \+ row \* plan\.panelH/);
  });

  it('头带关掉时不解码封面、也不画它（解码和画同样省掉）', () => {
    expect(exportSrc).toMatch(/loadCoverImage\(headerOn \? req\.header\.cover : null\)/);
    expect(exportSrc).toMatch(/if \(headerOn\) \{/);
    expect(exportSrc).toMatch(/buildSheetHeaderModel\(req\.header\)/);
  });

  it('出图顺序：封面解码与皮肤图集并行 → 横带先画 → 逐面板；位图用完即释放', () => {
    const decode = exportSrc.indexOf('loadCoverImage(');
    const drawHeader = exportSrc.indexOf('drawSheetHeader(');
    const painter = exportSrc.indexOf('createPanelPainter(');
    expect(decode).toBeGreaterThan(-1);
    expect(exportSrc).toMatch(/Promise\.all\(/);
    expect(drawHeader).toBeGreaterThan(decode);
    expect(painter).toBeGreaterThan(drawHeader);
    expect(exportSrc).toMatch(/buildSheetHeaderModel\(req\.header\)/);
    expect(exportSrc).toMatch(/cover\?\.close\(\)/);
  });

  it('头带是独立图片：配色独立常量，不接 CSS 令牌（画布配色惯例）', () => {
    expect(sheetHeaderSrc).not.toMatch(/var\(--/);
    expect(sheetHeaderSrc).toMatch(/hsl\(/);   // 无封面走工程 id 色相占位块
  });

  it('preview 域不 import 工程域：封面色相等工程知识在页面算好传入', () => {
    expect(sheetHeaderSrc).not.toMatch(/from '\.\.\/\.\.\/project/);
    expect(exportSrc).not.toMatch(/from '\.\.\/\.\.\/project/);
    expect(pageSrc).toMatch(/projectCoverHue\(/);
    expect(exportSrc).toMatch(/coverHue:\s*req\.header\.coverHue/);
  });

  it('页面组装头带输入：字段口径全走现成函数（谱面标题 / 难度等级 / 时长 / 音符数 / BPM / 导出时刻）', () => {
    expect(pageSrc).toMatch(/const header: SheetHeaderInput = \{/);
    expect(pageSrc).toMatch(/fields:\s*settings\.export/);
    expect(pageSrc).toMatch(/exportedAt:\s*Date\.now\(\)/);
    expect(pageSrc).toMatch(/countChartNotes\(chart\.notes\)/);
    expect(pageSrc).toMatch(/getBpmEvents\(chart\.notes\)/);
    expect(pageSrc).toMatch(/cover:\s*project\?\.coverBlob \?\? null/);
    // 难度色由页面传入（DIFF_COLORS，与界面难度徽标同色）—— preview 域不 import 工程域，口径同 coverHue
    expect(pageSrc).toMatch(/difficultyColor:\s*DIFF_COLORS\[chart\.diff\]/);
    // 导出物跟着头带走：导出调用把 header 递下去
    expect(pageSrc).toMatch(/await exportSheetAs\(\{\s*scene,\s*header,/);
  });

  it('「导出信息」组落 settings.export（七字段开关 + 头带总开关；与 preview / display 分开）', () => {
    expect(appSettingsSrc).toMatch(/export:\s*ExportFieldSettings/);
    expect(appSettingsSrc).toMatch(/EXPORT_FIELD_KEYS/);
    expect(displayPanelSrc).toMatch(/EXPORT_FIELD_KEYS/);
    expect(displayPanelSrc).toMatch(/setExport\(\{ \[key\]: v \}\)/);
    // 总开关：挂组标题行右侧（2026-10-07 定案：不另立条目），七行跟着置灰但保留勾选
    expect(displayPanelSrc).toMatch(/pdp__group-head/);
    expect(displayPanelSrc).toMatch(/setExport\(\{ enabled: v \}\)/);
    expect(displayPanelSrc).toMatch(/disabled=\{!settings\.export\.enabled\}/);
    expect(readStripped('src/app/providers/ConfigProvider.tsx')).toMatch(/setExport/);
  });
});
