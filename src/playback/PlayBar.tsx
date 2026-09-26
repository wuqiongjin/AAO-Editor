import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Volume2, VolumeX, Play, Pause, Lock } from "lucide-react";
import { formatKey } from '../chart/config/ShortcutConfig';
import { formatTimePrecise, formatTimeWhole, parseTimeInput } from '../chart/geometry/TimeFormat';
import { usePlayback, useConfig, useAudioSession } from '../app/ProviderTree';
import { t } from '../i18n';
import './PlayBar.css';

// 工作台底部播放条（issue 22 + issue 49 阶段 3 迁出 inline）。
// - 播放/暂停、时间码（无音频时可双击原地编辑）、可拖拽进度条 seek、音量。

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
  const [audioSnap] = useAudioSession();
  const audioLocked = audioSnap.audioLocked;
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
    <div className="play-bar">
      {/* 播放/暂停 */}
      <button
        onClick={onTogglePlay}
        title={t('play.toggle', { key: formatKey(shortcutConfig.play) })}
        className="play-bar__play-btn"
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} />}
      </button>

      {/* 时间码组（紧邻）：当前时间 + 总时长；无音频时双击当前时间原地编辑 */}
      <span className="play-bar__time">
        {editingTime ? (
          <input
            ref={timeInputRef}
            autoFocus
            value={timeDraft}
            onChange={e => setTimeDraft(e.target.value)}
            onBlur={commitTime}
            onKeyDown={onTimeKeyDown}
            inputMode="decimal"
            title={t('play.timeInput')}
            className="play-bar__time-input"
          />
        ) : (
          <span
            onDoubleClick={beginEditTime}
            title={canPlay ? undefined : t('play.editTime')}
            className={`play-bar__time-current${canPlay ? '' : ' is-editable'}`}
          >{formatTimePrecise(currentSeconds)}</span>
        )}
        <span
          className="play-bar__time-total"
          title={audioLocked ? t('audio.lockedPrompt') : undefined}
        >
          / {formatTimeWhole(duration)}
          {audioLocked && (
            <Lock
              size={11}
              style={{ marginLeft: 4, verticalAlign: -1, opacity: 0.7 }}
              aria-label={t('audio.lockedPrompt')}
            />
          )}
        </span>
      </span>

      {/* 可拖拽进度条（居中占满剩余空间）：点击/拖动 seek，暂停不自动播 */}
      <div
        ref={trackRef}
        role="slider"
        aria-label={t('play.progress')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentSeconds)}
        title={t('play.seek')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`play-bar__seek${(!canPlay && isPlaying) ? ' is-no-cursor' : ''}`}
      >
        <div className="play-bar__seek-track">
          {/* 已播放填充：去掉 width transition，与圆点位置严格逐帧同步
              （修 issue "音频进度条蓝线滞后圆点"——rAF 60fps 重渲下，160ms transition
              与高频 width 更新在某些 GPU 合成路径上互动异常，蓝线会卡在旧值几秒；
              圆点本身无 transition 立即跳，造成位置不一致。直接走逐帧瞬移，视觉上
              rAF 16.7ms 间隔本身已足够平滑） */}
          <div
            className="play-bar__seek-fill"
            style={{ width: `${ratio * 100}%` }}
          />
          <div
            className="play-bar__seek-dot"
            style={{ left: `${ratio * 100}%` }}
          />
        </div>
      </div>

      {/* 音量 */}
      <label className="play-bar__volume" title={t('play.volume')}>
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          className="play-bar__volume-input"
        />
      </label>
    </div>
  );
}
