import { Play, Pause } from "lucide-react";
import { formatKey } from "../utils/ShortcutConfig";
import { KEY_SOUND_SETS } from "../utils/KeySound";
import { usePlayback, useConfig } from "../contexts";

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

interface PlayBarProps {
  // 仅留音频引擎 / 会话级状态相关的回调；播放态/配置经 hooks 直读（ADR-0003 §7）
  onTogglePlay: () => void;
  onDurationChange: (sec: number) => void;
  onVolumeChange: (v: number) => void;
  onKeySetChange: (id: string) => void;
}

export default function PlayBar({
  onTogglePlay,
  onDurationChange,
  onVolumeChange,
  onKeySetChange,
}: PlayBarProps) {
  // M1 收口：经 usePlayback / useConfig 取播放态与键音素材
  const {
    isPlaying, canPlay, currentSeconds, duration,
    volume, markerBeat,
  } = usePlayback();
  const { settings, setKeySetId } = useConfig();
  const shortcutConfig = settings.shortcuts;
  const keySetId = settings.audio.keySet;

  return (
    <div style={{
      height: 'var(--playbar-h)',
      backgroundColor: 'var(--bg-elevated)',
      color: 'var(--text)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: '0 var(--space-3)',
      fontSize: 'var(--text-xs)',
      flexShrink: 0,
      borderTop: '1px solid var(--border)',
    }}>
      {/* 播放/暂停 */}
      <button
        onClick={onTogglePlay}
        title="播放/暂停"
        style={{
          background: 'var(--bg-inset)', color: 'var(--text)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', width: 26, height: 26, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-inset)')}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      {/* 时间码 */}
      <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {formatTime(currentSeconds)} / {formatTime(duration)}
      </span>

      {/* 无音频：时长可改（会话级） */}
      {!canPlay && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
          时长
          <input
            type="number"
            min={1}
            value={Math.round(duration)}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onDurationChange(v); }}
            title="无音频时设置谱面播放时长（仅本次会话）"
            style={{
              width: 56, background: 'var(--bg-inset)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '2px 4px', fontSize: 'var(--text-xs)',
              fontVariantNumeric: 'tabular-nums', outline: 'none',
              transition: 'border-color var(--dur) var(--ease)',
            }}
          />
          <span>s</span>
        </label>
      )}

      {/* 音量 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
        音量
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          style={{ width: 90, accentColor: 'var(--accent)' }}
        />
      </label>

      {/* 键音素材切换：经 ConfigContext 持久化 + 引擎回调（Editor 处理） */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
        素材
        <select
          value={keySetId}
          onChange={e => { setKeySetId(e.target.value); onKeySetChange(e.target.value); }}
          style={{
            background: 'var(--bg-inset)', color: 'var(--text)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '2px 4px', fontSize: 'var(--text-xs)', cursor: 'pointer',
          }}
        >
          {KEY_SOUND_SETS.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>

      {/* 起点标记提示 */}
      <span style={{ color: markerBeat !== null ? 'var(--warning)' : 'var(--text-subtle)', marginLeft: 'auto' }}>
        {markerBeat !== null
          ? `起点标记 @ ${markerBeat.toFixed(2)} 拍 · 回跳 ${formatKey(shortcutConfig.jumpToMarker)}`
          : '双击左沟槽设置起点标记'}
      </span>
    </div>
  );
}
