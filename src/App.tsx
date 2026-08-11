import { lazy, Suspense } from 'react';
import './App.css'
import AppShell from "./pages/AppShell";
import { EditingProvider, UIProvider, ConfigProvider, PlaybackProvider, useConfig } from "./contexts";
import { AudioPageProvider } from "./contexts/AudioPageContext";
import { useApplyTheme } from "./styles/theme";

const PageShellPrototype = lazy(() => import('./prototypes/PageShellPrototype'));

// 主题同步（ADR-0003 §5）：把 settings.theme 落到 <html data-theme>，驱动 tokens.css 亮/暗。
function ThemeSync() {
  const { settings } = useConfig();
  useApplyTheme(settings.theme);
  return null;
}

// 工作台状态四域（ADR-0003 §7 + 播放编排）+ 音频页桥接（issue 28 Q16）：
// 均挂在 AppShell 外层，页面壳与各页子组件按需经 hooks 取各自域。
// issue 28：由 AppShell 承载四页注册（工作台/音频/设置/快捷键），并保活挂载工作台。
function Root() {
  return (
    <EditingProvider>
      <UIProvider>
        <ConfigProvider>
          <PlaybackProvider>
            <AudioPageProvider>
              <ThemeSync />
              <AppShell />
            </AudioPageProvider>
          </PlaybackProvider>
        </ConfigProvider>
      </UIProvider>
    </EditingProvider>
  );
}

function App() {
  const isPageShellPrototype = new URLSearchParams(window.location.search).get('prototype') === 'page-shell';
  if (isPageShellPrototype) {
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>正在载入布局原型…</div>}>
        <PageShellPrototype />
      </Suspense>
    );
  }
  return <Root />;
}

export default App
