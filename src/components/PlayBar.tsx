import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Volume2, VolumeX, Play, Pause } from "lucide-react";
import { formatKey } from "../utils/ShortcutConfig";
import { formatTimePrecise, formatTimeWhole, parseTimeInput } from "../utils/TimeFormat";
import { usePlayback, useConfig } from "../contexts";

interface PlayBarProps {
  onTogglePlay: () => void;
  onVolumeChange: (v: number) => void;
  /** 进度条 seek（点击/拖动/时间码双击编辑）：目标秒→引擎定位，暂停不自动播（ADR-0004 + issue 22） */
  onSeek: (sec: number) => void;
}

export default function PlayBar({
  onTogglePlay,
  onVolumeChange,
  onSeek,
}: PlayBarProps) {
  const {
    isPlaying, canPlay, currentSeconds, duration,
    volume,
  } = usePlayback();
  const { settings } = useConfig();
  const shortcutConfig = settings.shortcuts;

  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // 时间码双击原地编辑（无音频时）：改写当前播放位置秒数 → seek（issue 22 §4）
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");
  const timeInputRef = useRef<HTMLInputElement>(null);
  const beginEditTime = () => {
    if (canPlay) return; // 有音频：时长由音频决定，禁止编辑定位
    setTimeDraft(formatTimePrecise(currentSeconds));
    setEditingTime(true);
  };
  const commitTime = () => {
    setEditingTime(false);
    const sec = parseTimeInput(timeDraft);
    if (sec !== null) onSeek(Math.max(0, Math.min(sec, duration)));
  };
  const onTimeKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitTime();
    else if (e.key === 'Escape') setEditingTime(false);
  };

  const ratio = duration > 0 ? Math.max(0, Math.min(1, currentSeconds / duration)) : 0;
  const muted = volume <= 0;

  // 从指针位置解析目标秒（点击/拖动共用）
  const seekFromPointer = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(t * duration);
  }, [duration, onSeek]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 允许无音频 seek：合成时间线（ADR-0004 §2）同样由引擎承载，进度定位与滚动条一致
    e.preventDefault();
    // 捕获指针以支持拖出元素后继续跟手；合成/测试事件指针无效时忽略（不阻断基本点击 seek）
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch { /* 指针无效：忽略捕获，不影响 seek */ }
    setDragging(true);
    seekFromPointer(e.clientX);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    seekFromPointer(e.clientX);
  };
  const endDrag = () => setDragging(false);

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
        title={`播放/暂停（${formatKey(shortcutConfig.play)}）`}
        style={{
          background: 'var(--bg-inset)', color: 'var(--text)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', width: 28, height: 28, cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-inset)')}
        onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
        onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} />}
      </button>

      {/* 时间码组（紧邻）：当前时间 + 总时长；无音频时双击当前时间原地编辑 */}
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, whiteSpace: 'nowrap' }}>
        {editingTime ? (
          <input
            ref={timeInputRef}
            autoFocus
            value={timeDraft}
            onChange={e => setTimeDraft(e.target.value)}
            onBlur={commitTime}
            onKeyDown={onTimeKeyDown}
            inputMode="decimal"
            title="输入 mm:ss 或 mm:ss.s 后回车（最大谱面长度，秒）"
            style={{
              width: 64, background: 'var(--bg-inset)', color: 'var(--text)',
              border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
              padding: '2px 4px', fontSize: 'var(--text-xs)',
              fontVariantNumeric: 'tabular-nums', outline: 'none',
            }}
          />
        ) : (
          <span
            onDoubleClick={beginEditTime}
            title={canPlay ? undefined : '双击编辑时间定位'}
            style={{
              color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
              cursor: canPlay ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >{formatTimePrecise(currentSeconds)}</span>
        )}
        <span style={{ color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
          / {formatTimeWhole(duration)}
        </span>
      </span>

      {/* 可拖拽进度条（居中占满剩余空间）：点击/拖动 seek，暂停不自动播 */}
      <div
        ref={trackRef}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentSeconds)}
        title="点击/拖动定位播放位置"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          flex: 1, height: 18, display: 'flex', alignItems: 'center',
          cursor: canPlay || !isPlaying ? 'pointer' : 'default',
          touchAction: 'none',
          minWidth: 80,
        }}
      >
        <div style={{
          position: 'relative', width: '100%', height: 4, borderRadius: 'var(--radius-full)',
          backgroundColor: 'var(--border)', overflow: 'visible',
        }}>
          {/* 已播放填充 */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${ratio * 100}%`, borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--accent)',
            transition: dragging ? 'none' : 'width var(--dur) var(--ease)',
          }} />
          {/* 滑块圆点 */}
          <div style={{
            position: 'absolute', top: '50%', left: `${ratio * 100}%`,
            width: 10, height: 10, borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--accent)', border: '2px solid var(--bg-elevated)',
            transform: 'translate(-50%, -50%)',
            boxShadow: 'var(--shadow-sm)',
            pointerEvents: 'none',
          }} />
        </div>
      </div>

      {/* 音量 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', flexShrink: 0 }} title="音量">
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          style={{ width: 80, accentColor: 'var(--accent)', cursor: 'pointer' }}
        />
      </label>
    </div>
  );
}
