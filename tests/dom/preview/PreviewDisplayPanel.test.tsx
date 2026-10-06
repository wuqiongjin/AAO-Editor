// @vitest-environment jsdom
// chart-preview 08：预览页「设置」面板的行为锁（2026-09-30 用户定案；二轮收敛文案与默认值）。
//
// 三组口径各锁一条：
//   1. 标记（BPM / 时间 / 节拍线 / Combo / 镜向）落 `settings.preview` —— 跨会话记住，且**不动**画布显示；
//   2. 画布显示组直接写 `settings.display` —— 与设置页「画布显示」是同一份设置（改了双方生效），
//      所以这里断言的是"落盘里的那一份"而不是面板内的副本；
//   3. 浮层交互照站内菜单壳：Esc 关并把焦点还给触发钮、点遮罩关。
//
// 按结构取节点一处：`.pp-menu__scrim`（"点面板外"只有遮罩能表达，照 ScopePicker.test.tsx）。
//
// 控件文案**复用设置页那套**（节奏图示大小 / 同时点击线 / 色觉辅助 / 图像品质 / 轨道颜色…）：
// 面板是同一份设置的第二个入口，两处名字必须一样（面板不另起一套词汇）。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import PreviewDisplayPanel from '@/src/pages/preview/PreviewDisplayPanel';
import { normalizeNoteSkinSelection, noteSkinPresetLabel } from '@/src/rendering/skin/noteSkin';
import { DEFAULT_EXPORT_FIELDS, DEFAULT_PREVIEW_SETTINGS, defaultSettings } from '@/src/chart/config/AppSettings';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

interface StoredSettings {
  display: Record<string, unknown>;
  preview: Record<string, unknown>;
  export: Record<string, unknown>;
}

function setup() {
  seedZhSettings();
  const setActivePage = vi.fn();
  const nav: AppNavValue = {
    activePage: 'preview', setActivePage, pageScope: null,
    navCollapsed: false, setNavCollapsed: vi.fn(),
  };
  render(
    <AppNavProvider value={nav}>
      <ConfigProvider>
        <PreviewDisplayPanel />
      </ConfigProvider>
    </AppNavProvider>,
  );
  fireEvent.click(trigger());
  return { setActivePage };
}

const trigger = () => screen.getByRole('button', { name: '设置' });
const panel = () => screen.getByRole('dialog', { name: '显示设置' });
const scrim = () => document.querySelector('.pp-menu__scrim') as HTMLElement;
/** 落盘的那份设置（ConfigProvider 每次改动都整份写回同一 key） */
const stored = (): StoredSettings => JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as StoredSettings;
const bpmSwitch = () => within(panel()).getByRole('switch', { name: 'BPM 标记' });
const comboswitch = () => within(panel()).getByRole('switch', { name: 'Combo 标记' });
const mirrorSwitch = () => within(panel()).getByRole('switch', { name: '镜向' });
const dualSwitch = () => within(panel()).getByRole('switch', { name: '同时点击线' });
const colorAssistSwitch = () => within(panel()).getByRole('switch', { name: '色觉辅助' });
const timeSelect = () => within(panel()).getByRole('combobox', { name: '时间标记' });
const beatSelect = () => within(panel()).getByRole('combobox', { name: '节拍线' });
const qualitySelect = () => within(panel()).getByRole('combobox', { name: '图像品质' });
const noteSizeSlider = () => within(panel()).getByRole('slider', { name: '节奏图示大小' });
const gridOpacitySlider = () => within(panel()).getByRole('slider', { name: '轨道线透明度' });

describe('chart-preview 08 · 面板打开与默认档', () => {
  it('点「设置」弹出面板：标记 / 画布显示 / 音符皮肤三组都在', () => {
    setup();
    expect(panel()).toBeInTheDocument();
    expect(within(panel()).getByText('标记')).toBeInTheDocument();
    expect(within(panel()).getByText('画布显示')).toBeInTheDocument();
    expect(within(panel()).getByText('音符皮肤')).toBeInTheDocument();
  });

  it('默认档（用户定案）：BPM / Combo 标记开、时间标记 5 秒、节拍线 1/1、不镜像', () => {
    setup();
    expect(bpmSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(timeSelect()).toHaveValue('5');
    expect(beatSelect()).toHaveValue('1');
    expect(comboswitch()).toHaveAttribute('aria-checked', 'true');
    expect(mirrorSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(DEFAULT_PREVIEW_SETTINGS.timeMarks).toBe(5);
  });

  it('皮肤组显示当前整包名（六条目命中某个整包；不是整包时显示"已自定义"）', () => {
    setup();

    // 期望名从注册表算（不抄字面量）：与素材页"整包预设"同一判定口径。
    // 默认选择就是某个整包 → 面板显示的是它的 label，而不是"已自定义"。
    const expected = noteSkinPresetLabel(normalizeNoteSkinSelection(undefined));
    expect(expected).toBeTruthy();
    expect(within(panel()).getByText(expected!)).toBeInTheDocument();
    expect(within(panel()).queryByText('已自定义')).toBeNull();
  });
});

describe('chart-preview 08 · 标记项落 settings.preview', () => {
  it('五个档位各写各的，且不碰画布显示那段', () => {
    setup();

    fireEvent.click(bpmSwitch());
    expect(bpmSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(stored().preview.bpmMarks).toBe(false);

    fireEvent.change(timeSelect(), { target: { value: '10' } });
    expect(stored().preview.timeMarks).toBe(10);

    fireEvent.change(beatSelect(), { target: { value: '4' } });
    expect(stored().preview.beatMarks).toBe(4);

    fireEvent.click(comboswitch());
    expect(stored().preview.comboMarks).toBe(false);

    fireEvent.click(mirrorSwitch());
    expect(stored().preview.mirror).toBe(true);

    expect(stored().preview).toEqual({
      ...DEFAULT_PREVIEW_SETTINGS,
      bpmMarks: false, timeMarks: 10, beatMarks: 4, comboMarks: false, mirror: true,
    });
    // 画布那段一个字段都没被动过（写回的是整份设置，值是默认档）
    expect(stored().display).toEqual(defaultSettings().display);
  });
});

describe('chart-preview 08 · 画布显示组落 settings.display（与设置页同一份）', () => {
  it('同时点击线 / 色觉辅助 / 图像品质 / 音符大小 / 轨道线透明度都写进 display，且不碰标记那段', () => {
    setup();

    fireEvent.click(dualSwitch());
    expect(dualSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(stored().display.simultaneousClickLines).toBe(false);

    fireEvent.click(colorAssistSwitch());
    expect(colorAssistSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(stored().display.colorAssist).toBe(false);

    fireEvent.change(qualitySelect(), { target: { value: 'standard' } });
    expect(stored().display.imageQuality).toBe('standard');

    fireEvent.change(noteSizeSlider(), { target: { value: '150' } });
    expect(stored().display.noteSize).toBeCloseTo(1.5, 6);

    fireEvent.change(gridOpacitySlider(), { target: { value: '40' } });
    expect(stored().display.gridOpacity).toBeCloseTo(0.4, 6);

    // 标记那段一个字段都没被动过
    expect(stored().preview).toEqual(defaultSettings().preview);
  });

  it('面板读的是同一份设置：外部（设置页）改过之后打开面板能看到当前值', () => {
    seedZhSettings({
      display: { noteSize: 0.5, simultaneousClickLines: false, colorAssist: false, imageQuality: 'smooth', gridOpacity: 0.5 },
    });
    const setActivePage = vi.fn();
    render(
      <AppNavProvider value={{ activePage: 'preview', setActivePage, pageScope: null, navCollapsed: false, setNavCollapsed: vi.fn() }}>
        <ConfigProvider><PreviewDisplayPanel /></ConfigProvider>
      </AppNavProvider>,
    );
    fireEvent.click(trigger());

    expect(noteSizeSlider()).toHaveValue('50');
    expect(dualSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(colorAssistSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(qualitySelect()).toHaveValue('smooth');
    expect(gridOpacitySlider()).toHaveValue('50');
    // 没在种子里的项读的是 settings.display 的默认值（面板不自己造一套默认）
    expect(within(panel()).getByRole('combobox', { name: '轨道颜色' })).toHaveValue(defaultSettings().display.gridStyle);
    expect(bpmSwitch()).toHaveAttribute('aria-checked', 'true');
  });
});

describe('chart-preview 14 · 「导出信息」组落 settings.export', () => {
  const exportSwitch = (name: string) => within(panel()).getByRole('switch', { name });

  it('七项都在；默认档 = 谱面标题 / 难度 + 等级 / BPM 开，其余关', () => {
    setup();
    expect(within(panel()).getByText('导出信息')).toBeInTheDocument();
    expect(exportSwitch('谱面标题')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('难度 + 等级')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('BPM')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('工程名')).toHaveAttribute('aria-checked', 'false');
    expect(exportSwitch('时长')).toHaveAttribute('aria-checked', 'false');
    expect(exportSwitch('音符数')).toHaveAttribute('aria-checked', 'false');
    expect(exportSwitch('导出时间')).toHaveAttribute('aria-checked', 'false');
  });

  it('开关写进落盘 export 段，且不碰 preview / display（导出物内容与"怎么看"分开）', () => {
    setup();
    fireEvent.click(exportSwitch('工程名'));
    expect(stored().export.projectName).toBe(true);
    fireEvent.click(exportSwitch('BPM'));
    expect(exportSwitch('BPM')).toHaveAttribute('aria-checked', 'false');
    expect(stored().export).toEqual({ ...DEFAULT_EXPORT_FIELDS, projectName: true, bpm: false });
    expect(stored().preview).toEqual(defaultSettings().preview);
    expect(stored().display).toEqual(defaultSettings().display);
  });

  it('面板读同一份设置：外部（落盘种子）改过的 export 段打开即见', () => {
    seedZhSettings({ export: { duration: true, chartTitle: false } });
    render(
      <AppNavProvider value={{ activePage: 'preview', setActivePage: vi.fn(), pageScope: null, navCollapsed: false, setNavCollapsed: vi.fn() }}>
        <ConfigProvider><PreviewDisplayPanel /></ConfigProvider>
      </AppNavProvider>,
    );
    fireEvent.click(trigger());

    expect(exportSwitch('时长')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('谱面标题')).toHaveAttribute('aria-checked', 'false');
    expect(exportSwitch('BPM')).toHaveAttribute('aria-checked', 'true');   // 没种子的项读默认档
  });
});

describe('chart-preview 14 · 头带总开关「启用头带」（2026-10-06 追加）', () => {
  const exportSwitch = (name: string) => within(panel()).getByRole('switch', { name });
  const headerToggle = () => within(panel()).getByRole('switch', { name: '启用头带' });

  it('默认开，挂在「导出信息」组标题行右侧（不另立条目，2026-10-07 定案）', () => {
    setup();
    expect(headerToggle()).toHaveAttribute('aria-checked', 'true');
    const head = headerToggle().closest('.pdp__group-head');
    expect(head).not.toBeNull();
    expect(head).toContainElement(within(panel()).getByText('导出信息') as HTMLElement);
  });

  it('关：落盘 enabled = false，七项置灰但勾选原样保留；再开就地恢复', () => {
    setup();
    fireEvent.click(headerToggle());

    expect(stored().export.enabled).toBe(false);
    expect(exportSwitch('谱面标题')).toBeDisabled();
    expect(exportSwitch('BPM')).toBeDisabled();
    expect(exportSwitch('工程名')).toBeDisabled();
    // 保留勾选 = 再开不用重勾一遍
    expect(exportSwitch('谱面标题')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('BPM')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('工程名')).toHaveAttribute('aria-checked', 'false');
    // 置灰期间点它改不动（不是"点了没反应"的骗局：它真 disabled）
    fireEvent.click(exportSwitch('工程名'));
    expect(stored().export.projectName).toBe(false);

    fireEvent.click(headerToggle());
    expect(stored().export.enabled).toBe(true);
    expect(exportSwitch('BPM')).not.toBeDisabled();
    expect(stored().export).toEqual(DEFAULT_EXPORT_FIELDS);
  });
});

describe('chart-preview 08 · 浮层交互与皮肤入口', () => {
  it('Esc 关面板并把焦点还给触发钮', () => {
    setup();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('点面板外（遮罩）关闭', () => {
    setup();
    fireEvent.click(scrim());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('「去素材页」关掉面板并切到素材页', () => {
    const { setActivePage } = setup();
    fireEvent.click(within(panel()).getByRole('button', { name: '去素材页' }));

    expect(setActivePage).toHaveBeenCalledWith('assets');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
