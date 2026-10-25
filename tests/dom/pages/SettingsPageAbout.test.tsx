// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import AppUpdateHost from '@/src/app/AppUpdateHost';
import SettingsPage from '@/src/pages/settings/SettingsPage';
import { APP_VERSION } from '@/src/app/appVersion';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';
import type { AppUpdateState } from '@/src/app/appUpdate';
import * as ToastModule from '@/src/ui/Toast';

function renderAbout() {
  return renderWithProviders(
    <ConfigProvider>
      <AppUpdateHost />
      <SettingsPage />
    </ConfigProvider>,
  );
}

function stubPackagedUpdate(
  initial: Partial<AppUpdateState> = {},
  result: AppUpdateState['status'] = 'current',
) {
  let state: AppUpdateState = {
    packaged: true,
    currentVersion: '0.1.0',
    status: 'idle',
    ...initial,
  };
  const listeners: Array<(s: AppUpdateState) => void> = [];
  const install = vi.fn(async () => state);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    appUpdate: {
      getState: async () => state,
      check: async () => {
        state = { ...state, status: result };
        listeners.forEach((fn) => fn(state));
        return state;
      },
      install,
      onEvent: (cb: (s: AppUpdateState) => void) => {
        listeners.push(cb);
        return () => {};
      },
    },
  };
  return { install };
}

beforeEach(() => {
  seedZhSettings();
  stubPageShellEnv();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('ADR-0021 · 设置页关于', () => {
  it('浏览器：关于只展示应用版本，没有检查更新与自动检查', () => {
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.getByRole('heading', { level: 2, name: '关于' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(APP_VERSION))).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: '自动检查' })).toBeNull();
    expect(screen.queryByRole('button', { name: '检查更新' })).toBeNull();
    // 票 04：浏览器里补一段身份说明（与首访弹窗同一份内容）。
    // 锁三个形态事实：它并入身份卡下半段（.about-note 在 .about-identity 里，不是悬空一段
    // 文字、也不是另一张卡）、用共享内容的 compact 档、并且自带小标题。
    const first = screen.getByText(/部分功能仅在桌面版支持/);
    const note = first.closest('.about-note');
    expect(note).not.toBeNull();
    expect(note!.closest('.about-identity')).not.toBeNull();
    expect(note!.querySelector('.web-note--compact')).not.toBeNull();
    expect(screen.getByText('在线版说明')).toHaveClass('about-note__title');
    // 三条各自带图标：它们是并列条目的分行锚点（2026-10-25 验收：少了图标像一坨）
    expect(note!.querySelectorAll('.web-note__item svg')).toHaveLength(3);
  });

  it('已安装包：关于露出自动检查与检查更新，开关写入设置对象', async () => {
    stubPackagedUpdate();
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: '自动检查' })).toBeInTheDocument();
    });
    const toggle = screen.getByRole('switch', { name: '自动检查' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    expect(persisted.autoCheck).toBe(false);
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();
    // 票 04：桌面版不写「在线版说明」——用户不需要被告知自己用的是完整版
    expect(screen.queryByText(/部分功能仅在桌面版支持/)).toBeNull();
  });

  it('启动自动检查失败：不出 toast', async () => {
    stubPackagedUpdate({}, 'error');
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    await screen.findByRole('button', { name: '检查更新' });
    await waitFor(() => expect(toastSpy).not.toHaveBeenCalled());
    toastSpy.mockRestore();
  });

  it('手动检查已是最新：一条成功 toast，行内不重复终态文案', async () => {
    stubPackagedUpdate();
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    const check = await screen.findByRole('button', { name: '检查更新' });
    fireEvent.click(check);
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('已是最新。', 'success'));
    expect(screen.queryAllByText('已是最新。')).toHaveLength(0);
    toastSpy.mockRestore();
  });

  it('新版本已就绪：关掉弹窗后关于页变成立即重启，不再检查更新', async () => {
    const { install } = stubPackagedUpdate({ status: 'ready', availableVersion: '0.2.0' }, 'ready');
    renderAbout();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '重启以更新' })).toBeInTheDocument();
    expect(screen.getByText('0.2.0 已就绪（当前 0.1.0）。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.getByText('新版本已就绪。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查更新' })).toBeNull();
    expect(screen.getAllByText('立即重启').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '立即重启' }));
    await waitFor(() => expect(install).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('手动检查失败：一条危险 toast，不在关于里写两遍', async () => {
    stubPackagedUpdate({}, 'error');
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    fireEvent.click(await screen.findByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('暂时查不到更新，请稍后重试。', 'danger'));
    expect(screen.queryAllByText('暂时查不到更新，请稍后重试。')).toHaveLength(0);
    toastSpy.mockRestore();
  });
});
