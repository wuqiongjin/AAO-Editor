// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import SettingsPage from '@/src/pages/settings/SettingsPage';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

function renderSettings() {
  return renderWithProviders(
    <ConfigProvider>
      <SettingsPage />
    </ConfigProvider>,
  );
}

beforeEach(() => {
  seedZhSettings();
  stubPageShellEnv();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('票 04 · 诊断包入口归在导出动作下', () => {
  it('无桥时关于段不出现诊断包', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.queryByRole('button', { name: '导出诊断包' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /附带当前谱面/ })).toBeNull();
  });

  it('有桥时「附带谱面」是同一行里的导出选项，不是并列开关', () => {
    (window as unknown as { electronAPI: { diagnostics: { export: () => Promise<{ cancelled: boolean }> } } }).electronAPI = {
      diagnostics: { export: vi.fn(async () => ({ cancelled: true })) },
    };
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));

    const exportBtn = screen.getByRole('button', { name: '导出诊断包' });
    const include = screen.getByRole('checkbox', { name: /附带当前谱面/ });
    expect(include).toHaveAttribute('aria-checked', 'false');
    expect(exportBtn.closest('.settings-row')).toBe(include.closest('.settings-row'));
    expect(exportBtn.closest('.settings-row')).toHaveClass('settings-row--diagnostics');
    expect(screen.queryByRole('switch', { name: /附带当前谱面/ })).toBeNull();
  });
});
