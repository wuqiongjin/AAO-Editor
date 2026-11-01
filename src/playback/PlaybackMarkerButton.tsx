// 播放条时间码旁的播放起点按钮（issue 180 Q13 / Q25，票 182）：设了起点才出现，点 = 跳回并播放。
// 起点从「无」变「有」时弹入 + 一圈光晕，让用户注意到播放条多了个东西；挪动起点不重播。
import { memo, useState } from 'react';
import playbackMarkerSvgUrl from '../assets/playback-marker/flag.svg?url';
import { formatKey } from '../chart/config/ShortcutConfig';
import { formatTimePrecise, type TimePrecision } from '../chart/geometry/TimeFormat';
import { t } from '../i18n';
import './PlaybackMarkerButton.css';

interface PlaybackMarkerButtonProps {
  seconds: number | null;
  shortcut: string | null;
  timePrecision?: TimePrecision;
  onJump: () => void;
}

export default memo(function PlaybackMarkerButton({
  seconds,
  shortcut,
  timePrecision = 'standard',
  onJump,
}: PlaybackMarkerButtonProps) {
  const [prevSeconds, setPrevSeconds] = useState(seconds);
  const [isNew, setIsNew] = useState(false);
  if (prevSeconds !== seconds) {
    setPrevSeconds(seconds);
    if (prevSeconds === null && seconds !== null) setIsNew(true);
  }

  if (seconds === null) return null;
  const key = shortcut ? formatKey(shortcut) : t('editor.markerShortcutUnset');
  return (
    <button
      type="button"
      className={`playback-marker-btn${isNew ? ' is-new' : ''}`}
      title={t('editor.markerJumpTooltip', { key })}
      aria-label={t('editor.markerJumpAria')}
      onClick={onJump}
      onAnimationEnd={() => setIsNew(false)}
    >
      <img src={playbackMarkerSvgUrl} alt="" draggable={false} />
      <span>{formatTimePrecise(seconds, timePrecision)}</span>
    </button>
  );
});
