import { useRef } from 'react';
import { Music4, ArrowRight } from 'lucide-react';

// 音频面板（ADR-0003 §2 修订 + issue 27）：工作台内"页面"之一，承载 导入/换/清除 音频与无音频时长编辑。
// 无音频＝常态；有音频时谱面时长锁定为音频时长，清除后回到无音频态、时长可编辑。
interface AudioPanelProps {
  audioName: string | null;   // 当前音频文件名（无音频为 null）
  canPlay: boolean;           // 是否已加载音频
  duration: number;           // 谱面时长（秒）
  onDurationChange: (sec: number) => void;
  onImportAudio: (file: File) => void;
  onClearAudio: () => void;
  onBackToWorkspace: () => void;
}

export default function AudioPanel({
  audioName, canPlay, duration,
  onDurationChange, onImportAudio, onClearAudio, onBackToWorkspace,
}: AudioPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = () => fileRef.current?.click();

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      backgroundColor: 'var(--bg)', paddingTop: 'var(--space-8)', padding: 'var(--space-8) var(--space-4)',
      overflow: 'auto',
    }}>
      <div style={{
        backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)',
        padding: 'var(--space-8) var(--space-6)', maxWidth: 480, width: '100%',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text)' }}>
            音频
          </h1>
          <button
            onClick={onBackToWorkspace}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--bg-inset)',
              color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              cursor: 'pointer', fontSize: 'var(--text-sm)', fontFamily: 'inherit',
              transition: 'background-color var(--dur) var(--ease)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-inset)')}
          >返回工作台 <ArrowRight size={14} /></button>
        </div>

        {/* 当前音频信息 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-4)', backgroundColor: 'var(--bg-inset)',
          borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
          color: 'var(--text)',
        }}>
          <Music4 size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {canPlay && audioName ? audioName : '无音频'}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
              {canPlay ? '已加载 · 谱面时长锁定为音频时长' : '无歌曲模式 · 时长可自由设置'}
            </div>
          </div>
        </div>

        {/* 操作区 */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button
            onClick={pickFile}
            style={{
              flex: 1, minWidth: 120,
              padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--accent)',
              color: 'var(--text-on-accent)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              fontSize: 'var(--text-base)', fontWeight: 600, fontFamily: 'inherit',
              border: '1px solid transparent',
              transition: 'background-color var(--dur) var(--ease)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
          >
            {canPlay ? '更换音频' : '导入音频'}
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) onImportAudio(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </button>
          {canPlay && (
            <button
              onClick={onClearAudio}
              style={{
                padding: 'var(--space-3) var(--space-4)', backgroundColor: 'var(--bg-inset)',
                color: 'var(--danger-text)', border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 'var(--text-sm)',
                fontFamily: 'inherit', transition: 'background-color var(--dur) var(--ease)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--danger-soft)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-inset)')}
            >清除音频</button>
          )}
        </div>

        {/* 无音频：时长可编辑；有音频：只读锁定 */}
        {!canPlay && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            <span>谱面时长</span>
            <input
              type="number"
              min={1}
              value={Math.round(duration)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0) onDurationChange(v);
              }}
              title="无音频时设置谱面长度（秒，持久化）"
              style={{
                width: 80, background: 'var(--bg-inset)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                padding: '4px 6px', fontSize: 'var(--text-sm)', fontVariantNumeric: 'tabular-nums',
                outline: 'none',
              }}
            />
            <span>秒</span>
          </label>
        )}
      </div>
    </div>
  );
}