import { useState } from 'react'
import './App.css'
import SongUploader from "./components/SongUploader";
import Editor from "./pages/Editor";
import { EditingProvider, UIProvider, ConfigProvider } from "./contexts";

// 工作台状态三域（ADR-0003 §7）：编辑数据 / UI 布局 / 配置，均挂在 Editor 外层
function Workbench(props: { song: File | null; onBack: () => void }) {
  return (
    <EditingProvider>
      <UIProvider>
        <ConfigProvider>
          <Editor {...props} />
        </ConfigProvider>
      </UIProvider>
    </EditingProvider>
  );
}

function App() {
  const [song, setSong] = useState<File | null>(null);
  const [inEditor, setInEditor] = useState(false);

  // 进入编辑器：选歌（File）或跳过（null，无歌曲模式）
  const enterEditor = (file: File | null) => {
    setSong(file);
    setInEditor(true);
  };

  if (!inEditor) {
    return (
      <div>
        <SongUploader onUpload={enterEditor} />
      </div>
    );
  }

  return <Workbench song={song} onBack={() => setInEditor(false)} />;
}

export default App