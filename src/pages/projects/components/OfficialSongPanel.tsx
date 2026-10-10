// 「从官方谱面导入」的选曲面板（票 08 + 票 13 #7–#11）：
// 预览在左、目录在右；筛选手风琴；封面占位淡入；同步导入走同一排芯片。
// 预览素材本机优先（票 16）：封面大图 / 试听音频先读素材缓存（aao-asset://raw/），
// 未缓存协议 404 才落回直链 —— 已导入过的歌再次预览与导入都零网络。
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, ListFilter, Music4, X } from 'lucide-react';
import {
  OFFICIAL_DIFFICULTIES,
  officialDiffIndex,
  type OfficialDifficulty,
} from '../../../community/bestdori/endpoints';
import {
  resolveSongDiff,
  type OfficialSongDetail,
  type SongCandidate,
} from '../../../community/bestdori/mapping';
import {
  audioLocalUrl,
  audioPreviewUrl,
  catalogBandOptions,
  ensureOfficialCoverCached,
  fetchSongCatalog,
  fetchSongDetail,
  filterSongCandidates,
  jacketLocalUrl,
  jacketPreviewUrl,
  SONG_LEVEL_FILTER_DEFAULT,
} from '../../../community/bestdori/songs';
import { createCommunityTransport } from '../../../community/electronTransport';
import type { CommunityTransport } from '../../../community/transport';
import { DIFF_COLORS, DIFF_SHORT } from '../../../project/projectCatalog';
import { t } from '../../../i18n';
import CompactAudio from '../../../ui/CompactAudio';
import { officialErrorText } from '../officialImport';
import OfficialSongThumb from './OfficialSongThumb';

/** 选曲面板交给页面的东西：一首歌 + 它的详情 + 两个选项（A 素材默认做，B 谱面内容默认关） */
export interface OfficialSongSelection {
  song: SongCandidate;
  detail: OfficialSongDetail;
  /** B：把官方谱面代码 Apply 进这张谱面 */
  withChart: boolean;
  /** B 的难度（不勾时忽略：产出 Expert） */
  diff: OfficialDifficulty;
}

function chipLabel(diff: OfficialDifficulty, level: number, picked: boolean): string {
  const short = DIFF_SHORT[officialDiffIndex(diff)];
  return picked ? `✓ ${short} ${level}` : `${short} ${level}`;
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
  const [bandId, setBandId] = useState<number | null>(null);
  const [needDiff, setNeedDiff] = useState<OfficialDifficulty | null>(null);
  const [lvMin, setLvMin] = useState<number>(SONG_LEVEL_FILTER_DEFAULT.min);
  const [lvMax, setLvMax] = useState<number>(SONG_LEVEL_FILTER_DEFAULT.max);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<SongCandidate | null>(null);
  /** 票 21：预览栏展没展开。与 `selected` 分开 —— 收起只是关窗，内容留着（收起动画才滑得起来） */
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<OfficialSongDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [coverReady, setCoverReady] = useState(false);
  /** 预览的本机 URL 没取到（票 16：未缓存协议 404）→ 落回直链（封面 / 音频各自一条降级链） */
  const [coverUseDirect, setCoverUseDirect] = useState(false);
  const [audioUseDirect, setAudioUseDirect] = useState(false);
  const [withChart, setWithChart] = useState(selection?.withChart ?? false);
  const [diff, setDiff] = useState<OfficialDifficulty>(selection?.diff ?? 'expert');
  const [retrying, setRetrying] = useState(false);

  const loadCatalog = useCallback((reload = false) => {
    if (net.kind === 'none') return;
    setLoadError(null);
    setRetrying(false);
    if (reload) setCatalog(null);
    void fetchSongCatalog(net, undefined, () => setRetrying(true))
      .then(setCatalog)
      .catch((error: unknown) => setLoadError(officialErrorText(error)))
      .finally(() => setRetrying(false));
  }, [net]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  // 票 20：重复点同一行不能重跑整条链 —— 见下面两处守卫
  const pick = useCallback((song: SongCandidate) => {
    const sameSong = selected?.id === song.id;
    setSelected(song);
    setExpanded(true);
    setDiff((current) => resolveSongDiff(song, current));
    // 选中即把封面收进素材缓存（票 16 Q2）：通常行可见时已收过（15/17），这里兜一次底 ——
    // 命中零网络、并发去重；之前那次后台取图失败的话，这一枪就是导入零下载的保险
    void ensureOfficialCoverCached(net, song).catch(() => undefined);
    // 封面状态只在换歌时重置：`<img src>` 不变就不会再发一次 onLoad，一旦把 coverReady 打回 false，
    // `.off-cover img`（opacity: 0）再也拿不回 `.is-in` —— 重复点同一行会让封面永久消失。
    if (!sameSong) {
      setCoverFailed(false);
      setCoverReady(false);
      setCoverUseDirect(false);
      setAudioUseDirect(false);
    }
    // 详情已到手 / 正在取：重复点击什么都不做。取失败了才重跑（这是目前唯一的重试入口）
    if (sameSong && (detail != null || loadingDetail)) return;
    setDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    void fetchSongDetail(net, song.id)
      .then(setDetail)
      .catch((error: unknown) => setDetailError(officialErrorText(error)))
      .finally(() => setLoadingDetail(false));
  }, [net, selected, detail, loadingDetail]);

  // 票 21：再点已展开的那一首 = 收起预览栏（= 取消选中，上层「创建」随之禁用）。
  // 只关窗、不清 `selected`：内容留着，收起动画才有东西可滑；再展开也不用重取详情、不用重新加载封面。
  const collapse = useCallback(() => {
    setExpanded(false);
  }, []);

  /** 行点击：同一首在「展开 ↔ 收起」之间切，换一首才走 pick */
  const toggleRow = useCallback((song: SongCandidate) => {
    if (song.id === selected?.id) {
      if (expanded) collapse();
      else setExpanded(true);
      return;
    }
    pick(song);
  }, [selected, expanded, collapse, pick]);

  useEffect(() => {
    onSelectionChange(selected && detail && expanded ? { song: selected, detail, withChart, diff } : null);
  }, [selected, detail, expanded, withChart, diff, onSelectionChange]);

  const bands = useMemo(() => (catalog == null ? [] : catalogBandOptions(catalog)), [catalog]);
  const filtered = useMemo(
    () => (catalog == null ? [] : filterSongCandidates(catalog, { query, bandId, difficulty: needDiff, levelMin: lvMin, levelMax: lvMax })),
    [catalog, query, bandId, needDiff, lvMin, lvMax],
  );

  const clearFilters = () => {
    setBandId(null);
    setNeedDiff(null);
    setLvMin(SONG_LEVEL_FILTER_DEFAULT.min);
    setLvMax(SONG_LEVEL_FILTER_DEFAULT.max);
  };

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (bandId != null) parts.push(bands.find((b) => b.id === bandId)?.name || String(bandId));
    if (needDiff) parts.push(DIFF_SHORT[officialDiffIndex(needDiff)]);
    if (lvMin !== SONG_LEVEL_FILTER_DEFAULT.min || lvMax !== SONG_LEVEL_FILTER_DEFAULT.max) parts.push(`${lvMin}–${lvMax}`);
    return parts.join(' · ');
  }, [bandId, bands, needDiff, lvMin, lvMax]);
  const filterActive = filterSummary !== '';

  if (net.kind === 'none') {
    return <p className="off-status">{t('projects.official.err.desktopOnly')}</p>;
  }

  const toggleSync = () => {
    if (selected == null) return;
    if (withChart) {
      setWithChart(false);
      return;
    }
    setWithChart(true);
    setDiff(resolveSongDiff(selected, 'expert'));
  };

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
        <div className="off-filter-wrap">
          <button
            type="button"
            className={`off-filter-btn${filterOpen ? ' is-on' : ''}${filterActive ? ' is-set' : ''}`}
            aria-expanded={filterOpen}
            aria-label={t('projects.official.filter')}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <ListFilter size={14} />
            {filterActive ? filterSummary : t('projects.official.filter')}
          </button>
          {filterActive && (
            <button
              type="button"
              className="off-filter-x"
              aria-label={t('projects.official.filterClearAria')}
              onClick={clearFilters}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {catalog != null && (
          <span className="pp-muted off-count">{t('projects.official.count', { n: filtered.length })}</span>
        )}
      </div>

      {filterOpen && (
        <div className="off-filters">
          <label>
            {t('projects.official.filterBand')}
            <select
              value={bandId ?? ''}
              aria-label={t('projects.official.filterBand')}
              onChange={(e) => setBandId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">{t('projects.official.filterBandAll')}</option>
              {bands.map((band) => (
                <option key={band.id} value={band.id}>{band.name || `#${band.id}`}</option>
              ))}
            </select>
          </label>
          <div className="off-filters__diffs" role="group" aria-label={t('projects.official.filterDiff')}>
            {OFFICIAL_DIFFICULTIES.map((id) => (
              <button
                key={id}
                type="button"
                className={needDiff === id ? 'is-on' : ''}
                style={{ '--chip': DIFF_COLORS[officialDiffIndex(id)] } as CSSProperties}
                onClick={() => setNeedDiff((current) => (current === id ? null : id))}
              >
                {DIFF_SHORT[officialDiffIndex(id)]}
              </button>
            ))}
          </div>
          <label className="off-filters__lv">
            {t('projects.official.filterLevel')}
            <input type="number" value={lvMin} aria-label={t('projects.official.filterLevelMin')} onChange={(e) => setLvMin(Number(e.target.value))} />
            <span>–</span>
            <input type="number" value={lvMax} aria-label={t('projects.official.filterLevelMax')} onChange={(e) => setLvMax(Number(e.target.value))} />
          </label>
          {filterActive && (
            <button type="button" className="off-filters__clear" onClick={clearFilters}>
              {t('projects.official.filterClear')}
            </button>
          )}
        </div>
      )}

      {loadError ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{t('projects.official.loadFail')}</strong>
            <p style={{ margin: 0 }}>{loadError}</p>
            <div className="error-actions">
              <button type="button" onClick={() => loadCatalog(true)}>{t('projects.official.retry')}</button>
            </div>
          </div>
        </div>
      ) : catalog == null ? (
        <p className="off-status">{retrying ? t('projects.official.retrying') : t('projects.official.loading')}</p>
      ) : (
        <div className={`off-split${expanded ? '' : ' is-collapsed'}`}>
          <aside className={`off-preview${expanded ? '' : ' is-collapsed'}`} aria-hidden={!expanded}>
            {selected != null && (
              <div className="off-preview__inner">
                <div className="off-preview__stack">
                  <div className="off-cover">
                    {selected.jacketImage !== '' && !coverFailed ? (
                      <>
                        {!coverReady && <span className="off-cover__ph">{t('projects.official.coverPlaceholder')}</span>}
                        <img
                          src={coverUseDirect ? jacketPreviewUrl(selected) : jacketLocalUrl(selected)}
                          alt=""
                          className={coverReady ? 'is-in' : ''}
                          onLoad={() => setCoverReady(true)}
                          onError={() => {
                            // 本机没有（未缓存，票 16）→ 落回直链；直链也不成 → 图标
                            if (coverUseDirect) setCoverFailed(true);
                            else setCoverUseDirect(true);
                          }}
                        />
                      </>
                    ) : (
                      <Music4 size={38} aria-hidden />
                    )}
                  </div>
                  <b className="off-preview__title">{selected.title}</b>
                  <span className="pp-muted">{selected.artist || t('projects.artistMissing')}</span>
                  <div
                    className={`off-preview__levels${withChart ? ' is-pick' : ''}`}
                    role={withChart ? 'radiogroup' : undefined}
                    aria-label={withChart ? t('projects.official.importDiffAria') : undefined}
                  >
                    {selected.difficulties.map((entry) => {
                      const picked = withChart && diff === entry.diff;
                      return (
                        <button
                          key={entry.diff}
                          type="button"
                          role={withChart ? 'radio' : undefined}
                          aria-checked={withChart ? picked : undefined}
                          tabIndex={withChart ? undefined : -1}
                          className={picked ? 'is-picked' : ''}
                          style={{ '--chip': DIFF_COLORS[officialDiffIndex(entry.diff)] } as CSSProperties}
                          onClick={() => withChart && setDiff(entry.diff)}
                        >
                          {chipLabel(entry.diff, entry.level, picked)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    // 票 21 验收回修：detail 未到位时是「禁用 + 微光」的骨架态（按钮高度由内容撑，
                    // 换成另一个骨架元素反而要额外钉高度，不换最稳）
                    className={`off-sync${withChart ? ' is-on' : ''}${detail == null ? ' is-loading' : ''}`}
                    aria-pressed={withChart}
                    aria-busy={detail == null}
                    disabled={detail == null}
                    onClick={toggleSync}
                  >
                    <span className={`off-switch${withChart ? ' is-on' : ''}`} aria-hidden><i /></span>
                    {t('projects.official.withChart')}
                  </button>
                </div>
                {detailError ? (
                  <p className="off-status">{detailError}</p>
                ) : detail == null ? (
                  // 票 21 验收回修：等高骨架占位 —— `.off-compact-audio` 本身就是 32px 定高，
                  // detail 到位后原地换成真试听条，尺寸不变 = 零布局变化
                  <div className="off-compact-audio is-skeleton" aria-hidden />
                ) : (
                  <CompactAudio
                    // 收起时掐掉 src：`<audio>` 随之卸载 → 试听立刻停（内容留着，但不再出声）
                    src={
                      !expanded
                        ? null
                        : audioUseDirect
                          ? audioPreviewUrl(selected, detail)
                          : audioLocalUrl(selected, detail)
                    }
                    onError={() => {
                      // 本机没有（这歌没导入过，票 16）→ 落回直链边下边播
                      setAudioUseDirect(true);
                    }}
                  />
                )}
              </div>
            )}
          </aside>

          {filtered.length === 0 ? (
            <p className="off-status off-status--list">{t('projects.official.empty')}</p>
          ) : (
            <ul className="off-list" role="listbox" aria-label={t('projects.official.listAria')}>
              {filtered.map((song) => (
                <li key={song.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={expanded && song.id === selected?.id}
                    className={`off-row${expanded && song.id === selected?.id ? ' is-active' : ''}`}
                    onClick={() => toggleRow(song)}
                  >
                    <OfficialSongThumb song={song} transport={net} />
                    <span className="off-row__text">
                      <span className="off-row__title">{song.title}</span>
                      <span className="off-row__artist pp-muted">{song.artist || t('projects.artistMissing')}</span>
                    </span>
                    <span className="off-row__levels">
                      {song.difficulties.map((entry) => (
                        <span key={entry.diff} style={{ borderColor: DIFF_COLORS[officialDiffIndex(entry.diff)] }}>
                          {DIFF_SHORT[officialDiffIndex(entry.diff)]} {entry.level}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
