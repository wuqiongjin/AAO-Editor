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
  it('导出档是常量：面板高 537 / dpr 2 / 缩放 100%', () => {
    expect(exportSrc).toMatch(/EXPORT_PANEL_H\s*=\s*537/);
    expect(exportSrc).toMatch(/EXPORT_DPR\s*=\s*2/);
    expect(exportSrc).toMatch(/EXPORT_ZOOM\s*=\s*1/);
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

  it('全屏预览：舞台进全屏 + 全屏后控件搬进预览区（仍可缩放）', () => {
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/requestFullscreen/);
    expect(page).toMatch(/fullscreenchange/);
    expect(page).toMatch(/preview-fs/);
    // 全屏与否都不能少掉这排控件（页面工具栏一份、全屏浮层一份，同一个组件）
    expect(page.match(/<PreviewStaticToolbar/g)?.length).toBe(2);
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
