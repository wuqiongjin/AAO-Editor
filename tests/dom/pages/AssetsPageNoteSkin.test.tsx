// @vitest-environment jsdom
// issue 49 · ADR-0018 §6：素材页音符皮肤三处用户可见名称 = 官方命名映射选服后的显示名，
// 包 ID 不丢（title 保留）——整包预设卡 / 预设缩略钮 / 六条目 pill / 综合预览标题。
//
// 本机真快照尚未带 skinName（回落路径由单测覆盖），这里注入一份**带 skinName** 的
// 最小注册表（label 与官方名刻意不同值，防回落路径蒙混过关）。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import AssetsPage from '@/src/pages/assets/AssetsPage';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

vi.mock('@/src/rendering/skin/gen/noteSkinRegistry.gen', () => {
  const rects = (baseX: number) =>
    Array.from({ length: 7 }, (_, lane) => ({ x: baseX + lane * 100, y: 0, w: 100, h: 100 }));
  return {
    NOTE_SKIN_PACKS: [
      {
        kind: 'note', id: 'skin00', label: 'CI 桩皮肤', skinName: ['TYPE1', 'TYPE1', 'TYPE1', 'TYPE1', 'TYPE1'],
        atlas: 'skins/skin00/atlas.png', atlasW: 1024, atlasH: 1024,
        tap: rects(0), tapVirtual: rects(200), flick: rects(0), skill: rects(0), long: rects(400),
        flickTop: { x: 0, y: 0, w: 100, h: 100 }, slideAmong: { x: 0, y: 200, w: 100, h: 100 },
        ink: { note_flick_top: { left: 10, top: 10, right: 10, bottom: 10 } },
        band: 'skins/skin00/longNoteLine.png', bandW: 100, bandH: 20,
        bandSp: null, bandSpW: 0, bandSpH: 0,
        simultaneous: null, simultaneousW: 0, simultaneousH: 0,
        pairedDir: 'directionalflickskin00',
      },
      {
        kind: 'note', id: 'skin01', label: 'CI 桩皮肤 2', skinName: ['TYPE2', 'TYPE2', 'TYPE2', 'TYPE2', 'TYPE2'],
        atlas: 'skins/skin01/atlas.png', atlasW: 1024, atlasH: 1024,
        tap: rects(0), tapVirtual: rects(200), flick: rects(0), skill: rects(0), long: rects(400),
        flickTop: { x: 0, y: 0, w: 100, h: 100 }, slideAmong: { x: 0, y: 200, w: 100, h: 100 },
        ink: { note_flick_top: { left: 10, top: 10, right: 10, bottom: 10 } },
        band: 'skins/skin01/longNoteLine.png', bandW: 100, bandH: 20,
        bandSp: null, bandSpW: 0, bandSpH: 0,
        simultaneous: null, simultaneousW: 0, simultaneousH: 0,
        pairedDir: 'directionalflickskin01',
      },
      {
        kind: 'directional', id: 'directionalflickskin00', label: 'CI 桩方向皮肤', skinName: ['TYPE1', 'TYPE1', 'TYPE1', 'TYPE1', 'TYPE1'],
        atlas: 'skins/directionalflickskin00/atlas.png', atlasW: 1024, atlasH: 1024,
        dirL: rects(0), dirR: rects(0), flickTopL: null, flickTopR: null, ink: {},
      },
      {
        kind: 'directional', id: 'directionalflickskin01', label: 'CI 桩方向皮肤 2', skinName: ['TYPE2', 'TYPE2', 'TYPE2', 'TYPE2', 'TYPE2'],
        atlas: 'skins/directionalflickskin01/atlas.png', atlasW: 1024, atlasH: 1024,
        dirL: rects(0), dirR: rects(0), flickTopL: null, flickTopR: null, ink: {},
      },
    ],
    NOTE_SKIN_DEFAULT_SELECTION: {
      tap: 'skin00', flick: 'skin00', skill: 'skin00', slide: 'skin00',
      dirL: 'directionalflickskin00', dirR: 'directionalflickskin00',
    },
  };
});

const navValue = {
  activePage: 'assets' as PageId,
  setActivePage: vi.fn(),
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: vi.fn(),
};

beforeEach(() => {
  seedZhSettings();
  stubPageShellEnv();
});

function renderPage() {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><AssetsPage /></AppNavProvider>
    </ConfigProvider>,
  );
}

describe('issue 49 · 素材页音符皮肤显示名（官方命名选服，title 保留包 ID）', () => {
  it('整包预设卡：strong 显示显示名、title 带包 ID；不回落 label', () => {
    renderPage();
    const cards = document.querySelectorAll('.skin-preset');
    expect(cards).toHaveLength(2);
    const first = within(cards[0] as HTMLElement);
    expect(first.getByText('TYPE1')).toBeInTheDocument();
    expect(first.getByTitle('TYPE1（skin00）')).toBeInTheDocument();
    const second = within(cards[1] as HTMLElement);
    expect(second.getByText('TYPE2')).toBeInTheDocument();
    expect(second.getByTitle('TYPE2（skin01）')).toBeInTheDocument();
    // label（"CI 桩皮肤"）不出现：显示名走了 skinName 而不是回落
    expect(screen.queryByText('CI 桩皮肤')).toBeNull();
    expect(screen.queryByText('CI 桩皮肤 2')).toBeNull();
  });

  it('预设缩略钮：aria-label 用显示名（使用中/未使用两种形态）', () => {
    renderPage();
    const cards = document.querySelectorAll('.skin-preset');
    // 默认选择 = skin00 整包 → 第一张卡使用中（aria-label = 显示名，按钮禁用）
    expect(within(cards[0] as HTMLElement).getByRole('button', { name: 'TYPE1' })).toBeDisabled();
    // 第二张卡未使用 → "使用此包：TYPE2"
    expect(within(cards[1] as HTMLElement).getByRole('button', { name: '使用此包：TYPE2' })).toBeEnabled();
  });

  it('六条目 pill：显示名 + title 保留包 ID；综合预览标题同为显示名', () => {
    renderPage();
    const grid = document.querySelector('.skin-col-grid') as HTMLElement;
    const cols = within(grid).getAllByRole('row');
    expect(cols).toHaveLength(6);
    // 第一列（单键）两个包：TYPE1（默认选中）/ TYPE2
    const tapCol = within(cols[0] as HTMLElement);
    expect(tapCol.getByTitle('TYPE1（skin00）')).toHaveTextContent('TYPE1');
    expect(tapCol.getByTitle('TYPE2（skin01）')).toHaveTextContent('TYPE2');
    // 方向列（左右方向键）同样取显示名
    const dirCol = within(cols[3] as HTMLElement);
    expect(dirCol.getByTitle('TYPE1（directionalflickskin00）')).toBeInTheDocument();
    // 综合预览标题 = 整包显示名（与预设卡 / 预览面板同一口径）
    const head = document.querySelector('.skin-live-preview-head') as HTMLElement;
    expect(within(head).getByText('TYPE1')).toBeInTheDocument();
  });
});
