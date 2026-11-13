// 票 70 落点锁：静态预览「无编辑切回不重画 / 数据换代先盖骨架再分批出图」这条链路跨
// hook、页面、画面、样式和文案五处，DOM 测试各自只抓得到一段；这里按
// PreviewBinarySaveWiring.test.ts（票 16）的手法锁住源码接线，防止以后被无意拆散。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '@/tests/support/source';

const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('票 70 · 静态预览重画抑制与加载态的接线', () => {
  it('usePreviewScope：激活重读先做语义等价比较，内容没变不提交新 project', () => {
    const scope = read('src/pages/preview/usePreviewScope.ts');
    expect(scope).toContain('export function samePreviewProject');
    expect(scope).toContain('JSON.stringify(sa) === JSON.stringify(sb)');
    expect(scope).toContain('samePreviewValue(sa, sb)');
    // 不能退回编辑域的 notesEqual：它的音符类型表不认真实谱里的 `Directional`，
    // 会把「内容没变」误判成换代，每次激活又整批重画（票 70 探测时踩到过）
    expect(scope).not.toContain('notesEqual(');
    expect(scope).toMatch(/samePreviewProject\(prev\.project, scoped\)/);
    expect(scope).toContain('setDataVersion((v) => v + 1)');
    // 激活检测必须走 layout 阶段：否则骨架晚一帧，旧画布已经被画出来了
    expect(scope).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?setChecking\(true\)/);
    expect(scope).toContain('getProjectEditEpoch');
    expect(scope).toContain('optionsEpochRef');
    // 反向：不能退化成「每次读回来都直接 setLoaded({ project: scoped })」
    expect(scope).not.toMatch(/setLoaded\(\{\s*forId: scopeId, project: scoped\s*\}\)/);
  });

  it('StaticPreviewView：分批出图复用票 16 的让出原语，且常态同步路径仍在', () => {
    const view = read('src/preview/static/StaticPreviewView.tsx');
    expect(view).toContain("from './exportPanels'");
    expect(view).toContain('waitForPaint');
    expect(view).toContain('yieldToMainThread');
    expect(view).toContain('PAINT_PANEL_CHUNK');
    expect(view).toContain('onPaintComplete?.(paintVersion)');
    expect(view).toMatch(/if \(!deferPaint\)/);
    // useLayoutEffect 的同步路径必须留着：换代那一帧不许露出旧位图（issue 11 #2）
    expect(view).toContain('useLayoutEffect');
    expect(view).toContain('CanvasSpriteIcon.areImagesReady');
    expect(view).toContain('visible = true');
  });

  it('PreviewPage：dataVersion 驱动骨架，骨架盖住旧画布直到出图确认', () => {
    const page = read('src/pages/preview/PreviewPage.tsx');
    expect(page).toContain('dataVersion');
    expect(page).toContain('checking');
    expect(page).toContain('staticPaintPending');
    expect(page).toContain('preview-stage__paint-pending');
    expect(page).toContain('deferPaint={staticPaintDeferred}');
    expect(page).toContain('paintVersion={dataVersion}');
    expect(page).toContain('onPaintComplete={handleStaticPainted}');
    // 骨架必须在渲染期派生，不能用 useEffect 后置（那样静态视图已经同步出完图了）
    expect(page).toMatch(/const staticPaintPending = staticVisible && scene != null &&/);
    expect(page).toContain('preview-stage__static');
    expect(page).toContain('visible={active && staticVisible}');
    expect(page).toContain('checking || staticPaintDeferred');
  });

  it('样式与中英文文案齐备（骨架是不透明覆盖层，且尊重 reduced-motion）', () => {
    const css = read('src/pages/preview/PreviewPage.css');
    expect(css).toContain('.preview-stage__paint-pending');
    expect(css).toMatch(/\.preview-stage__paint-pending\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(/\.preview-stage__paint-pending\s*\{[^}]*background:/s);
    expect(css).toContain('prefers-reduced-motion');

    for (const file of ['zh-CN.json', 'en.json']) {
      const messages = read(`src/i18n/messages/${file}`);
      expect(messages).toContain('"preview.static.loading"');
    }
  });
});
