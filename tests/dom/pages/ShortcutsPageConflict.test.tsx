// @vitest-environment jsdom
// issue 177：切页七功能进表之后，改键冲突**不能关窗**。
//
// 为什么要 DOM 测试：`onCommit` 返回 error、弹窗留在原地、草稿可重按 —— 这三件事都在事件时序里，
// 单测（纯函数）够不着。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ShortcutsPage from '@/src/pages/settings/ShortcutsPage';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

function mountPage() {
  return renderWithProviders(
    <ConfigProvider>
      <ShortcutsPage />
    </ConfigProvider>,
  );
}

/** 表格里某一功能那一行（按功能名找，再上溯到 row） */
const rowOf = (label: string): HTMLElement => {
  const cell = screen.getAllByText(label)[0];
  const row = cell.closest('.shortcut-row');
  if (!row) throw new Error(`找不到「${label}」所在行`);
  return row as HTMLElement;
};

beforeEach(() => {
  window.localStorage.clear();
  seedZhSettings();
  stubPageShellEnv();
  // jsdom 没有布局引擎：换桶回顶那一下要有个 noop（真实滚动不在 DOM 测试断言范围）
  Element.prototype.scrollTo = (() => {}) as unknown as typeof Element.prototype.scrollTo;
});

describe('issue 177 · 切页行与改键冲突', () => {
  it('切页七功能是普通可改行（不是只读系统行）：有编辑钮、显示默认 Alt+1', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));

    const row = rowOf('切换到工程');
    expect(row.className).not.toContain('is-system');
    expect(row.textContent).toContain('Alt');
    // 编辑钮可用（只读行那颗是 disabled）
    expect(screen.getByRole('button', { name: '修改切换到工程的快捷键' })).toBeEnabled();
  });

  it('冲突时弹窗不关、就地报错、保留草稿；换成空闲键后正常写入并关窗', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));

    fireEvent.click(screen.getByRole('button', { name: '修改切换到工程的快捷键' }));
    expect(document.querySelector('.shortcut-recorder')).not.toBeNull();

    // 撞「切换-单键」的 F
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(document.querySelector('.shortcut-recorder')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('已被功能');
    expect(document.querySelector('.shortcut-recorder__keys')?.textContent).toBe('F');

    // 空闲键：写入成功 → 关窗，行上显示新键（带 code，走 macOS ⌥+数字 的真实分支）
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit9' });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(document.querySelector('.shortcut-recorder')).toBeNull();
    expect(rowOf('切换到工程').textContent).toContain('Alt+9');
  });

  it('屏蔽期间该键被别的功能占走：重新启用被拒绝，行仍是「已屏蔽」', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));

    // 屏蔽「切换到工程」（出厂 Alt+1）
    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '禁用切换到工程' }));
    expect(rowOf('切换到工程').textContent).toContain('已屏蔽');

    // 把 Alt+1 让给「切换到工作台」（此刻空闲，合法）
    fireEvent.click(screen.getByRole('button', { name: '修改切换到工作台的快捷键' }));
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit1' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(rowOf('切换到工作台').textContent).toContain('Alt+1');

    // 重新启用：出厂键已被占 → 拒绝，不得写出重复绑定
    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '启用切换到工程' }));
    expect(rowOf('切换到工程').textContent).toContain('已屏蔽');
    expect(rowOf('切换到工作台').textContent).toContain('Alt+1');
  });
});
