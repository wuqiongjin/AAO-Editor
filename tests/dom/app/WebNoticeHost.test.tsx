// @vitest-environment jsdom
// 票 04：在线版的首次访问说明。锁定的是「无桌面桥 + 这台浏览器没看过」才弹一次，
// 且关掉（按钮 / Esc）与「不再弹」是同一个出口 —— 不能点了按钮关掉、刷新又弹回来。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import WebNoticeHost from '@/src/app/WebNoticeHost';
import { WEB_NOTICE_KEY } from '@/src/app/webNotice';

const ITEMS = ['部分功能仅在桌面版支持', '工程数据仅保存在本浏览器', '完整功能请使用桌面版'];

beforeEach(() => {
  localStorage.removeItem(WEB_NOTICE_KEY);
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('票 04 · 在线版首访说明', () => {
  it('没有桌面桥、这台浏览器没看过：弹一次，三条细则各自成条', () => {
    render(<WebNoticeHost />);
    expect(screen.getByRole('heading', { name: '在线版说明' })).toBeInTheDocument();
    // 不写导语：三条各说一件事，不许回退成一整段长句
    for (const text of ITEMS) expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
    expect(document.querySelectorAll('.web-note__item')).toHaveLength(ITEMS.length);
    expect(document.querySelectorAll('.web-note__item svg')).toHaveLength(ITEMS.length);
    // 指路小字在底栏，且不再叫「完整说明」（弹窗本身就是完整的那份）
    expect(screen.getByText('可在 设置 › 关于 再次查看')).toHaveClass('web-note__more');
  });

  it('点「我已知晓」：关掉并记账，重新挂载不再出现', () => {
    const first = render(<WebNoticeHost />);
    fireEvent.click(screen.getByRole('button', { name: '我已知晓' }));
    expect(screen.queryByRole('heading', { name: '在线版说明' })).toBeNull();
    expect(localStorage.getItem(WEB_NOTICE_KEY)).toBe('1');

    first.unmount();
    render(<WebNoticeHost />);
    expect(screen.queryByRole('heading', { name: '在线版说明' })).toBeNull();
  });

  it('Esc 关掉同样记账：不留「关掉又回来」的路', () => {
    render(<WebNoticeHost />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: '在线版说明' })).toBeNull();
    expect(localStorage.getItem(WEB_NOTICE_KEY)).toBe('1');
  });

  it('点遮罩（弹窗唯一的第三个出口）也算关掉并记账', () => {
    render(<WebNoticeHost />);
    const scrim = document.querySelector('.dialog__scrim');
    expect(scrim).not.toBeNull();
    fireEvent.mouseDown(scrim!);
    expect(screen.queryByRole('heading', { name: '在线版说明' })).toBeNull();
    expect(localStorage.getItem(WEB_NOTICE_KEY)).toBe('1');
  });

  it('桌面运行时（有 electronAPI）：一次都不出现', () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = { appUpdate: {} };
    render(<WebNoticeHost />);
    expect(screen.queryByRole('heading', { name: '在线版说明' })).toBeNull();
    expect(localStorage.getItem(WEB_NOTICE_KEY)).toBeNull();
  });
});
