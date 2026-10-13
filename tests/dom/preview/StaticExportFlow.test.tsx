// @vitest-environment jsdom
// chart-preview 37：静态预览「导出图片」弹窗与「导出信息」头带设置流程锁测。
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import StaticExportControl from '@/src/pages/preview/StaticExportControl';
import { DEFAULT_EXPORT_FIELDS, defaultSettings } from '@/src/chart/config/AppSettings';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';
import type { SheetPlan } from '@/src/preview';

interface StoredSettings {
  display: Record<string, unknown>;
  preview: Record<string, unknown>;
  export: Record<string, unknown>;
}

const stored = (): StoredSettings => JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as StoredSettings;

const okPlan: SheetPlan = {
  ok: true,
  sheetW: 8959,
  sheetH: 3662,
  rows: 1,
  cols: 31,
  headerH: 440,
  dpr: 2,
  downscaled: false,
};

const refusedPlan: SheetPlan = {
  ok: false,
  detail: '宽度超过浏览器画布上限',
};

function setup(props: Partial<Parameters<typeof StaticExportControl>[0]> = {}) {
  seedZhSettings();
  const onExport = vi.fn();
  const result = render(
    <ConfigProvider>
      <StaticExportControl
        exportPlan={okPlan}
        onExport={onExport}
        {...props}
      />
    </ConfigProvider>,
  );
  return { onExport, ...result };
}

const trigger = () => screen.getByRole('button', { name: '导出' });
const panel = () => screen.getByRole('dialog', { name: '导出图片' });
const exportSwitch = (name: string) => within(panel()).getByRole('switch', { name });
const headerToggle = () => within(panel()).getByRole('switch', { name: '启用头带' });
const startBtn = () => within(panel()).getByRole('button', { name: '开始导出' });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chart-preview 37 · 静态导出控件弹窗打开与关闭', () => {
  it('点击工具栏「导出」按钮弹出「导出图片」浮层', () => {
    setup();
    expect(screen.queryByRole('dialog', { name: '导出图片' })).toBeNull();
    fireEvent.click(trigger());
    expect(panel()).toBeInTheDocument();
    expect(within(panel()).getByText('导出图片')).toBeInTheDocument();
    expect(within(panel()).getByText('导出信息')).toBeInTheDocument();
  });

  it('再次点击触发钮或按 Escape 键关闭弹层', () => {
    setup();
    fireEvent.click(trigger());
    expect(panel()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '导出图片' })).toBeNull();

    fireEvent.click(trigger());
    expect(panel()).toBeInTheDocument();
    fireEvent.click(trigger());
    expect(screen.queryByRole('dialog', { name: '导出图片' })).toBeNull();
  });

  it('点击弹层外部区域关闭弹窗', () => {
    setup();
    fireEvent.click(trigger());
    expect(panel()).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: '导出图片' })).toBeNull();
  });
});

describe('chart-preview 37 · 导出信息字段与头带总开关', () => {
  it('七项字段都在；默认档 = 谱面标题 / 难度 + 等级 / BPM 开，其余关', () => {
    setup();
    fireEvent.click(trigger());

    expect(headerToggle()).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('谱面标题')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('难度 + 等级')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('BPM')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('工程名')).toHaveAttribute('aria-checked', 'false');
    expect(exportSwitch('时长')).toHaveAttribute('aria-checked', 'false');
    expect(exportSwitch('音符数')).toHaveAttribute('aria-checked', 'false');
    expect(exportSwitch('导出时间')).toHaveAttribute('aria-checked', 'false');
  });

  it('开关写进落盘 export 段，且不碰 preview / display', () => {
    setup();
    fireEvent.click(trigger());

    fireEvent.click(exportSwitch('工程名'));
    expect(stored().export.projectName).toBe(true);

    fireEvent.click(exportSwitch('BPM'));
    expect(exportSwitch('BPM')).toHaveAttribute('aria-checked', 'false');
    expect(stored().export).toEqual({ ...DEFAULT_EXPORT_FIELDS, projectName: true, bpm: false });
    expect(stored().preview).toEqual(defaultSettings().preview);
    expect(stored().display).toEqual(defaultSettings().display);
  });

  it('关掉「启用头带」：七项置灰但保留勾选；再开原样恢复', () => {
    setup();
    fireEvent.click(trigger());

    fireEvent.click(headerToggle());
    expect(stored().export.enabled).toBe(false);

    expect(exportSwitch('谱面标题')).toBeDisabled();
    expect(exportSwitch('BPM')).toBeDisabled();
    expect(exportSwitch('工程名')).toBeDisabled();
    expect(exportSwitch('谱面标题')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('BPM')).toHaveAttribute('aria-checked', 'true');
    expect(exportSwitch('工程名')).toHaveAttribute('aria-checked', 'false');

    // 置灰期间点击无效
    fireEvent.click(exportSwitch('工程名'));
    expect(stored().export.projectName).toBe(false);

    fireEvent.click(headerToggle());
    expect(stored().export.enabled).toBe(true);
    expect(exportSwitch('BPM')).not.toBeDisabled();
    expect(stored().export).toEqual(DEFAULT_EXPORT_FIELDS);
  });
});

describe('chart-preview 37 · 帮助说明浮层（? 按钮）', () => {
  it('点击 ? 按钮展开帮助气泡，文案末尾不带句号', () => {
    setup();
    fireEvent.click(trigger());

    const helpBtn = within(panel()).getByRole('button', { name: '在长图顶部添加包含封面与曲目信息的横带' });
    expect(helpBtn).toBeInTheDocument();

    expect(document.querySelector('.pvex__help-popover')).toBeNull();
    fireEvent.click(helpBtn);

    const popover = document.querySelector('.pvex__help-popover');
    expect(popover).toBeInTheDocument();
    expect(popover).toHaveTextContent('在长图顶部添加包含封面与曲目信息的横带');
    expect(popover?.textContent?.endsWith('。')).toBe(false);

    // 再次点击收起
    fireEvent.click(helpBtn);
    expect(document.querySelector('.pvex__help-popover')).toBeNull();
  });
});

describe('chart-preview 37 · 开始导出与超限状态', () => {
  it('正常规划下，点击「开始导出」收起弹层并触发 onExport 回调', () => {
    const { onExport } = setup();
    fireEvent.click(trigger());

    expect(startBtn()).not.toBeDisabled();
    fireEvent.click(startBtn());

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '导出图片' })).toBeNull();
  });

  it('超限（exportPlan.ok === false）时「开始导出」按钮置灰禁用，并显示原因', () => {
    const { onExport } = setup({ exportPlan: refusedPlan });
    fireEvent.click(trigger());

    expect(startBtn()).toBeDisabled();
    expect(within(panel()).getByText(/这张谱面出不了图：宽度超过浏览器画布上限/)).toBeInTheDocument();

    fireEvent.click(startBtn());
    expect(onExport).not.toHaveBeenCalled();
  });

  it('正在导出（exporting === true）时触发按钮显示「导出中…」并禁用', () => {
    setup({ exporting: true });
    const btn = screen.getByRole('button', { name: '导出中…' });
    expect(btn).toBeDisabled();
  });
});
