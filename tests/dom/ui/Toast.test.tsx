// @vitest-environment jsdom
// issue 17：轻提示宿主的行为锁测（弹一条 / 按时消失 / 手动关 / 语气即 role / 顶掉前一条）。
// 视觉（胶囊形状、四档配色、层高在弹窗之上）jsdom 无布局引擎 —— 走静态断言（NoWindowAlert.test.ts）
// 与实机出图，不在这一层断言。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import ToastHost, { dismissToast, showToast } from '@/src/ui/Toast';

describe('issue 17 · 轻提示', () => {
  // 收尾也走 act：宿主可能还挂着，直接改状态会被 React 记一笔"没包 act"
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => dismissToast());
  });

  afterEach(() => {
    act(() => dismissToast());
    vi.useRealTimers();
  });

  it('弹一条就上屏，成功类到点自己消失', () => {
    render(<ToastHost />);
    act(() => showToast('谱面代码已应用', 'success'));
    expect(screen.getByText('谱面代码已应用')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.queryByText('谱面代码已应用')).toBeNull();
  });

  it('成功类用 status（polite），警告 / 失败用 alert（assertive）', () => {
    render(<ToastHost />);
    act(() => showToast('已复制到剪贴板', 'success'));
    expect(screen.getByRole('status')).toHaveTextContent('已复制到剪贴板');

    act(() => showToast('应用失败：第 3 行 JSON 语法错', 'danger'));
    expect(screen.getByRole('alert')).toHaveTextContent('应用失败：第 3 行 JSON 语法错');
  });

  it('失败类停留更久：不会被成功类的短时长提前带走', () => {
    render(<ToastHost />);
    act(() => showToast('另存为失败', 'danger'));

    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.getByText('另存为失败')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(2400); }); // 累计 5000ms
    expect(screen.queryByText('另存为失败')).toBeNull();
  });

  it('同一时刻只留一条：后来的把前一条顶掉', () => {
    render(<ToastHost />);
    act(() => showToast('第一条', 'info'));
    act(() => showToast('第二条', 'info'));

    expect(screen.queryByText('第一条')).toBeNull();
    expect(screen.getByText('第二条')).toBeInTheDocument();
  });

  it('点关闭立刻消失', () => {
    render(<ToastHost />);
    act(() => showToast('不能删除最后一张谱面', 'warn'));

    act(() => screen.getByRole('button', { name: '关闭提示' }).click());

    expect(screen.queryByText('不能删除最后一张谱面')).toBeNull();
  });

  it('宿主挂载前已经发出去的提示，挂上后补显示（提示不丢）', () => {
    showToast('先发后挂', 'info');
    render(<ToastHost />);

    expect(screen.getByText('先发后挂')).toBeInTheDocument();
  });
});
