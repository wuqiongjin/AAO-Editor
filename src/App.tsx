import { useState } from 'react'
import './App.css'
import SongUploader from "./components/SongUploader";
import Editor from "./pages/Editor";

function App() {
  const [song, setSong] = useState<File | null>(null);

  if (!song) {
    return (
      <div>
        <SongUploader onUpload={setSong} />
      </div>
    );
  }

  return <Editor song={song} />;
}

export default App