// @vitest-environment jsdom
// issue 10：应用壳保活挂载让素材页在**启动时**就 mount，7 张整包缩略图各拉本包图集
// （atlas / band / bandSp / 配对方向 atlas）+ 综合预览，合计 33 张 ≈ 1.75 MB。
// 网页版首屏因此白付这笔与用户操作无关的流量（图进 CanvasSpriteIcon.imageCache 后常驻）。
//
// 口径：皮肤图集延迟到**首次进入素材页**再取；一旦取过就保持挂载（保活语义不变）。
// 本文件锁三条：① 没进过素材页 → 一个图集请求都不发；② 切走切回不重取、不重画（状态不丢）；
// ③ 这道闸真的接在 `PageSlot` 传下来的 `active` 上（不是测试里手工摆的姿势）。
//
// 为什么不用浏览器网络测试：jsdom 里发不出真请求，网络行为留给一次性 Chromium 实测
// （数字记在票 10 Comments）。这里锁的是**发出请求的那道闸**。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import { PageSlot } from '@/src/pages/PageRegistry';
import AssetsPage from '@/src/pages/assets/AssetsPage';
import { t } from '@/src/i18n';
import { makeRecordingCtx } from '@/tests/support/canvas';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

// 精灵绘制器整体替身：只关心「取图闸」与「有没有真的落笔」，不关心画成什么样。
const sprite = vi.hoisted(() => ({
  ensureImagesLoaded: vi.fn(async (urls: string[]) => urls.map(() => undefined)),
  render: vi.fn(),
}));

vi.mock('@/src/ui/CanvasSpriteIcon', () => ({
  default: class {
    static ensureImagesLoaded = sprite.ensureImagesLoaded;
    render = sprite.render;
  },
}));

vi.mock('@/src/rendering/skin/gen/noteSkinRegistry.gen', async () => {
  const { noteSkinRegistryStub } = await import('@/tests/support/noteSkinStub');
  return noteSkinRegistryStub();
});

const navValue = {
  activePage: 'assets' as PageId,
  setActivePage: vi.fn(),
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: vi.fn(),
};

/** 应用壳里页面拿到的上下文（`PageSlot` 外面就这两层）。 */
function shell(children: React.ReactNode) {
  return (
    <ConfigProvider>
      <AppNavProvider value={navValue}>{children}</AppNavProvider>
    </ConfigProvider>
  );
}

/** 放干「取图 promise → 绘制」这条微任务链。 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 已发出的皮肤图集 URL（各次 ensureImagesLoaded 摊平） */
function requestedSrcs(): string[] {
  return sprite.ensureImagesLoaded.mock.calls.flatMap(([urls]) => urls);
}

const noteskinRegion = () => screen.queryByRole('region', { name: t('assets.noteskin') });

beforeEach(() => {
  seedZhSettings();
  stubPageShellEnv();
  sprite.ensureImagesLoaded.mockClear();
  sprite.render.mockClear();
  // jsdom 没有布局引擎：量不到宽（clientWidth = 0）就不会画。给个固定宽度 + 记录型 ctx，
  // 让 paint() 真的走到 drawPreviewSprite（否则「画了没画」这条根本没被验到）。
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 156,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    makeRecordingCtx().proxy as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  // 原型是全局的：不拆掉，后面任何 DOM 测试都会拿到假 ctx / 假宽度
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).clientWidth;
  vi.restoreAllMocks();
});

describe('issue 10 · 素材页皮肤图集延迟到首次进入才取', () => {
  it('没进过素材页：正文不挂载，一个皮肤图集都不取', async () => {
    const { rerender } = renderWithProviders(shell(<AssetsPage active={false} />));
    await flush();

    expect(noteskinRegion()).toBeNull();
    expect(sprite.ensureImagesLoaded).not.toHaveBeenCalled();
    expect(sprite.render).not.toHaveBeenCalled();

    // 反复失活（应用壳每切一次别的页都会重渲一次）也不该松口
    rerender(shell(<AssetsPage active={false} />));
    await flush();
    expect(noteskinRegion()).toBeNull();
    expect(sprite.ensureImagesLoaded).not.toHaveBeenCalled();
  });

  it('首次激活：整包预设与综合预览都挂上，每个包取到图并真的画出缩略图', async () => {
    const { rerender } = renderWithProviders(shell(<AssetsPage active={false} />));
    await flush();

    rerender(shell(<AssetsPage active />));
    await flush();

    expect(noteskinRegion()).not.toBeNull();
    expect(sprite.ensureImagesLoaded).toHaveBeenCalled();
    expect(requestedSrcs()).toEqual(expect.arrayContaining([
      'skins/skin00/atlas.png',
      'skins/skin01/atlas.png',
      'skins/directionalflickskin00/atlas.png',
      'skins/directionalflickskin01/atlas.png',
    ]));
    // 图到位后缩略图与综合预览都落笔（不是空卡）
    expect(sprite.render.mock.calls.length).toBeGreaterThan(0);
  });

  it('首访就是素材页（直接开在本页）：不因 latch 初始值漏画', async () => {
    renderWithProviders(shell(<AssetsPage active />));
    await flush();

    expect(noteskinRegion()).not.toBeNull();
    expect(sprite.ensureImagesLoaded).toHaveBeenCalled();
    expect(sprite.render.mock.calls.length).toBeGreaterThan(0);
  });

  it('切走再切回：不重取、不重画（保活状态不丢）', async () => {
    const { rerender } = renderWithProviders(shell(<AssetsPage active={false} />));
    await flush();
    rerender(shell(<AssetsPage active />));
    await flush();

    const loads = sprite.ensureImagesLoaded.mock.calls.length;
    const draws = sprite.render.mock.calls.length;
    expect(loads).toBeGreaterThan(0);
    expect(draws).toBeGreaterThan(0);

    // 切走：已加载的图与已画好的画布都留着，什么都不该发生
    rerender(shell(<AssetsPage active={false} />));
    await flush();
    expect(noteskinRegion()).not.toBeNull();
    expect(sprite.ensureImagesLoaded.mock.calls.length).toBe(loads);
    expect(sprite.render.mock.calls.length).toBe(draws);

    // 切回：仍不重取、不重画（重取 = latch 没常驻；重画 = 组件被卸载重挂）
    rerender(shell(<AssetsPage active />));
    await flush();
    expect(sprite.ensureImagesLoaded.mock.calls.length).toBe(loads);
    expect(sprite.render.mock.calls.length).toBe(draws);
  });

  it('接线：闸门吃的是 PageSlot 传下来的 active（漏传会静默回潮）', async () => {
    // 先把页面 chunk 解掉，免得 Suspense 还没兜住就被当成「没取图」
    await act(async () => { await import('@/src/pages/assets/AssetsPage'); });

    const { rerender } = renderWithProviders(shell(<PageSlot id="assets" active={false} />));
    await flush();
    expect(sprite.ensureImagesLoaded).not.toHaveBeenCalled();

    rerender(shell(<PageSlot id="assets" active />));
    await flush();
    // 激活后正文进来（既是正向证据，也证明上面那条不是因为压根没挂载才成立的）
    expect(noteskinRegion()).not.toBeNull();
    expect(sprite.ensureImagesLoaded).toHaveBeenCalled();
  });
});
