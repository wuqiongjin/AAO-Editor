// @vitest-environment jsdom
// issue 171 · 五大内容页 Header 渲染新文案检查与双语覆盖
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { SETTINGS_KEY } from '@/tests/support/storage';
import { renderWithProviders } from '@/tests/support/providers';
import { setActiveUiLanguage } from '@/src/i18n';
import AudioPage from '@/src/pages/audio/AudioPage';
import AssetsPage from '@/src/pages/assets/AssetsPage';
import SettingsPage from '@/src/pages/settings/SettingsPage';
import ShortcutsPage from '@/src/pages/settings/ShortcutsPage';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';

const navValue: AppNavValue = {
  activePage: 'projects',
  setActivePage: () => {},
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function seedSettings(lang: 'zh-CN' | 'en') {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ schemaVersion: 1, uiLanguage: lang }),
  );
  setActiveUiLanguage(lang);
}

beforeEach(() => {
  stubPageShellEnv();
  Element.prototype.scrollTo = vi.fn();
});

function renderPage(ui: React.ReactElement) {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}>
        {ui}
      </AppNavProvider>
    </ConfigProvider>,
  );
}

describe('issue 171 · 五大内容页 Header 与指引新文案渲染', () => {
  describe('zh-CN（中文）', () => {
    beforeEach(() => {
      seedSettings('zh-CN');
    });

    it('1. 工程页引导横幅：渲染新定稿曲目与多难度表述', async () => {
      renderPage(<ProjectsPage />);

      // 空工程启动台展示 GuideBanner
      expect(
        await screen.findByText(
          '每个工程对应一首曲目及其多难度谱面。创建工程即可完善曲目信息并开始制谱。',
        ),
      ).toBeInTheDocument();
      // 不出现旧口语流水账
      expect(screen.queryByText(/一个工程是一首歌，下面挂若干张谱面/)).toBeNull();
    });

    it('2. 音频页 Header：正常渲染核心管理对象', () => {
      renderPage(<AudioPage />);

      expect(
        screen.getByText('管理工程音频、键音素材包与节奏图示 SE 音量。'),
      ).toBeInTheDocument();
    });

    it('3. 素材页 Header 与侧栏：Header 聚焦音符与画布背景，侧栏精准命名为「画布背景」', () => {
      renderPage(<AssetsPage />);

      // Header description
      expect(
        screen.getByText('管理音符皮肤外观与谱面画布背景图像。'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/键音包在音频页/)).toBeNull();
      expect(screen.queryByText(/自动保存/)).toBeNull();

      // 侧栏 item 精准化为「画布背景」，而非「背景皮肤」
      expect(screen.getByRole('button', { name: '画布背景' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '背景皮肤' })).toBeNull();
    });

    it('4. 快捷键页 Header：纯粹陈述查看与自定义能力，去除操作指引与防卫性提示', () => {
      renderPage(<ShortcutsPage />);

      expect(
        screen.getByText('查看并自定义编辑器全局与工作台操作快捷键。'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/冲突保存前提示/)).toBeNull();
      expect(screen.queryByText(/点击键位录入/)).toBeNull();
    });

    it('5. 设置页 Header：陈述偏好、语言与数据存储，无防卫性行话', () => {
      renderPage(<SettingsPage />);

      expect(
        screen.getByText('管理应用外观偏好、界面语言与本地数据存储。'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/修改立即生效并自动保存/)).toBeNull();
      expect(screen.queryByText(/高风险操作会单独确认/)).toBeNull();
    });
  });

  describe('en（英文）', () => {
    beforeEach(() => {
      seedSettings('en');
    });

    it('1. Projects guide: renders clean, standard English copy', async () => {
      renderPage(<ProjectsPage />);

      expect(
        await screen.findByText(
          'Each project corresponds to a song and its chart difficulties. Create a project to complete song info and start charting.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/leaves you on its detail page/i)).toBeNull();
    });

    it('2. Audio page Header: renders standard management description', () => {
      renderPage(<AudioPage />);

      expect(
        screen.getByText('Project audio, key-sound packs, and note SE volume.'),
      ).toBeInTheDocument();
    });

    it('3. Assets page Header and sidebar: renders Canvas Background and standard description', () => {
      renderPage(<AssetsPage />);

      expect(
        screen.getByText(
          'Manage note skin appearances and chart canvas background images.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Key-sound packs live on the Audio page/i)).toBeNull();

      expect(screen.getByRole('button', { name: 'Canvas Background' })).toBeInTheDocument();
    });

    it('4. Shortcuts page Header: renders concise capability description', () => {
      renderPage(<ShortcutsPage />);

      expect(
        screen.getByText(
          'View and customize global and workspace editor shortcuts.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Conflicts are blocked/i)).toBeNull();
    });

    it('5. Settings page Header: renders clean preferences & storage description', () => {
      renderPage(<SettingsPage />);

      expect(
        screen.getByText(
          'Manage app appearance preferences, UI language, and local data storage.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Changes apply immediately/i)).toBeNull();
    });
  });
});
