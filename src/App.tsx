import './app/styles/App.css'
import AppShell from "./layouts/AppShell";
import { ProviderTree, useConfig } from "./app/ProviderTree";
import { CrashBoundaryHost } from "./diagnostics/CrashBoundary";
import ToastHost from "./ui/Toast";
import { useApplyTheme } from './app/styles/theme';
import { useApplyChromeTypography } from './app/styles/chromeTypography';
import { useApplyUiLanguage } from './i18n/useApplyUiLanguage';

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
      {/* 在 App 崩溃壳外面：顶层错误态导出诊断包仍能 toast */}
      <ToastHost />
      <CrashBoundaryHost scope="app" pageId="app">
        <AppShell />
      </CrashBoundaryHost>
    </ProviderTree>
  );
}

// 历史口径：界面原型一律「随定案落进正式代码后删除，原型不进提交」
// （dialog-shell / picker-status / opening-screen / account-bar / publish-confirm 均已如是处理；
//   page-shell 于 2026-10 发布前清理时移除）。
function App() {
  return <Root />;
}

export default App
