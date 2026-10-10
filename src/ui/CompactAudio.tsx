// 紧凑试听条（票 13 #11e）：弹窗密度，不套工作台 PlayBar。
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
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
  onError,
}: {
  src: string | null;
  /** 载入失败（票 16：本机 404 → 调用方降级成直链） */
  onError?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

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

  return (
    <div className="off-compact-audio">
      {src != null && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onError={onError}
          onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
          onDurationChange={() => setDuration(audioRef.current?.duration ?? 0)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <button
        type="button"
        className="off-compact-audio__play"
        disabled={src == null}
        aria-label={playing ? t('projects.official.pausePreview') : t('projects.official.playPreview')}
        onClick={toggle}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
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
      <Volume2 size={14} className="off-compact-audio__vol" aria-hidden />
    </div>
  );
}
