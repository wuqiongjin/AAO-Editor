import { Play, Pause } from "lucide-react";
import { formatKey } from "../utils/ShortcutConfig";
import { KEY_SOUND_SETS } from "../utils/KeySound";

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

interface PlayBarProps {
  isPlaying: boolean;
  hasAudio: boolean;
  currentSeconds: number;
  duration: number;
  onTogglePlay: () => void;
  onDurationChange: (sec: number) => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  keySetId: string;
  onKeySetChange: (id: string) => void;
  hasMarker: boolean;
  markerBeat: number | null;
  jumpBinding: string | null;
}

function PlayBar({
  isPlaying,
  hasAudio,
  currentSeconds,
  duration,
  onTogglePlay,
  onDurationChange,
  volume,
  onVolumeChange,
  keySetId,
  onKeySetChange,
  hasMarker,
  markerBeat,
  jumpBinding,
}: PlayBarProps) {
  return (
    <div style={{
      height: '32px',
      backgroundColor: '#1f2937',
      color: '#e5e7eb',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '0 12px',
      fontSize: '12px',
      flexShrink: 0,
      borderTop: '1px solid #374151',
    }}>
      {/* 播放/暂停 */}
      <button
        onClick={onTogglePlay}
        title="播放/暂停"
        style={{
          background: '#374151', color: '#e5e7eb', border: 'none',
          borderRadius: 4, width: 26, height: 26, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      {/* 时间码 */}
      <span style={{ color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
        {formatTime(currentSeconds)} / {formatTime(duration)}
      </span>

      {/* 无音频：时长可改（会话级） */}
      {!hasAudio && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#9ca3af' }}>
          时长
          <input
            type="number"
            min={1}
            value={Math.round(duration)}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onDurationChange(v); }}
            title="无音频时设置谱面播放时长（仅本次会话）"
            style={{
              width: 56, background: '#111827', color: '#e5e7eb', border: '1px solid #4b5563',
              borderRadius: 4, padding: '2px 4px', fontSize: 12,
            }}
          />
          <span>s</span>
        </label>
      )}

      {/* 音量 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#9ca3af' }}>
        音量
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          style={{ width: 90 }}
        />
      </label>

      {/* 键音素材切换 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#9ca3af' }}>
        素材
        <select
          value={keySetId}
          onChange={e => onKeySetChange(e.target.value)}
          style={{ background: '#111827', color: '#e5e7eb', border: '1px solid #4b5563', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
        >
          {KEY_SOUND_SETS.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>

      {/* 起点标记提示 */}
      <span style={{ color: hasMarker ? '#ffd166' : '#6b7280', marginLeft: 'auto' }}>
        {hasMarker
          ? `起点标记 @ ${markerBeat?.toFixed(2)} 拍 · 回跳 ${jumpBinding ? formatKey(jumpBinding) : '—'}`
          : '双击左沟槽设置起点标记'}
      </span>
    </div>
  );
}

export default PlayBar;