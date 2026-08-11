import './App.css'
import Editor from "./pages/Editor";
import { EditingProvider, UIProvider, ConfigProvider, PlaybackProvider, useConfig } from "./contexts";
import { useApplyTheme } from "./styles/theme";

// 主题同步（ADR-0003 §5）：把 settings.theme 落到 <html data-theme>，驱动 tokens.css 亮/暗。
function ThemeSync() {
  const { settings } = useConfig();
  useApplyTheme(settings.theme);
  return null;
}

// 工作台状态四域（ADR-0003 §7 + 播放编排）：编辑数据 / UI 布局 / 配置 / 播放状态，
// 均挂在 Editor 外层，子组件按需经 hooks 取各自域，避免 Editor 反复作为 prop relay。
// 入口直达（ADR-0003 §2）：无独立上传页，直接进入工作台。
function Workbench() {
  return (
    <EditingProvider>
      <UIProvider>
        <ConfigProvider>
          <PlaybackProvider>
            <ThemeSync />
            <Editor />
          </PlaybackProvider>
        </ConfigProvider>
      </UIProvider>
    </EditingProvider>
  );
}

function App() {
  return <Workbench />;
}

export default App