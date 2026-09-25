import playbackMarkerSvgUrl from '../assets/playback-marker/flag.svg?url';
import { formatKey } from '../chart/config/ShortcutConfig';
import { t } from '../i18n';

interface PlaybackMarkerCardProps {
  seconds: number | null;
  shortcut: string | null;
  onJump: () => void;
}

export default function PlaybackMarkerCard({ seconds, shortcut, onJump }: PlaybackMarkerCardProps) {
  if (seconds === null) {
    return (
      <div className="playback-marker-card is-empty">
        <span>{t('editor.markerHint')}</span>
      </div>
    );
  }

  const key = shortcut ? formatKey(shortcut) : t('editor.markerShortcutUnset');
  const tooltip = t('editor.markerJumpTooltip', { key });

  return (
    <div className="playback-marker-card is-set">
      <button
        type="button"
        className="playback-marker-card__button"
        aria-label={t('editor.markerJumpAria')}
        title={tooltip}
        onClick={onJump}
      >
        <img src={playbackMarkerSvgUrl} alt="" draggable={false} />
      </button>
      <span className="playback-marker-card__label">
        {t('editor.markerSet', { seconds: seconds.toFixed(2) })}
      </span>
    </div>
  );
}
