// @vitest-environment jsdom
// issue 177：切页七功能进表之后，改键冲突**不能关窗**。
// issue 178：屏蔽 = 暂停 —— 重新启用写回屏蔽前的键位；该键被占用时就地改键完成启用。
//
// 为什么要 DOM 测试：`onCommit` 返回 error、弹窗留在原地、草稿可重按、「启用」撞键转弹窗 ——
// 这些都在事件时序里，单测（纯函数）够不着。
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

describe('issue 177/178 · 切页行、改键冲突与重新启用', () => {
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

  // issue 178（用户 2026-10-28 定案 Q1=A）：屏蔽 = 暂停，不是丢配置。
  it('屏蔽后再启用恢复屏蔽前的键位，而不是出厂默认', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));

    // 把「切换到工程」改成 Alt+9
    fireEvent.click(screen.getByRole('button', { name: '修改切换到工程的快捷键' }));
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit9' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(rowOf('切换到工程').textContent).toContain('Alt+9');

    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '禁用切换到工程' }));
    expect(rowOf('切换到工程').textContent).toContain('已屏蔽');

    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '启用切换到工程' }));
    expect(rowOf('切换到工程').textContent).toContain('Alt+9');
    expect(document.querySelector('.shortcut-recorder')).toBeNull();
  });

  // issue 178 定案 Q2=C：不抢占、也不干留在屏蔽态——就地改键，确认即完成启用。
  // 这里用**自定义**键位（不是出厂键）走完整条链路：这正是用户报障的场景。
  it('屏蔽期间旧键被别的功能占走：启用转为就地改键（预填旧键 + 冲突提示）', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));

    // 自定义「切换到工程」= Alt+9，再屏蔽（记录 Alt+9）
    fireEvent.click(screen.getByRole('button', { name: '修改切换到工程的快捷键' }));
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit9' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '禁用切换到工程' }));
    expect(rowOf('切换到工程').textContent).toContain('已屏蔽');

    // 把 Alt+9 让给「切换到工作台」（屏蔽期间该键空闲，Q3 定案：不占位）
    fireEvent.click(screen.getByRole('button', { name: '修改切换到工作台的快捷键' }));
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit9' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(rowOf('切换到工作台').textContent).toContain('Alt+9');

    // 启用 → 记录器打开、预填 Alt+9、就地报占用者，行仍是「已屏蔽」
    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '启用切换到工程' }));
    expect(document.querySelector('.shortcut-recorder')).not.toBeNull();
    expect(document.querySelector('.shortcut-recorder__keys')?.textContent).toBe('Alt+9');
    expect(screen.getByRole('alert').textContent).toContain('切换到工作台');
    expect(rowOf('切换到工程').textContent).toContain('已屏蔽');

    // 换一个空闲键确认 → 写入并同时启用；占用者不动
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit8' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(document.querySelector('.shortcut-recorder')).toBeNull();
    expect(rowOf('切换到工程').textContent).toContain('Alt+8');
    expect(rowOf('切换到工作台').textContent).toContain('Alt+9');
  });

  it('冲突时就地改键弹窗按 Esc 取消 → 保持屏蔽', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));

    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '禁用切换到工程' }));
    fireEvent.click(screen.getByRole('button', { name: '修改切换到工作台的快捷键' }));
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit1' });
    fireEvent.keyDown(window, { key: 'Enter' });

    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '启用切换到工程' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(document.querySelector('.shortcut-recorder')).toBeNull();
    expect(rowOf('切换到工程').textContent).toContain('已屏蔽');
    expect(rowOf('切换到工作台').textContent).toContain('Alt+1');
  });

  it('冲突时就地改键弹窗点外部取消 → 保持屏蔽', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));

    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '禁用切换到工程' }));
    fireEvent.click(screen.getByRole('button', { name: '修改切换到工作台的快捷键' }));
    fireEvent.keyDown(window, { key: '¡', altKey: true, code: 'Digit1' });
    fireEvent.keyDown(window, { key: 'Enter' });

    fireEvent.click(within(rowOf('切换到工程')).getByRole('button', { name: '启用切换到工程' }));
    fireEvent.click(document.querySelector('.shortcut-recorder') as HTMLElement);

    expect(document.querySelector('.shortcut-recorder')).toBeNull();
    expect(rowOf('切换到工程').textContent).toContain('已屏蔽');
  });
});
