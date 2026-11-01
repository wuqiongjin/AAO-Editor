// @vitest-environment jsdom
// issue 170：工作台顶栏「画布显示」浮层面板行为锁
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppNavProvider } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import WorkspaceDisplayPanel from '@/src/pages/workspace/WorkspaceDisplayPanel';
import { defaultSettings } from '@/src/chart/config/AppSettings';
import { setActiveUiLanguage } from '@/src/i18n';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

interface StoredSettings {
  display: Record<string, unknown>;
  audio: Record<string, unknown>;
  playbar: Record<string, unknown>;
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
const timePrecisionSelect = () => within(panel()).getByRole('combobox', { name: '时间显示精度' });
const seVolumeSlider = () => within(panel()).getByRole('slider', { name: '节奏图示 SE 音量' });
const invertWheelSwitch = () => within(panel()).getByRole('switch', { name: '反转滚轮方向' });
const pinchModeSelect = () => within(panel()).getByRole('combobox', { name: '滑条拖拽变形风格' });
const pinchModeHelpBtn = () => within(panel()).getByRole('button', { name: /设置在画布上直接拖拽滑条连接段时的默认形态/ });
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

  it('点击弹出浮层：包含完整的 11 项画布呈现项与出厂默认初值', () => {
    setup();
    expect(panel()).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveClass('is-active');

    // 画布项存在且值与 defaultSettings 一致
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
    expect(timePrecisionSelect()).toHaveValue(defaults.timePrecision);
    expect(seVolumeSlider()).toHaveValue(String(Math.round(defaultSettings().audio.seVolume * 100)));
    expect(invertWheelSwitch()).toHaveAttribute('aria-checked', String(defaults.invertWheel));
    expect(pinchModeSelect()).toHaveValue(defaults.pinchMode);
    expect(pinchModeHelpBtn()).toBeInTheDocument();
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

    // 调整时间显示精度（3档测试）
    fireEvent.change(timePrecisionSelect(), { target: { value: 'centisecond' } });
    expect(stored().display.timePrecision).toBe('centisecond');
    fireEvent.change(timePrecisionSelect(), { target: { value: 'millisecond' } });
    expect(stored().display.timePrecision).toBe('millisecond');

    // 调整 SE 音量
    fireEvent.change(seVolumeSlider(), { target: { value: '75' } });
    expect(stored().audio.seVolume).toBe(0.75);

    // 调整反转滚轮
    fireEvent.click(invertWheelSwitch());
    expect(stored().display.invertWheel).toBe(true);

    // 调整滑条拖拽变形风格
    fireEvent.change(pinchModeSelect(), { target: { value: 'triangle' } });
    expect(stored().display.pinchMode).toBe('triangle');
  });

  it('恢复出厂默认：带二次确认；确认后重置画布与显示项，不重置音频与播放条', () => {
    setup();

    // 先改动画布项、音频 SE 音量与播放条按钮
    fireEvent.change(noteSizeSlider(), { target: { value: '160' } });
    fireEvent.change(gridStyleSelect(), { target: { value: 'cyan' } });
    fireEvent.change(timePrecisionSelect(), { target: { value: 'millisecond' } });
    fireEvent.click(invertWheelSwitch());
    fireEvent.change(pinchModeSelect(), { target: { value: 'triangle' } });
    fireEvent.change(seVolumeSlider(), { target: { value: '70' } });

    expect(stored().display.noteSize).toBe(1.6);
    expect(stored().display.gridStyle).toBe('cyan');
    expect(stored().display.timePrecision).toBe('millisecond');
    expect(stored().display.invertWheel).toBe(true);
    expect(stored().display.pinchMode).toBe('triangle');
    expect(stored().audio.seVolume).toBe(0.7);

    // 点恢复默认，弹出二次确认
    fireEvent.click(resetBtn());
    const confirmBtn = within(panel()).getByRole('button', { name: '确认恢复' });
    const cancelBtn = within(panel()).getByRole('button', { name: '取消' });
    expect(confirmBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();

    // 点取消，维持自定义值
    fireEvent.click(cancelBtn);
    expect(stored().display.noteSize).toBe(1.6);
    expect(stored().display.timePrecision).toBe('millisecond');
    expect(stored().display.pinchMode).toBe('triangle');
    expect(stored().audio.seVolume).toBe(0.7);

    // 再次点恢复默认并确认
    fireEvent.click(resetBtn());
    fireEvent.click(within(panel()).getByRole('button', { name: '确认恢复' }));

    const defaults = defaultSettings().display;
    expect(stored().display.noteSize).toBe(defaults.noteSize);
    expect(stored().display.gridStyle).toBe(defaults.gridStyle);
    expect(stored().display.slideOpacity).toBe(defaults.slideOpacity);
    expect(stored().display.timePrecision).toBe('standard');
    expect(stored().display.invertWheel).toBe(false);
    expect(stored().display.pinchMode).toBe('smooth');
    // 音频 SE 音量保持用户设置不变
    expect(stored().audio.seVolume).toBe(0.7);
  });

  it('issue 204 · 滑条拖拽变形风格配置项与帮助气泡展开收起', () => {
    setup();
    const select = pinchModeSelect();
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('smooth');

    const options = within(select).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveValue('smooth');
    expect(options[0]).toHaveTextContent('圆滑曲线');
    expect(options[1]).toHaveValue('triangle');
    expect(options[1]).toHaveTextContent('三角拉弓');

    // 帮助气泡交互
    const helpBtn = pinchModeHelpBtn();
    expect(helpBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // 点击打开帮助气泡
    fireEvent.click(helpBtn);
    expect(helpBtn).toHaveAttribute('aria-expanded', 'true');
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('直接拖拽滑条连接段时的默认形态');
    expect(tooltip).toHaveTextContent('Alt');

    // 再次点击收起帮助气泡
    fireEvent.click(helpBtn);
    expect(helpBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('issue 200：浮层按「画布 / 播放与音频 / 操作偏好」三组排布；修改各组项正常写盘；恢复默认仅重置画布段', () => {
    setup();
    const canvasGroup = within(panel()).getByRole('region', { name: '画布' });
    const playbackAudioGroup = within(panel()).getByRole('region', { name: '播放与音频' });
    const preferencesGroup = within(panel()).getByRole('region', { name: '操作偏好' });

    expect(canvasGroup.compareDocumentPosition(playbackAudioGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(playbackAudioGroup.compareDocumentPosition(preferencesGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preferencesGroup.compareDocumentPosition(resetBtn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const markerSwitch = within(playbackAudioGroup).getByRole('switch', { name: '显示标记点跳转按钮' });
    expect(markerSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(markerSwitch);
    expect(stored().playbar.markerButton).toBe(false);

    const seSlider = within(playbackAudioGroup).getByRole('slider', { name: '节奏图示 SE 音量' });
    fireEvent.change(seSlider, { target: { value: '85' } });
    expect(stored().audio.seVolume).toBe(0.85);

    const invertSwitch = within(preferencesGroup).getByRole('switch', { name: '反转滚轮方向' });
    expect(invertSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(invertSwitch);
    expect(stored().display.invertWheel).toBe(true);

    fireEvent.click(resetBtn());
    fireEvent.click(within(panel()).getByRole('button', { name: '确认恢复' }));
    expect(stored().playbar.markerButton).toBe(false);
    expect(stored().audio.seVolume).toBe(0.85);
    expect(stored().display.invertWheel).toBe(false);
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

  it('issue 205：新增音符皮肤分组与跳转，画布项按音符→轨道网格→读数画质顺化', () => {
    seedZhSettings();
    const setActivePage = vi.fn();
    render(
      <AppNavProvider value={{ activePage: 'workspace', setActivePage, pageScope: null, navCollapsed: false, setNavCollapsed: vi.fn() }}>
        <ConfigProvider>
          <WorkspaceDisplayPanel />
        </ConfigProvider>
      </AppNavProvider>,
    );
    fireEvent.click(trigger());

    // 检查四个分组次序：画布 -> 播放与音频 -> 操作偏好 -> 音符皮肤
    const canvasGroup = within(panel()).getByRole('region', { name: '画布' });
    const audioGroup = within(panel()).getByRole('region', { name: '播放与音频' });
    const prefGroup = within(panel()).getByRole('region', { name: '操作偏好' });
    const skinGroup = within(panel()).getByRole('region', { name: '音符皮肤' });

    expect(canvasGroup.compareDocumentPosition(audioGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(audioGroup.compareDocumentPosition(prefGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(prefGroup.compareDocumentPosition(skinGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(skinGroup.compareDocumentPosition(resetBtn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 画布项次序：音符外观 (noteSize, slideOpacity, dual, colorAssist) -> 轨道与网格 (verticalRatio, gridStyle, gridOpacity, lineShapeTiers) -> 读数与画质 (labelScale, timePrecision, imageQuality)
    expect(noteSizeSlider().compareDocumentPosition(slideOpacitySlider()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slideOpacitySlider().compareDocumentPosition(dualSwitch()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dualSwitch().compareDocumentPosition(colorAssistSwitch()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(colorAssistSwitch().compareDocumentPosition(verticalRatioSlider()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(verticalRatioSlider().compareDocumentPosition(gridStyleSelect()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gridStyleSelect().compareDocumentPosition(gridOpacitySlider()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gridOpacitySlider().compareDocumentPosition(lineShapeTiersSwitch()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lineShapeTiersSwitch().compareDocumentPosition(labelScaleSlider()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(labelScaleSlider().compareDocumentPosition(timePrecisionSelect()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timePrecisionSelect().compareDocumentPosition(qualitySelect()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 音符皮肤跳转
    const skinOpenBtn = within(skinGroup).getByRole('button', { name: '去素材页' });
    expect(skinOpenBtn).toBeInTheDocument();
    fireEvent.click(skinOpenBtn);
    expect(setActivePage).toHaveBeenCalledWith('assets');
    expect(screen.queryByRole('dialog', { name: '画布显示设置' })).not.toBeInTheDocument();
  });

  it('issue 206：运行中切界面语言，下拉选项文案（画质 / 轨道颜色 / 时间精度 / 变形风格）立即更新为对应语言', () => {
    setup();

    // 1. 中文状态下各下拉选项文案
    const qSelect = qualitySelect();
    const gSelect = gridStyleSelect();
    const tpSelect = timePrecisionSelect();
    const pmSelect = pinchModeSelect();

    expect(within(qSelect).getByRole('option', { name: '标准' })).toBeInTheDocument();
    expect(within(qSelect).getByRole('option', { name: '流畅' })).toBeInTheDocument();
    expect(within(qSelect).getByRole('option', { name: '高清' })).toBeInTheDocument();

    expect(within(gSelect).getByRole('option', { name: '灰阶' })).toBeInTheDocument();
    expect(within(gSelect).getByRole('option', { name: '多彩' })).toBeInTheDocument();

    expect(within(tpSelect).getByRole('option', { name: '0.1 秒' })).toBeInTheDocument();
    expect(within(tpSelect).getByRole('option', { name: '0.01 秒' })).toBeInTheDocument();
    expect(within(tpSelect).getByRole('option', { name: '0.001 秒' })).toBeInTheDocument();

    expect(within(pmSelect).getByRole('option', { name: '圆滑曲线' })).toBeInTheDocument();
    expect(within(pmSelect).getByRole('option', { name: '三角拉弓' })).toBeInTheDocument();

    // 2. 切换语言为 en 并触发重渲（模拟运行时切语言）
    setActiveUiLanguage('en');
    fireEvent.click(dualSwitch());

    // 3. 英文状态下各下拉选项文案立即更新
    const panelEn = screen.getByRole('dialog');
    const qSelectEn = within(panelEn).getByRole('combobox', { name: 'Image quality' });
    const gSelectEn = within(panelEn).getByRole('combobox', { name: 'Lane colors' });
    const tpSelectEn = within(panelEn).getByRole('combobox', { name: 'Time display precision' });
    const pmSelectEn = within(panelEn).getByRole('combobox', { name: 'Slide Pinch Mode' });

    expect(within(qSelectEn).getByRole('option', { name: 'Standard' })).toBeInTheDocument();
    expect(within(qSelectEn).getByRole('option', { name: 'Smooth' })).toBeInTheDocument();
    expect(within(qSelectEn).getByRole('option', { name: 'HD' })).toBeInTheDocument();

    expect(within(gSelectEn).getByRole('option', { name: 'Mono' })).toBeInTheDocument();
    expect(within(gSelectEn).getByRole('option', { name: 'Vivid' })).toBeInTheDocument();

    expect(within(tpSelectEn).getByRole('option', { name: '0.1s' })).toBeInTheDocument();
    expect(within(tpSelectEn).getByRole('option', { name: '0.01s' })).toBeInTheDocument();
    expect(within(tpSelectEn).getByRole('option', { name: '0.001s' })).toBeInTheDocument();

    expect(within(pmSelectEn).getByRole('option', { name: 'Smooth Curve' })).toBeInTheDocument();
    expect(within(pmSelectEn).getByRole('option', { name: 'Triangle Pull' })).toBeInTheDocument();

    setActiveUiLanguage('zh-CN');
  });
});
