import { lazy, Suspense, useMemo, useEffect } from 'react';
import './App.css'
import AppShell from "./pages/AppShell";
import { EditingProvider, UIProvider, ConfigProvider, PlaybackProvider, useConfig } from "./contexts";
import { AudioSessionProvider } from "./contexts/AudioSessionContext";
import { createAudioSession } from "./utils/AudioSession";
import { useApplyTheme } from "./styles/theme";

const PageShellPrototype = lazy(() => import('./prototypes/PageShellPrototype'));

// 主题同步（ADR-0003 §5）：把 settings.theme 落到 <html data-theme>，驱动 tokens.css 亮/暗。
function ThemeSync() {
  const { settings } = useConfig();
  useApplyTheme(settings.theme);
  return null;
}

// 音频会话实例（架构深化评审候选 3 收口）：
// 单例深模块挂在 AppShell 外层，让工作台与音频页都朝它调用；桥接 context 消失。
// 因 useConfig() 需要 ConfigProvider，所以 AudioSessionProvider 必须放在 ConfigProvider 内层。
function AudioSessionRoot({ children }: { children: React.ReactNode }) {
  const { settings, setKeySetId, setSeVolume } = useConfig();
  const session = useMemo(
    () => createAudioSession({
      keySetId: settings.audio.keySet,
      seVolume: settings.audio.seVolume,
      chartDuration: 30,
    }),
    // session 单例：只创建一次；后续 settings 变化走 useEffect 同步（见下）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // 1) settings 从存储加载后或用户切换素材/SE 音量时，同步到 session
  useEffect(() => {
    session.syncSettingsFromConfig(settings.audio.keySet, settings.audio.seVolume);
  }, [session, settings.audio.keySet, settings.audio.seVolume]);
  // 2) 把设置写回回调注入 session（session 内 setKeySetId/setSeVolume 自动调）
  useEffect(() => {
    session.setSettingsPersist({
      persistKeySet: setKeySetId,
      persistSeVolume: setSeVolume,
    });
  }, [session, setKeySetId, setSeVolume]);
  return <AudioSessionProvider session={session}>{children}</AudioSessionProvider>;
}

// 工作台状态四域（ADR-0003 §7 + 播放编排）+ 音频会话深模块（候选 3）：
// 均挂在 AppShell 外层，页面壳与各页子组件按需经 hooks 取各自域。
function Root() {
  return (
    <EditingProvider>
      <UIProvider>
        <ConfigProvider>
          <PlaybackProvider>
            <AudioSessionRoot>
              <ThemeSync />
              <AppShell />
            </AudioSessionRoot>
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
