// @vitest-environment jsdom
// issue 257 · 改键录制弹窗拒绝 ⌘Q：复用冲突提示通道（弹窗不关、就地提示、草稿保留可重按）。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
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

let platformDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform');
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' });
  window.localStorage.clear();
  seedZhSettings();
  stubPageShellEnv();
  Element.prototype.scrollTo = (() => {}) as unknown as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  cleanup();
  if (platformDescriptor) Object.defineProperty(window.navigator, 'platform', platformDescriptor);
});

describe('issue 257 · 录制弹窗拒绝 ⌘Q', () => {
  it('按 ⌘Q 只出保留提示：弹窗不关、草稿不写入；换成 Control+Q 可继续录制', async () => {
    await act(async () => { mountPage(); });
    fireEvent.click(screen.getByRole('button', { name: '系统' }));
    fireEvent.click(screen.getByRole('button', { name: '修改切换到工程的快捷键' }));
    expect(document.querySelector('.shortcut-recorder')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'q', metaKey: true, ctrlKey: false });
    expect(document.querySelector('.shortcut-recorder')).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('⌘Q 保留给系统退出');
    expect(document.querySelector('.shortcut-recorder__keys')?.textContent).not.toContain('⌘Q');

    fireEvent.keyDown(window, { key: 'q', metaKey: false, ctrlKey: true });
    expect(document.querySelector('.shortcut-recorder')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.shortcut-recorder__keys')?.textContent).toBe('⌃Q');
  });
});
