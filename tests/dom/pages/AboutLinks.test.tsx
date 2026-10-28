// @vitest-environment jsdom
//
// 票 18：关于页四行入口的**点击出口**。
//
// 为什么单测必须有这一条：`<a href>` 的默认行为在 jsdom 里是「不导航但会尝试导航」，
// 而真机上的错误形态是**应用内自己跳走**（Electron 里连地址栏都没有）。所以这里同时锁三件事：
//   ① 点一次 = 桥被调一次、拿到的是常量里那个地址；
//   ② 站内不导航（`preventDefault` 真的生效了）；
//   ③ 没有桥（在线版）= 开系统浏览器新标签页，不是静默失败。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import AppUpdateHost from '@/src/app/AppUpdateHost';
import SettingsPage from '@/src/pages/settings/SettingsPage';
import { PRODUCT_LINKS, shortUrl } from '@/src/app/productLinks';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

/** 关于页四行（顺序即断言顺序） */
const ROWS: Array<[string, string]> = [
  ['产品主页', PRODUCT_LINKS.home],
  ['使用文档', PRODUCT_LINKS.guide],
  ['GitHub 仓库', PRODUCT_LINKS.repository],
  ['问题反馈', PRODUCT_LINKS.issues],
];

function openAbout() {
  const result = renderWithProviders(
    <ConfigProvider>
      <AppUpdateHost />
      <SettingsPage />
    </ConfigProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '关于' }));
  return result;
}

let openExternal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  seedZhSettings();
  stubPageShellEnv();
  openExternal = vi.fn(async () => true);
  (window as unknown as { electronAPI: unknown }).electronAPI = { shell: { openExternal } };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

describe('票 18 · 关于页四行入口', () => {
  it('四行都在、href 是常量地址、tooltip 是去掉协议的短形', () => {
    openAbout();
    for (const [label, url] of ROWS) {
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', url);
      // 正文里看不到地址，地址只在 tooltip 里
      expect(link).toHaveAttribute('title', shortUrl(url));
      expect(link.textContent).not.toMatch(/https?:\/\//);
    }
  });

  it('点一行：拦掉默认导航、走桥开系统浏览器一次', async () => {
    openAbout();
    const before = window.location.href;

    for (const [label, url] of ROWS) {
      fireEvent.click(screen.getByRole('link', { name: label }));
      await waitFor(() => expect(openExternal).toHaveBeenCalledWith(url));
    }
    expect(openExternal).toHaveBeenCalledTimes(ROWS.length);
    expect(window.location.href).toBe(before);
  });

  it('没有桥（在线版）：开新标签页，且带 noopener', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    openAbout();

    fireEvent.click(screen.getByRole('link', { name: '使用文档' }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(PRODUCT_LINKS.guide, '_blank', 'noopener,noreferrer');
  });
});
