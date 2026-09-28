import { lazy, Suspense } from 'react';
import './app/styles/App.css'
import AppShell from "./layouts/AppShell";
import { ProviderTree, useConfig } from "./app/ProviderTree";
import { useApplyTheme } from './app/styles/theme';
import { useApplyChromeTypography } from './app/styles/chromeTypography';
import { useApplyUiLanguage } from './i18n/useApplyUiLanguage';
import { t } from './i18n';

const PageShellPrototype = lazy(() => import('./prototypes/PageShellPrototype'));

// 主题同步（ADR-0003 §5）：把 settings.theme 落到 <html data-theme>，驱动 tokens.css 亮/暗。
function ThemeSync() {
  const { settings } = useConfig();
  useApplyTheme(settings.theme);
  useApplyChromeTypography(settings);
  useApplyUiLanguage(settings.uiLanguage);
  return null;
}

function Root() {
  return (
    <ProviderTree>
      <ThemeSync />
      <AppShell />
    </ProviderTree>
  );
}

function App() {
  // issue 16 的弹窗壳原型（?prototype=dialog-shell）已随定案（C · 色带）落进 ui/Dialog 后删除
  const isPageShellPrototype = new URLSearchParams(window.location.search).get('prototype') === 'page-shell';
  if (isPageShellPrototype) {
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>{t('prototype.loading')}</div>}>
        <PageShellPrototype />
      </Suspense>
    );
  }
  return <Root />;
}

export default App
