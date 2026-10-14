// @vitest-environment jsdom
// issue 172 · 设置页清理布局空态与扁平化侧栏分组
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import SettingsPage from '@/src/pages/settings/SettingsPage';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';
import { readSource, stripComments } from '@/tests/support/source';

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

describe('issue 172 · 设置页清理布局空态与扁平化侧栏分组', () => {
  it('侧栏直接平铺：仅存在【外观】与【存储与数据】两项，不存在布局项与分组外壳', () => {
    const { container } = renderSettings();

    const sidebar = container.querySelector('.app-page-shell__sidebar');
    expect(sidebar).toBeInTheDocument();

    // 分组外壳（SidebarGroup）完全移除
    const groups = container.querySelectorAll('.app-page-shell__sidebar-group');
    expect(groups.length).toBe(0);
    expect(screen.queryByText('应用设置', { selector: '.app-page-shell__sidebar-group-title' })).toBeNull();
    expect(screen.queryByText('功能设置', { selector: '.app-page-shell__sidebar-group-title' })).toBeNull();

    // 侧栏仅有 2 个 item
    const items = sidebar!.querySelectorAll('.app-page-shell__sidebar-item');
    expect(items.length).toBe(2);

    // 两个项目分别为外观与存储与数据
    const itemLabels = Array.from(items).map((el) => el.textContent?.trim());
    expect(itemLabels).toEqual(['外观', '存储与数据']);

    // 绝不存在布局与画布显示导航项
    expect(screen.queryByRole('button', { name: '布局' })).toBeNull();
    expect(screen.queryByRole('button', { name: '画布显示' })).toBeNull();
  });

  it('默认激活【外观】并可正常调节；无任何布局空态或画布显示遗留', async () => {
    renderSettings();

    // 默认展示外观详情
    expect(screen.getByRole('heading', { level: 2, name: '外观' })).toBeInTheDocument();
    expect(screen.getByText('主题、界面字体与字号只影响编辑器界面（导航、设置等），不影响谱面画布。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /暗色/ })).toBeInTheDocument();

    // 切换主题功能回归
    fireEvent.click(screen.getByRole('button', { name: /暗色/ }));
    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    expect(persisted.theme).toBe('dark');

    // 绝不存在布局空态
    expect(screen.queryByText('布局在工作台内调整')).toBeNull();
    expect(screen.queryByText(/面板开合、宽度与画布缩放均在工作台操作/)).toBeNull();

    // 绝不存在画布显示遗留
    expect(screen.queryByText('节奏图示大小')).toBeNull();
    expect(screen.queryByText('长压线不透明度')).toBeNull();
    expect(screen.queryByText('同时点击线')).toBeNull();
  });

  it('切换到【存储与数据】正常渲染，偏好设置导出导入均正常生效', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '存储与数据' }));

    expect(screen.getByRole('heading', { level: 2, name: '存储与数据' })).toBeInTheDocument();
    
    // 导出设置触发
    fireEvent.click(screen.getByRole('button', { name: /导出设置/ }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    // 导入设置触发并回写
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    
    const validJson = JSON.stringify({ theme: 'light', uiLanguage: 'en' });
    const file = new File([validJson], 'aao-settings.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      expect(persisted.theme).toBe('light');
      expect(persisted.uiLanguage).toBe('en');
    });
  });

  it('静态代码与字典断言：无冗余 section 分支，废弃字典键彻底清除', () => {
    const src = stripComments(readSource('src/pages/settings/SettingsPage.tsx'));
    expect(src).not.toMatch(/section\s*===\s*'layout'/);
    expect(src).not.toMatch(/section\s*===\s*'canvas'/);
    expect(src).not.toMatch(/SidebarGroup/);
    expect(src).not.toMatch(/settings\.layout/);

    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;

    const redundantKeys = [
      'settings.section.layout',
      'settings.layout.intro',
      'settings.layout.emptyTitle',
      'settings.layout.emptyDescription',
      'settings.group.app',
      'settings.group.feature',
      'settings.canvas.intro',
    ];

    for (const key of redundantKeys) {
      expect(zh[key], `zh-CN should not contain redundant key ${key}`).toBeUndefined();
      expect(en[key], `en should not contain redundant key ${key}`).toBeUndefined();
    }
  });
});
