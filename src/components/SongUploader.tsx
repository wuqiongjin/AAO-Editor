interface SongUploaderProps {
  onUpload: (file: File | null) => void;
}

export default function SongUploader({ onUpload }: SongUploaderProps) {
  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'var(--bg)',
    }}>
      <div style={{
        backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)',
        padding: 'var(--space-8) var(--space-6)', maxWidth: 440, width: '100%',
        textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
      }}>
        <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text)' }}>
          请选择一首歌曲文件开始编辑
        </h1>
        <label
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--accent)',
            color: 'var(--text-on-accent)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            fontSize: 'var(--text-base)', fontWeight: 600, fontFamily: 'inherit',
            border: '1px solid transparent', transition: 'background-color var(--dur) var(--ease)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
        >
          选择音频文件
          <input
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onUpload(e.target.files[0]);
              }
            }}
          />
        </label>
        <button
          onClick={() => onUpload(null)}
          style={{
            padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--bg-inset)',
            color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            cursor: 'pointer', fontSize: 'var(--text-sm)', fontFamily: 'inherit',
            transition: 'background-color var(--dur) var(--ease)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-inset)')}
        >跳过（无歌曲模式）</button>
      </div>
    </div>
  );
}
