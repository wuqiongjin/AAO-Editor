import playbackMarkerSvgUrl from '../assets/playback-marker/flag.svg?url';
import { formatKey } from '../chart/config/ShortcutConfig';
import { formatTimePrecise } from '../chart/geometry/TimeFormat';
import { PLAYBACK_MARKER_CARD_WIDTH, PLAYBACK_MARKER_CARD_HEIGHT } from '../visual/playbackMarker';
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
  // 与播放条时间码同一口径（mm:ss.d，TimeFormat.formatTimePrecise）——不要在这里再写一份 toFixed
  const time = formatTimePrecise(seconds);

  return (
    <div className="playback-marker-card is-set">
      <button
        type="button"
        className="playback-marker-card__button"
        aria-label={t('editor.markerJumpAria')}
        title={tooltip}
        onClick={onJump}
      >
        <img
          src={playbackMarkerSvgUrl}
          alt=""
          draggable={false}
          // 尺寸真源在 playbackMarker.ts（卡片与画布同款旗帜，只差一档）
          style={{ width: PLAYBACK_MARKER_CARD_WIDTH, height: PLAYBACK_MARKER_CARD_HEIGHT }}
        />
      </button>
      <span className="playback-marker-card__label">
        {t('editor.markerSet', { time })}
      </span>
    </div>
  );
}
