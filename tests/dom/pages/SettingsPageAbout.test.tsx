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

function axesFromStatus(status: AppUpdateState['status']): Pick<AppUpdateState, 'remote' | 'local'> {
  if (status === 'downloading') return { remote: 'available', local: 'downloading' };
  if (status === 'ready') return { remote: 'available', local: 'ready' };
  if (status === 'available') return { remote: 'available', local: 'none' };
  if (status === 'checking') return { remote: 'checking', local: 'none' };
  if (status === 'current') return { remote: 'current', local: 'none' };
  if (status === 'error') return { remote: 'error', local: 'none' };
  return { remote: 'idle', local: 'none' };
}

function stubPackagedUpdate(
  initial: Partial<AppUpdateState> = {},
  result: AppUpdateState['status'] = 'current',
) {
  const status = initial.status ?? 'idle';
  let state: AppUpdateState = {
    packaged: true,
    currentVersion: '0.1.0',
    status,
    updateSource: 'github',
    ...axesFromStatus(status),
    ...initial,
    remote: initial.remote ?? axesFromStatus(status).remote,
    local: initial.local ?? axesFromStatus(status).local,
    cycle: initial.cycle ?? 0,
  };
  const listeners: Array<(s: AppUpdateState) => void> = [];
  const install = vi.fn(async () => state);
  let cycle = initial.cycle ?? 0;
  const download = vi.fn(async () => {
    state = { ...state, local: 'downloading', status: 'downloading' as const, percent: 0 };
    listeners.forEach((fn) => fn(state));
    state = {
      ...state,
      local: 'ready',
      status: 'ready' as const,
      percent: 100,
      readyVersion: state.availableVersion,
    };
    listeners.forEach((fn) => fn(state));
    return state;
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    appUpdate: {
      getState: async () => state,
      check: async () => {
        if (state.local === 'downloading') return state;
        const keptLocal = state.local;
        const keptReady = state.readyVersion;
        cycle += 1;
        state = {
          ...state,
          cycle,
          status: keptLocal === 'ready' && result === 'available' ? 'ready' : result,
          ...axesFromStatus(result),
          local: keptLocal === 'ready' ? 'ready' : axesFromStatus(result).local,
          readyVersion: keptLocal === 'ready' ? keptReady : undefined,
          errorMessage: result === 'error' ? (state.errorMessage ?? 'net::ERR_FAILED') : state.errorMessage,
        };
        listeners.forEach((fn) => fn(state));
        return state;
      },
      install,
      download,
      setUpdateSource: async (source: AppUpdateState['updateSource']) => {
        state = { ...state, updateSource: source ?? 'github' };
        listeners.forEach((fn) => fn(state));
        return { ...state, ok: true };
      },
      onEvent: (cb: (s: AppUpdateState) => void) => {
        listeners.push(cb);
        return () => {};
      },
    },
  };
  return {
    install,
    download,
    emit(next: AppUpdateState) {
      const status = next.status;
      state = {
        ...state,
        ...next,
        remote: next.remote ?? axesFromStatus(status).remote,
        local: next.local ?? axesFromStatus(status).local,
        cycle: next.cycle ?? state.cycle,
      };
      listeners.forEach((fn) => fn(state));
    },
  };
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
    expect(screen.queryByRole('radiogroup', { name: '下载源' })).toBeNull();
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

  it('启动自动检查网络失败：toast 提示换下载源', async () => {
    stubPackagedUpdate({}, 'error');
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    await screen.findByRole('button', { name: '检查更新' });
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        '检查更新失败，可能是网络问题，可以尝试将下载源替换为 CNB。',
        'danger',
      );
    });
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

  it('查到新版本先弹下载确认；稍后关于仍是检查更新，包就绪才立即重启', async () => {
    const { download } = stubPackagedUpdate(
      { status: 'available', availableVersion: '0.2.0' },
      'available',
    );
    renderAbout();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '发现新版本' })).toBeInTheDocument();
    expect(screen.getByText('0.2.0 可用（当前 0.1.0）。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下载' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即重启' })).toBeNull();
    expect(screen.queryByText(/已就绪/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(download).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.getByText('发现新版本。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即重启' })).toBeNull();
  });

  it('弹窗点下载后包就绪：立即重启留在弹窗和关于，不先关掉再找按钮', async () => {
    const { download } = stubPackagedUpdate(
      { status: 'available', availableVersion: '0.2.0' },
      'available',
    );
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(await screen.findByRole('button', { name: '下载' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      '正在后台下载，可在设置 → 关于的检查更新处查看进度。',
      'info',
    );
    toastSpy.mockRestore();
    expect(await screen.findByRole('button', { name: '立即重启' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '重启以更新' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即重启' })).toBeInTheDocument();
  });

  it('新版本已就绪：关掉弹窗后关于同时留检查更新和立即重启，立即重启在左', async () => {
    const { install } = stubPackagedUpdate({
      status: 'ready',
      local: 'ready',
      remote: 'available',
      availableVersion: '0.2.0',
      readyVersion: '0.2.0',
    }, 'ready');
    renderAbout();
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '重启以更新' })).toBeInTheDocument();
    expect(screen.getByText('0.2.0 已就绪（当前 0.1.0）。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.getByText('新版本已就绪。')).toBeInTheDocument();
    const restart = screen.getByRole('button', { name: '立即重启' });
    const check = screen.getByRole('button', { name: '检查更新' });
    expect(restart).toHaveClass('button-primary');
    expect(check).toHaveClass('button-secondary');
    expect(restart.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(restart);
    await waitFor(() => expect(install).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('更新弹窗用 md 宽；点遮罩不关', async () => {
    stubPackagedUpdate({
      status: 'ready',
      local: 'ready',
      remote: 'available',
      availableVersion: '0.2.0',
      readyVersion: '0.2.0',
    }, 'ready');
    renderAbout();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.className).toMatch(/dialog--md/);
    fireEvent.mouseDown(document.querySelector('.dialog__scrim') as HTMLElement);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('下过后再检查点稍后：立即重启仍在关于，弹窗是重启不是下载', async () => {
    stubPackagedUpdate({
      status: 'ready',
      local: 'ready',
      remote: 'available',
      availableVersion: '0.2.0',
      readyVersion: '0.2.0',
    }, 'available');
    renderAbout();
    fireEvent.click(await screen.findByRole('button', { name: '稍后' }));
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.getByRole('button', { name: '立即重启' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByRole('heading', { name: '重启以更新' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    expect(screen.getByRole('button', { name: '立即重启' })).toBeInTheDocument();
  });

  it('手动检查网络失败：toast 含下载源与另一个源名，不在关于里写两遍', async () => {
    stubPackagedUpdate({}, 'error');
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    fireEvent.click(await screen.findByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(
      '检查更新失败，可能是网络问题，可以尝试将下载源替换为 CNB。',
      'danger',
    ));
    expect(screen.queryAllByText(/检查更新失败，可能是网络问题/)).toHaveLength(0);
    toastSpy.mockRestore();
  });

  it('校验失败 toast 不提换源', async () => {
    stubPackagedUpdate({ errorMessage: 'sha512 checksum mismatch' }, 'error');
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    fireEvent.click(await screen.findByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const msg = String(toastSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).not.toMatch(/下载源/);
    expect(msg).toMatch(/校验/);
    toastSpy.mockRestore();
  });

  it('下载中断网络失败：toast 提示换下载源', async () => {
    const { emit } = stubPackagedUpdate({ status: 'downloading', percent: 40, updateSource: 'github' });
    const toastSpy = vi.spyOn(ToastModule, 'showToast');
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    await screen.findByRole('radiogroup', { name: '下载源' });
    emit({
      packaged: true,
      currentVersion: '0.1.0',
      status: 'error',
      updateSource: 'github',
      errorMessage: 'net::ERR_CONNECTION_RESET',
    });
    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith(
      '检查更新失败，可能是网络问题，可以尝试将下载源替换为 CNB。',
      'danger',
    ));
    toastSpy.mockRestore();
  });

  it('已打包露出 GitHub/CNB 下载源；下载中控件禁用', async () => {
    stubPackagedUpdate({ status: 'downloading', percent: 40, updateSource: 'github' });
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: '关于' }));
    const group = await screen.findByRole('radiogroup', { name: '下载源' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'GitHub' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'CNB' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /GitHub/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'CNB' })).toBeDisabled();
  });
});
