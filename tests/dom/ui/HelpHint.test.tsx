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
