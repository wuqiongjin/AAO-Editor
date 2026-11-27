// @vitest-environment jsdom
// 票 39 回修锁测（用户 2026-10-14 真机验收：「点外面收不掉」「和编辑工程信息那枚不一样」）。
//
// 这条必须**带着 `Dialog` 跑**：`Dialog` 的面板在 `onMouseDown` 上 `stopPropagation()`
// （src/ui/Dialog.tsx），第一版把监听挂在 `document` 的冒泡阶段 ⇒ 点哪儿都收不掉。
// 单测里不带弹窗就永远绿、真机却坏 —— 正是这类"环境差异"要靠这层壳复现。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Dialog from '@/src/ui/Dialog';
import HelpHint from '@/src/ui/HelpHint';

function renderInDialog(onClose = vi.fn()) {
  render(
    <Dialog head={<HelpHint text="密码只发往站点" placement="down" />} onClose={onClose} footer={null}>
      <p>正文</p>
    </Dialog>,
  );
  return onClose;
}

const bubble = () => screen.queryByRole('tooltip');
const helpBtn = () => screen.getByRole('button', { name: '密码只发往站点' });

describe('票 39 回修 · HelpHint 的收起（与「编辑工程信息」那枚同行为）', () => {
  it('点气泡外面 → 收起（弹窗面板在冒泡路径上 stopPropagation 也拦不住：监听挂捕获阶段）', () => {
    renderInDialog();
    fireEvent.click(helpBtn());
    expect(bubble()).toBeInTheDocument();

    // 弹窗正文里任意一处（弹窗面板内部 —— 正是 stopPropagation 挡住那一层）
    fireEvent.pointerDown(screen.getByText('正文'));

    expect(bubble()).toBeNull();
  });

  it('点气泡自己 → 不收（按钮是开关键，收起交给"再点一下"）', () => {
    renderInDialog();
    fireEvent.click(helpBtn());

    fireEvent.pointerDown(helpBtn());

    expect(bubble()).toBeInTheDocument();
  });

  it('Esc 归弹窗管：气泡开着时按 Esc 关的是弹窗（气泡随它一起消失）', () => {
    const onClose = renderInDialog();
    fireEvent.click(helpBtn());
    expect(bubble()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('开关键读得出状态：aria-expanded + tooltip 内容就是那句话（读屏与悬停都念得到）', () => {
    renderInDialog();
    const btn = helpBtn();
    expect(btn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(btn);

    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(bubble()).toHaveTextContent('密码只发往站点');
    expect(btn).toHaveAttribute('title', '密码只发往站点');
  });
});

function withViewport(width: number, height: number, run: () => void) {
  const innerWidthDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const innerHeightDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  try {
    run();
  } finally {
    if (innerWidthDesc) Object.defineProperty(window, 'innerWidth', innerWidthDesc);
    if (innerHeightDesc) Object.defineProperty(window, 'innerHeight', innerHeightDesc);
  }
}

describe('HelpHint Portal 定位与窄面板防裁剪', () => {
  it('挂载到 document.body，不被 overflow:hidden/auto 祖先裁切，且点气泡自身不收起', () => {
    const { container } = render(
      <div style={{ width: 320, overflowX: 'hidden', overflowY: 'auto' }} data-testid="clip-box">
        <HelpHint text="超长提示正文" placement="up" />
      </div>,
    );
    const clipBox = screen.getByTestId('clip-box');
    const btn = screen.getByRole('button', { name: '超长提示正文' });

    fireEvent.click(btn);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveClass('is-portaled');
    expect(tip.parentElement).toBe(document.body);
    expect(clipBox.contains(tip)).toBe(false);
    expect(container.contains(tip)).toBe(false);

    // 点气泡内部不会误收起
    fireEvent.pointerDown(tip);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // 点气泡与按钮外区域正常收起
    fireEvent.pointerDown(clipBox);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('触发按钮靠近视口右缘时，横向夹紧不溢出视口且箭头对齐按钮中心', () => {
    withViewport(1280, 720, () => {
      render(<HelpHint text="靠右测试气泡" placement="up" />);
      const btn = screen.getByRole('button', { name: '靠右测试气泡' });
      vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
        left: 1220, right: 1236, top: 420, bottom: 436, width: 16, height: 16,
        x: 1220, y: 420, toJSON: () => ({}),
      });

      fireEvent.click(btn);
      const tip = screen.getByRole('tooltip');
      expect(tip).not.toHaveClass('is-below');
      expect(tip.style.width).toBe('280px');
      expect(tip.style.left).toBe(`${1280 - 8 - 280}px`);
      expect(tip.style.bottom).toBe(`${720 - 420 + 8}px`);
      // centerX = 1228; arrowLeft = 1228 - 992 - 5 = 231
      expect(tip.style.getPropertyValue('--help-hint-arrow-left')).toBe('231px');
    });
  });

  it('上方空间不足时自动翻转为 down；下方不足时自动翻转为 up', () => {
    withViewport(1280, 720, () => {
      const { unmount } = render(<HelpHint text="顶部翻转" placement="up" />);
      const upBtn = screen.getByRole('button', { name: '顶部翻转' });
      vi.spyOn(upBtn, 'getBoundingClientRect').mockReturnValue({
        left: 600, right: 616, top: 32, bottom: 48, width: 16, height: 16,
        x: 600, y: 32, toJSON: () => ({}),
      });
      fireEvent.click(upBtn);
      const downTip = screen.getByRole('tooltip');
      expect(downTip).toHaveClass('is-below');
      expect(downTip.style.top).toBe(`${48 + 8}px`);
      unmount();

      render(<HelpHint text="底部翻转" placement="down" />);
      const downBtn = screen.getByRole('button', { name: '底部翻转' });
      vi.spyOn(downBtn, 'getBoundingClientRect').mockReturnValue({
        left: 600, right: 616, top: 680, bottom: 696, width: 16, height: 16,
        x: 600, y: 680, toJSON: () => ({}),
      });
      fireEvent.click(downBtn);
      const upTip = screen.getByRole('tooltip');
      expect(upTip).not.toHaveClass('is-below');
      expect(upTip.style.bottom).toBe(`${720 - 680 + 8}px`);
    });
  });
});
