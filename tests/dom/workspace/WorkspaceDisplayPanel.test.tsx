// @vitest-environment jsdom
// issue 170：工作台顶栏「画布显示」浮层面板行为锁
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import WorkspaceDisplayPanel from '@/src/pages/workspace/WorkspaceDisplayPanel';
import { defaultSettings } from '@/src/chart/config/AppSettings';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

interface StoredSettings {
  display: Record<string, unknown>;
}

function setup() {
  seedZhSettings();
  render(
    <ConfigProvider>
      <WorkspaceDisplayPanel />
    </ConfigProvider>,
  );
  fireEvent.click(trigger());
}

const trigger = () => screen.getByRole('button', { name: '画布显示设置' });
const panel = () => screen.getByRole('dialog', { name: '画布显示设置' });
const scrim = () => document.querySelector('.pp-menu__scrim') as HTMLElement;
const stored = (): StoredSettings => JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as StoredSettings;

const noteSizeSlider = () => within(panel()).getByRole('slider', { name: '节奏图示大小' });
const slideOpacitySlider = () => within(panel()).getByRole('slider', { name: '长压线不透明度' });
const dualSwitch = () => within(panel()).getByRole('switch', { name: '同时点击线' });
const colorAssistSwitch = () => within(panel()).getByRole('switch', { name: '色觉辅助' });
const verticalRatioSlider = () => within(panel()).getByRole('slider', { name: '纵向比例' });
const qualitySelect = () => within(panel()).getByRole('combobox', { name: '图像品质' });
const gridStyleSelect = () => within(panel()).getByRole('combobox', { name: '轨道颜色' });
const lineShapeTiersSwitch = () => within(panel()).getByRole('switch', { name: '线形分层' });
const gridOpacitySlider = () => within(panel()).getByRole('slider', { name: '轨道线透明度' });
const labelScaleSlider = () => within(panel()).getByRole('slider', { name: '文字大小' });
const resetBtn = () => within(panel()).getByRole('button', { name: '恢复默认' });

describe('issue 170 · 工作台画布显示浮层面板', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('触发按钮形态：使用 SlidersHorizontal 单图标按钮，带 Tooltip 与无障碍属性', () => {
    seedZhSettings();
    render(
      <ConfigProvider>
        <WorkspaceDisplayPanel />
      </ConfigProvider>,
    );
    const btn = trigger();
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('title', '画布显示设置');
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveClass('ws-topbar-icon-btn');
    // 没有中文全文本或展开箭头
    expect(btn).not.toHaveTextContent('画布显示');
  });

  it('点击弹出浮层：包含完整的 10 项画布呈现项与出厂默认初值', () => {
    setup();
    expect(panel()).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveClass('is-active');

    // 10 项全部存在且值与 defaultSettings 一致
    const defaults = defaultSettings().display;
    expect(noteSizeSlider()).toHaveValue(String(Math.round(defaults.noteSize * 100)));
    expect(slideOpacitySlider()).toHaveValue(String(Math.round(defaults.slideOpacity * 100)));
    expect(dualSwitch()).toHaveAttribute('aria-checked', String(defaults.simultaneousClickLines));
    expect(colorAssistSwitch()).toHaveAttribute('aria-checked', String(defaults.colorAssist));
    expect(verticalRatioSlider()).toHaveValue(String(Math.round(defaults.verticalRatio * 100)));
    expect(qualitySelect()).toHaveValue(defaults.imageQuality);
    expect(gridStyleSelect()).toHaveValue(defaults.gridStyle);
    expect(lineShapeTiersSwitch()).toHaveAttribute('aria-checked', String(defaults.lineShapeTiers));
    expect(gridOpacitySlider()).toHaveValue(String(Math.round(defaults.gridOpacity * 100)));
    expect(labelScaleSlider()).toHaveValue(String(Math.round(defaults.labelScale * 100)));
    expect(resetBtn()).toBeInTheDocument();
  });

  it('写回逻辑：修改滑杆/开关/下拉即时调用 setDisplay 并写入落盘设置', () => {
    setup();

    // 调整节奏图示大小
    fireEvent.change(noteSizeSlider(), { target: { value: '150' } });
    expect(stored().display.noteSize).toBe(1.5);

    // 调整长压线不透明度
    fireEvent.change(slideOpacitySlider(), { target: { value: '50' } });
    expect(stored().display.slideOpacity).toBe(0.5);

    // 调整开关项
    fireEvent.click(dualSwitch());
    expect(stored().display.simultaneousClickLines).toBe(false);

    fireEvent.click(colorAssistSwitch());
    expect(stored().display.colorAssist).toBe(false);

    fireEvent.click(lineShapeTiersSwitch());
    expect(stored().display.lineShapeTiers).toBe(true);

    // 调整纵向比例、轨道透明度、文字大小
    fireEvent.change(verticalRatioSlider(), { target: { value: '120' } });
    expect(stored().display.verticalRatio).toBe(1.2);

    fireEvent.change(gridOpacitySlider(), { target: { value: '40' } });
    expect(stored().display.gridOpacity).toBe(0.4);

    fireEvent.change(labelScaleSlider(), { target: { value: '180' } });
    expect(stored().display.labelScale).toBe(1.8);

    // 调整画质与轨道样式下拉框
    fireEvent.change(qualitySelect(), { target: { value: 'smooth' } });
    expect(stored().display.imageQuality).toBe('smooth');

    fireEvent.change(gridStyleSelect(), { target: { value: 'amber' } });
    expect(stored().display.gridStyle).toBe('amber');
  });

  it('恢复出厂默认：带二次确认；确认后全量重置为默认值', () => {
    setup();

    // 先改动两项
    fireEvent.change(noteSizeSlider(), { target: { value: '160' } });
    fireEvent.change(gridStyleSelect(), { target: { value: 'cyan' } });
    expect(stored().display.noteSize).toBe(1.6);
    expect(stored().display.gridStyle).toBe('cyan');

    // 点恢复默认，弹出二次确认
    fireEvent.click(resetBtn());
    const confirmBtn = within(panel()).getByRole('button', { name: '确认恢复' });
    const cancelBtn = within(panel()).getByRole('button', { name: '取消' });
    expect(confirmBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();

    // 点取消，维持自定义值
    fireEvent.click(cancelBtn);
    expect(stored().display.noteSize).toBe(1.6);
    expect(stored().display.gridStyle).toBe('cyan');

    // 再次点恢复默认并确认
    fireEvent.click(resetBtn());
    fireEvent.click(within(panel()).getByRole('button', { name: '确认恢复' }));

    const defaults = defaultSettings().display;
    expect(stored().display.noteSize).toBe(defaults.noteSize);
    expect(stored().display.gridStyle).toBe(defaults.gridStyle);
    expect(stored().display.slideOpacity).toBe(defaults.slideOpacity);
  });

  it('关闭行为：Esc 键收起面板并将焦点还给触发钮；点击遮罩收起面板', () => {
    setup();
    expect(panel()).toBeInTheDocument();

    // Esc 关
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '画布显示设置' })).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    // 再次打开
    fireEvent.click(trigger());
    expect(panel()).toBeInTheDocument();

    // 点遮罩关
    fireEvent.click(scrim());
    expect(screen.queryByRole('dialog', { name: '画布显示设置' })).not.toBeInTheDocument();
  });
});
