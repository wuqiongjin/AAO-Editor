interface SongUploaderProps {
    onUpload: (file: File | null) => void;
  }
  
export default function SongUploader({ onUpload }: SongUploaderProps) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h1 className="text-xl font-bold">请选择一首歌曲文件开始编辑</h1>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              onUpload(e.target.files[0]);
            }
          }}
        />
        <button onClick={() => onUpload(null)}>跳过（无歌曲模式）</button>
      </div>
    );
  }
  