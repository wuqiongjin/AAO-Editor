// 紧凑试听条（票 13 #11e）：弹窗密度，不套工作台 PlayBar。
// 票 22：props 化（照 PlayBar「数据入口全走 props」惯例）—— 音量由调用方接线
// （OfficialSongPanel 接 settings.audio.volume）；音频加载/失败三态全在按钮位呈现，条不变形。
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { t } from '../i18n';
import './ui.css';

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CompactAudio({
  src,
  volume = 1,
  onVolumeChange,
  onError,
  onRetry,
}: {
  src: string | null;
  /** 主音量 0..1（受控：调用方决定存哪，票 22） */
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  /** 载入失败（票 16：本机 404 → 调用方降级成直链） */
  onError?: () => void;
  /** 直链也失败（onError 终态）后的重试：重挂 `<audio>`，调用方把降级链打回本机优先 */
  onRetry?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  /** 音频三态（票 22）：元数据未到 / 播放中缓冲（waiting）/ 失败。反馈全在按钮位 */
  const [metaReady, setMetaReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 重试 nonce：失败后重挂 `<audio>` 重走加载（红线：只许 onError 终态后触发） */
  const [srcNonce, setSrcNonce] = useState(0);

  // 音量即改即生效（换 src 重挂后也要补上）
  useEffect(() => {
    const node = audioRef.current;
    if (node) node.volume = volume;
  }, [volume, src, srcNonce]);

  // src / 重试重挂：三态回零
  useEffect(() => {
    setMetaReady(false);
    setWaiting(false);
    setFailed(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src, srcNonce]);

  const toggle = () => {
    const node = audioRef.current;
    if (!node || src == null) return;
    if (playing) {
      node.pause();
      setPlaying(false);
      return;
    }
    void node.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  // 重试 = 重挂 `<audio>` 重走「本机 → 直链」。只在失败（请求终态）后可点 ——
  // 飞行中重挂同 URL 资源会永久挂死（ADR-0018 §3 / 票 24 红线）
  const retry = () => {
    setFailed(false);
    setSrcNonce((n) => n + 1);
    onRetry?.();
  };

  const muted = volume <= 0;
  // 票 22 验收回修：src 为 null（折叠掐 src 停声，票 21 定案）不是「在加载」——
  // 门禁防折叠瞬间闪出 spinner；重展开重挂 <audio> 重拉元数据仍走 spinner（真实加载）
  const spinning = src != null && !failed && (!metaReady || waiting);

  return (
    <div className="off-compact-audio">
      {src != null && (
        <audio
          key={srcNonce}
          ref={audioRef}
          src={src}
          preload="metadata"
          onError={() => {
            // 先抛给调用方走降级链（本机 → 直链）；src 随之变化时三态回零。
            // 直链也败（src 不再变）→ failed 态留驻，按钮切重试
            setFailed(true);
            onError?.();
          }}
          onLoadedMetadata={() => setMetaReady(true)}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
          onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <button
        type="button"
        className="off-compact-audio__play"
        disabled={src == null || spinning}
        aria-label={
          failed
            ? t('projects.official.audioRetry')
            : playing
              ? t('projects.official.pausePreview')
              : t('projects.official.playPreview')
        }
        title={failed ? t('projects.official.audioRetry') : undefined}
        onClick={failed ? retry : toggle}
      >
        {failed ? (
          <RotateCcw size={14} />
        ) : spinning ? (
          <i className="off-compact-audio__spin" aria-hidden />
        ) : playing ? (
          <Pause size={14} />
        ) : (
          // lucide 的 Play 三角在 viewBox 内偏右 1px（6..20，中心 13≠12）→ -1px 光学校正
          <Play size={14} className="off-compact-audio__nudge" />
        )}
      </button>
      <span className="off-compact-audio__time">{formatClock(current)}</span>
      <input
        className="off-compact-audio__seek"
        type="range"
        min={0}
        max={duration > 0 ? duration : 0}
        step={0.1}
        value={current}
        disabled={src == null || duration <= 0}
        aria-label={t('projects.official.seekPreview')}
        onChange={(e) => {
          const next = Number(e.target.value);
          const node = audioRef.current;
          if (node) node.currentTime = next;
          setCurrent(next);
        }}
      />
      <span className="off-compact-audio__time">{formatClock(duration)}</span>
      {/* 音量（票 22 · B 内嵌小滑条）：口径同 PlayBar（icon + range），56px 窄条；0 时图标切 VolumeX */}
      <label className="off-compact-audio__vol" title={t('play.volume')}>
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <input
          className="off-compact-audio__vol-input"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label={t('play.volume')}
          onChange={(e) => onVolumeChange?.(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
