import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Volume2, VolumeX, Play, Pause, Lock } from "lucide-react";
import { formatTimePrecise, formatTimeWhole, parseTimeInput } from '../chart/geometry/TimeFormat';
import { t } from '../i18n';
import './PlayBar.css';

// 播放条（issue 49 阶段 3 迁出 inline；issue 22 起 props 化，工作台 / 预览共用这一件）：
// - 播放/暂停、时间码（`canEditTime` 时可双击原地编辑）、可拖拽进度条 seek、音量；
// - 数据入口全部走 props（不再直读 Playback / AudioSession / Config），两处消费方各自接线；
// - 外壳分两个变体（issue 22 Q1）：`play-bar--workspace` 工作台页底栏 / `play-bar--preview`
//   预览舞台底部一行 —— 只共用内部排布，不共用外壳几何；
// - 倍速是可选 slot（`rateSlot`，预览专属的票 20 控件）：不传就不渲染。

export type PlayBarVariant = 'workspace' | 'preview';

export interface PlayBarProps {
  /** 播放中（决定播放 / 暂停图标） */
  isPlaying: boolean;
  /** 当前播放头秒数 */
  currentSeconds: number;
  /** 总时长（秒） */
  duration: number;
  /** 主音量 0..1 */
  volume: number;
  /** 时长由外部音频锁定（总时长旁出锁图标 + 提示）；工作台 = 音频被锁定 */
  audioLocked?: boolean;
  /** 时间码可双击编辑（工作台与预览均支持双击编辑跳转） */
  canEditTime?: boolean;
  /** 播放中不给进度条手形光标（工作台历史口径：无音频播放中） */
  seekNoCursor?: boolean;
  /** 播放钮提示里的快捷键（`formatKey` 后的展示串，如 "Space"） */
  shortcutKey: string;
  /** 外壳变体：工作台页底栏（默认）/ 预览舞台底部一行（issue 22） */
  variant?: PlayBarVariant;
  /** 倍速控件 slot（预览专属）：不传就不渲染 */
  rateSlot?: ReactNode;
  onTogglePlay: () => void;
  onVolumeChange: (v: number) => void;
  /** 进度条 seek（点击/拖动/时间码双击编辑）：目标秒→引擎定位，暂停不自动播（ADR-0004 + issue 22） */
  onSeek: (sec: number) => void;
}

export default function PlayBar({
  isPlaying,
  currentSeconds,
  duration,
  volume,
  audioLocked = false,
  canEditTime = false,
  seekNoCursor = false,
  shortcutKey,
  variant = 'workspace',
  rateSlot,
  onTogglePlay,
  onVolumeChange,
  onSeek,
}: PlayBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // 时间码双击原地编辑：改写当前播放位置秒数 → seek（issue 22 §4 / issue 39）
  const [editingTime, setEditingTime] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");
  const timeInputRef = useRef<HTMLInputElement>(null);
  const initialDraftRef = useRef<string>("");
  const isDirtyRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);

  const beginEditTime = () => {
    if (!canEditTime) return;
    const initial = formatTimePrecise(currentSeconds);
    initialDraftRef.current = initial;
    isDirtyRef.current = false;
    cancelledRef.current = false;
    setTimeDraft(initial);
    setEditingTime(true);
  };
  const commitTime = () => {
    setEditingTime(false);
    if (cancelledRef.current || !isDirtyRef.current) return;
    const trimmed = timeDraft.trim();
    if (trimmed === "" || trimmed === initialDraftRef.current) {
      // 未修改或清空：不改变当前播放进度（播放中不回退到双击时的秒数）
      return;
    }
    const sec = parseTimeInput(trimmed);
    if (sec !== null) {
      onSeek(Math.max(0, Math.min(sec, duration)));
    }
  };
  const onTimeKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitTime();
    } else if (e.key === 'Escape') {
      cancelledRef.current = true;
      setEditingTime(false);
    }
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
    <div className={`play-bar play-bar--${variant}`}>
      {/* 播放/暂停 */}
      <button
        onClick={onTogglePlay}
        title={t('play.toggle', { key: shortcutKey })}
        className="play-bar__play-btn"
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} />}
      </button>

      {/* 时间码组（紧邻）：当前时间 + 总时长；可编辑时双击当前时间原地编辑 */}
      <span className="play-bar__time">
        {editingTime ? (
          <input
            ref={timeInputRef}
            autoFocus
            value={timeDraft}
            onFocus={(e) => e.currentTarget.select()}
            onChange={e => {
              isDirtyRef.current = true;
              setTimeDraft(e.target.value);
            }}
            onBlur={commitTime}
            onKeyDown={onTimeKeyDown}
            inputMode="decimal"
            title={t('play.timeInput')}
            className="play-bar__time-input"
          />
        ) : (
          <span
            onDoubleClick={beginEditTime}
            title={canEditTime ? t('play.editTime') : undefined}
            className={`play-bar__time-current${canEditTime ? ' is-editable' : ''}`}
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
        className={`play-bar__seek${seekNoCursor ? ' is-no-cursor' : ''}`}
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

      {/* 倍速 slot（预览专属）：不传就不占位（工作台没有这一件） */}
      {rateSlot}

      {/* 音量 */}
      <label className="play-bar__volume" title={t('play.volume')}>
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          // 可访问名：预览侧复用前本就有（`aria-label`），工作台这一件此前只靠 label 的 title
          aria-label={t('play.volume')}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          className="play-bar__volume-input"
        />
      </label>
    </div>
  );
}
