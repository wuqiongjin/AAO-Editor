// @vitest-environment jsdom
// issue 29：预览页谱面切换器浮层的定位锁 —— 打开即贴触发钮左缘、**开着时伸缩跟随**。
//
// 它住工具栏**左簇**（左锚）：常规伸缩下左簇本来就不动，所以"不跟随"此前没人报；唯一破口是跨
// 720 断点（页面 padding 24 → 16 / 顶 24 → 20）后触发钮挪 8px / 4px 而面板留在原地（实测见票 29
// 的 Comments）。本文件把那 8px 钉死 —— 与设置面板（右簇、右锚）同款病灶、同一段 effect。
//
// 定位不靠布局引擎：jsdom 量不出矩形（`getBoundingClientRect()` 恒 0），触发钮矩形用 mock 注入，
// 照 ScopePicker.test.tsx 惯例。面板内联 left / top 是唯一可断言的定位真值。
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PreviewChartSwitcher from '@/src/pages/preview/PreviewChartSwitcher';
import { createBlankProject } from '@/src/project/projectCatalog';
import type { ChartProject } from '@/src/project/ChartProject';
import { seedZhSettings } from '@/tests/support/storage';

/** 两张谱面的工程（首张 = 当前在看的那张）；标题写死，好让行文案与难度徽标可断言 */
function projectWithTwoCharts(): ChartProject {
  const base = createBlankProject({ id: 'p1', chartId: 'c1', now: 1, name: 'Alpha' });
  return {
    ...base,
    charts: [
      { ...base.charts[0], title: 'First Beat' },
      { ...base.charts[0], id: 'c2', diff: 0, level: 3, title: 'Second Beat' },
    ],
  };
}

function renderSwitcher(chartId: string | null = 'c1') {
  seedZhSettings();
  const onPick = vi.fn();
  render(<PreviewChartSwitcher project={projectWithTwoCharts()} chartId={chartId} onPick={onPick} />);
  return { onPick };
}

const trigger = () => document.querySelector('.preview-chart__trigger') as HTMLElement;
const panel = () => screen.getByRole('listbox', { name: '选择要预览的谱面' });
const panelLeft = () => Number.parseFloat(panel().style.left);
const panelTop = () => Number.parseFloat(panel().style.top);

/** 触发钮的量测替身（宽 300 / 高 30：left 与 bottom 就是定位式的两个输入） */
function rectAt(left: number, bottom: number): DOMRect {
  return {
    x: left, y: bottom - 30, left, right: left + 300,
    top: bottom - 30, bottom, width: 300, height: 30, toJSON: () => ({}),
  } as DOMRect;
}

/** 注入矩形 + 点开；返回可变矩形，改它再派 `resize` = 模拟"伸缩后触发钮随布局移动" */
function openAt(left: number, bottom: number) {
  const rect = { left, bottom };
  vi.spyOn(trigger(), 'getBoundingClientRect').mockImplementation(() => rectAt(rect.left, rect.bottom));
  fireEvent.click(trigger());
  return rect;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('issue 29 · 谱面切换器浮层定位', () => {
  it('打开即贴触发钮左缘：left = 触发钮 left、top = 触发钮下缘 + 4', () => {
    renderSwitcher();
    openAt(259, 110.2);

    expect(panelLeft()).toBe(259);
    expect(panelTop()).toBe(114.2);
  });

  it('面板开着时伸缩窗口：重新量触发钮，面板跟随（不留在旧位置）', () => {
    renderSwitcher();
    const rect = openAt(259, 110.2);

    // 跨 720 断点：页面 padding 24 → 16 / 顶 24 → 20 ⇒ 触发钮实测 (−8, −4)
    rect.left = 251;
    rect.bottom = 106.2;
    fireEvent(window, new Event('resize'));

    expect(panelLeft()).toBe(251);
    expect(panelTop()).toBe(110.2);
  });

  it('布局晚一拍（触发钮几何在 resize 之后才落定）：当帧量旧位，后续帧补测跟上', async () => {
    renderSwitcher();
    const rect = openAt(259, 110.2);

    fireEvent(window, new Event('resize'));
    expect(panelLeft()).toBe(259);             // 当帧触发钮还没挪

    rect.left = 251;
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 60)); });

    expect(panelLeft()).toBe(251);
  });

  it('选另一张谱面：回调带 id，面板随手关掉', () => {
    const { onPick } = renderSwitcher();
    openAt(259, 110.2);

    fireEvent.click(screen.getAllByRole('option')[1]);

    expect(onPick).toHaveBeenCalledWith('c2');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
