import { useState } from 'react'
import './App.css'
import SongUploader from "./components/SongUploader";
import Editor from "./pages/Editor";

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

  return <Editor song={song} onBack={() => setInEditor(false)} />;
}

export default App