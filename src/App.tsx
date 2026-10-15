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
  const prototype = new URLSearchParams(window.location.search).get('prototype');
  if (prototype === 'page-shell') {
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>{t('prototype.loading')}</div>}>
        <PageShellPrototype />
      </Suspense>
    );
  }
  // 票 30/39 的视频开场画面原型（?prototype=opening-screen）已随方案 B 定案落进
  // `src/preview/video/opening/` 后删除（口径同 issue 16 的弹窗壳原型）
  // 票 39 的登录 / 账号区原型（?prototype=account-bar）同样已随定案落进
  // `src/pages/projects/components/{AccountBar,SignInDialog}.tsx` 后删除（票 15 先例：原型不进提交）
  return <Root />;
}

export default App
