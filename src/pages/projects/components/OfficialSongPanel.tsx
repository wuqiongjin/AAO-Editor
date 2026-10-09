// 「从官方谱面导入」的选曲面板（票 08）：曲库一次拉全 + 本地瞬时搜索 + 就地预览（封面 / 难度等级表 / 试听）。
//
// 取数分工（见 ADR-0011 §2 的限定条款）：
//   - 曲库索引、乐队索引、单曲详情 —— 走主进程网关（能力层，票 07/08）；
//   - 封面与试听 —— 媒体标签直链（`<img>` / `<audio>`），**只在你选中 / 点播放时才发那一条请求**，
//     列表本身不拉任何图片（822 首 × 一张封面的流量账不能这么算）。
//
// 面板只产出「选中了哪首歌 + 两个选项」，建工程与落盘归页面（`officialImport`）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Music4 } from 'lucide-react';
import {
  OFFICIAL_DIFFICULTIES,
  officialDiffIndex,
  type OfficialDifficulty,
} from '../../../community/bestdori/endpoints';
import {
  resolveSongDiff,
  songLevel,
  type OfficialSongDetail,
  type SongCandidate,
} from '../../../community/bestdori/mapping';
import {
  audioPreviewUrl,
  fetchSongCatalog,
  fetchSongDetail,
  jacketPreviewUrl,
  searchSongCandidates,
} from '../../../community/bestdori/songs';
import { createCommunityTransport } from '../../../community/electronTransport';
import type { CommunityTransport } from '../../../community/transport';
import { DIFF_COLORS, DIFF_NAMES, DIFF_SHORT } from '../../../project/projectCatalog';
import { t } from '../../../i18n';
import { officialErrorText } from '../officialImport';

/** 选曲面板交给页面的东西：一首歌 + 它的详情 + 两个选项（A 素材默认做，B 谱面内容默认关） */
export interface OfficialSongSelection {
  song: SongCandidate;
  detail: OfficialSongDetail;
  /** B：把官方谱面代码 Apply 进这张谱面 */
  withChart: boolean;
  /** B 的难度（不勾时忽略：产出 Expert） */
  diff: OfficialDifficulty;
}

export function OfficialSongPanel({
  selection,
  onSelectionChange,
  transport,
}: {
  selection: OfficialSongSelection | null;
  onSelectionChange: (selection: OfficialSongSelection | null) => void;
  /** 注入点：不传就走 IPC 出口（静态演示版为 'none'，界面呈现「仅桌面版」） */
  transport?: CommunityTransport;
}) {
  const net = useMemo(() => transport ?? createCommunityTransport(), [transport]);
  const [catalog, setCatalog] = useState<SongCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SongCandidate | null>(null);
  const [detail, setDetail] = useState<OfficialSongDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [withChart, setWithChart] = useState(selection?.withChart ?? false);
  const [diff, setDiff] = useState<OfficialDifficulty>(selection?.diff ?? 'expert');

  // 曲库一次拉全（822 首 / 约 400KB）：只在打开面板时拉一次，重试走同一入口（不轮询、不循环报错）
  const loadCatalog = useCallback(() => {
    if (net.kind === 'none') return;
    setLoadError(null);
    setCatalog(null);
    void fetchSongCatalog(net)
      .then(setCatalog)
      .catch((error: unknown) => setLoadError(officialErrorText(error)));
  }, [net]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const pick = useCallback((song: SongCandidate) => {
    setSelected(song);
    setDetail(null);
    setDetailError(null);
    setCoverFailed(false);
    setDiff((current) => resolveSongDiff(song, current));
    setLoadingDetail(true);
    void fetchSongDetail(net, song.id)
      .then(setDetail)
      .catch((error: unknown) => setDetailError(officialErrorText(error)))
      .finally(() => setLoadingDetail(false));
  }, [net]);

  // 选中项或选项一变就交给页面（页面据此决定「创建」键能不能按、按了建什么）
  useEffect(() => {
    onSelectionChange(selected && detail ? { song: selected, detail, withChart, diff } : null);
  }, [selected, detail, withChart, diff, onSelectionChange]);

  const filtered = useMemo(
    () => (catalog == null ? [] : searchSongCandidates(catalog, query)),
    [catalog, query],
  );

  if (net.kind === 'none') {
    return <p className="off-status">{t('projects.official.err.desktopOnly')}</p>;
  }

  return (
    <div className="off-panel">
      <div className="off-bar">
        <input
          className="off-search"
          value={query}
          placeholder={t('projects.official.searchPlaceholder')}
          aria-label={t('projects.official.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {catalog != null && (
          <span className="pp-muted off-count">{t('projects.official.count', { n: filtered.length })}</span>
        )}
      </div>

      {loadError ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{t('projects.official.loadFail')}</strong>
            <p style={{ margin: 0 }}>{loadError}</p>
            <div className="error-actions">
              <button type="button" onClick={loadCatalog}>{t('projects.official.retry')}</button>
            </div>
          </div>
        </div>
      ) : catalog == null ? (
        <p className="off-status">{t('projects.official.loading')}</p>
      ) : (
        <div className="off-body">
          {filtered.length === 0 ? (
            <p className="off-status off-status--list">{t('projects.official.empty')}</p>
          ) : (
            <ul className="off-list" role="listbox" aria-label={t('projects.official.listAria')}>
              {filtered.map((song) => (
                // li 只作分组，`option` 才是可选项（listbox 的孩子按无障碍树要被读成选项）
                <li key={song.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={song.id === selected?.id}
                    className={`off-row${song.id === selected?.id ? ' is-active' : ''}`}
                    onClick={() => pick(song)}
                  >
                    <span className="off-row__title">{song.title}</span>
                    <span className="off-row__artist pp-muted">{song.artist || t('projects.artistMissing')}</span>
                    <span className="off-row__levels">
                      {song.difficulties.map((entry) => (
                        <em key={entry.diff} style={{ borderColor: DIFF_COLORS[officialDiffIndex(entry.diff)] }}>
                          {DIFF_SHORT[officialDiffIndex(entry.diff)]} {entry.level}
                        </em>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="off-preview">
            {selected == null ? (
              <p className="off-status">{t('projects.official.pickHint')}</p>
            ) : (
              <>
                <div className="off-cover">
                  {coverFailed || selected.jacketImage === '' ? (
                    <Music4 size={38} aria-hidden />
                  ) : (
                    <img src={jacketPreviewUrl(selected)} alt="" onError={() => setCoverFailed(true)} />
                  )}
                </div>
                <b className="off-preview__title">{selected.title}</b>
                <span className="pp-muted">{selected.artist || t('projects.artistMissing')}</span>

                <ul className="off-levels">
                  {OFFICIAL_DIFFICULTIES.map((name) => {
                    const level = songLevel(selected, name);
                    return (
                      <li key={name} className={level == null ? 'is-missing' : ''}>
                        <em className="pp-pill__diff" style={{ background: DIFF_COLORS[officialDiffIndex(name)] }}>
                          {DIFF_SHORT[officialDiffIndex(name)]}
                        </em>
                        <span>{DIFF_NAMES[officialDiffIndex(name)]}</span>
                        <b>{level ?? t('projects.official.levelMissing')}</b>
                      </li>
                    );
                  })}
                </ul>

                {detailError ? (
                  <p className="off-status">{detailError}</p>
                ) : loadingDetail || detail == null ? (
                  <p className="off-status">{t('projects.official.detailLoading')}</p>
                ) : (
                  <audio className="off-audio" controls preload="none" src={audioPreviewUrl(selected, detail)} />
                )}

                <p className="off-note">{t('projects.official.assetsNote')}</p>

                <label className="off-check">
                  <input
                    type="checkbox"
                    checked={withChart}
                    disabled={detail == null}
                    onChange={(e) => setWithChart(e.target.checked)}
                  />
                  <span>{t('projects.official.withChart')}</span>
                </label>
                {withChart && (
                  <label className="dialog-field">
                    <span>{t('projects.official.chartDiff')}</span>
                    <select value={diff} onChange={(e) => setDiff(e.target.value as OfficialDifficulty)}>
                      {selected.difficulties.map((entry) => (
                        <option key={entry.diff} value={entry.diff}>
                          {DIFF_NAMES[officialDiffIndex(entry.diff)]} · {t('projects.official.levelValue', { level: entry.level })}
                        </option>
                      ))}
                    </select>
                    <small>{t('projects.official.chartHint')}</small>
                  </label>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
