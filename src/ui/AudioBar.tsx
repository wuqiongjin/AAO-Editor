// 工程音频条（票 61 追加回修）：编辑工程信息与发布弹窗共用同一条只读音轨 + 设置入口。
// 设置动作只是带作用域跳转音频页；音频的解码 / 异常检查继续留在音频页，不在这里复制第二套。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AudioLines, SlidersHorizontal } from 'lucide-react';
import { t } from '../i18n';

function DialogMarquee({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current || !measureRef.current) return;
      const cWidth = containerRef.current.clientWidth;
      const sWidth = measureRef.current.scrollWidth;
      setContentWidth(sWidth);
      setOverflow(sWidth > cWidth + 4);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    return () => observer?.disconnect();
  }, [text]);

  const gap = 48;
  const cycleDist = contentWidth + gap;
  const totalSec = Math.max(8, cycleDist / 24);

  if (!overflow) {
    return (
      <div ref={containerRef} className="dialog-marquee" title={text}>
        <span ref={measureRef} className="dialog-marquee__content">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="dialog-marquee is-overflowing" title={text}>
      <span ref={measureRef} className="dialog-marquee__measure" aria-hidden="true">
        {text}
      </span>
      <div
        className="dialog-marquee__track"
        style={{
          '--marquee-dist': `-${cycleDist}px`,
          '--marquee-dur': `${totalSec.toFixed(2)}s`,
          gap: `${gap}px`,
        } as CSSProperties}
      >
        <span className="dialog-marquee__item">{text}</span>
        <span className="dialog-marquee__item" aria-hidden="true">{text}</span>
      </div>
    </div>
  );
}

export default function AudioBar({ name, durationText, missing, onOpenAudio }: {
  name?: string | null;
  durationText: string;
  missing?: boolean;
  onOpenAudio?: () => void;
}) {
  const text = `${name?.trim() || t('projects.noAudio')} · ${durationText}`;
  return (
    <div className={`dialog-audio-bar${missing ? ' is-missing' : ''}`}>
      <div className="dialog-audio-bar__info" title={text}>
        <AudioLines size={13} />
        <DialogMarquee text={text} />
      </div>
      {onOpenAudio && (
        <button
          type="button"
          className="dialog-audio-jump-btn"
          title={t('audio.jumpManageTitle')}
          onClick={onOpenAudio}
        >
          <SlidersHorizontal size={11} />
          {t('audio.jumpManage')}
        </button>
      )}
    </div>
  );
}
