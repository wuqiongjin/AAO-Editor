// 「从官方谱面导入」的选曲面板（票 08 + 票 13 #7–#11）：
// 预览在左、目录在右；筛选手风琴；封面占位淡入；同步导入走同一排芯片。
// 预览素材本机优先（票 16）：封面大图 / 试听音频先读素材缓存（aao-asset://raw/），
// 未缓存协议 404 才落回直链 —— 已导入过的歌再次预览与导入都零网络。
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, ListFilter, Music4, RefreshCw, X } from 'lucide-react';
import { useConfig } from '../../../app/providers/ConfigProvider';
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
  refreshSongCatalog,
  SONG_LEVEL_FILTER_DEFAULT,
} from '../../../community/bestdori/songs';
import { createCommunityTransport } from '../../../community/electronTransport';
import type { CommunityTransport } from '../../../community/transport';
import { DIFF_COLORS, DIFF_SHORT } from '../../../project/projectCatalog';
import { t } from '../../../i18n';
import CompactAudio from '../../../ui/CompactAudio';
import LoadingShimmer, { useSlowLoading } from '../../../ui/LoadingShimmer';
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
  // 票 22：本面板就是「预览播放器」，试听音量跟随 settings.audio.volume（chart-preview 20 同口径）
  const { settings, setAudioVolume } = useConfig();
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
  /** 票 24：封面重试 nonce —— 失败态重试时强制重挂 `<img>`，让「本机优先 → 直链」降级链重走一遍 */
  const [coverNonce, setCoverNonce] = useState(0);
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

  // 用户主动刷新曲库：清会话缓存 + `revalidate` 重拉；**失败保留旧列表、不弹错**（票 09 口径）
  const [refreshingCatalog, setRefreshingCatalog] = useState(false);
  const refreshCatalog = useCallback(() => {
    if (net.kind === 'none' || refreshingCatalog) return;
    setRefreshingCatalog(true);
    void refreshSongCatalog(net, undefined, () => setRetrying(true))
      .then((songs) => {
        setCatalog(songs);
        setLoadError(null);
      })
      .catch(() => undefined)
      .finally(() => {
        setRefreshingCatalog(false);
        setRetrying(false);
      });
  }, [net, refreshingCatalog]);

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

  // 票 24：封面失败态的就地重试。只许在 onError（请求终态）后触发 —— 同 URL 重挂一个
  // 「飞行中」的 img，Chromium 会让新请求永久挂住（ADR-0018 §3）。重试入口天然满足。
  const retryCover = useCallback(() => {
    setCoverFailed(false);
    setCoverReady(false);
    setCoverUseDirect(false);
    setCoverNonce((n) => n + 1);
  }, []);

  // 票 24 · 缓存图竞态护栏（票 20 一族）：img 在 onLoad 挂上前已 complete（重挂载 / 磁盘缓存）
  // 时 onLoad 永不来 → 微光层永不撤。挂载后同步补判一次。
  const coverImgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = coverImgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setCoverReady(true);
  }, [selected, coverUseDirect, coverNonce]);

  // 票 24 验收回修：微光/spinner 只表示「真的慢」—— 缓存秒开（协议往返 < 150ms）不再闪。
  // ready = 已就绪或终态（失败 / 无封面 / 没选中）；换歌 / 直链降级 / 重试都重置计时
  const coverSlow = useSlowLoading(
    selected == null || coverReady || coverFailed || selected.jacketImage === '',
    selected == null ? '' : `${selected.id}:${coverUseDirect}:${coverNonce}`,
  );

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
        {/* 主动刷新：与社区面板同一颗钮、同一个 `revalidate` 出口 —— 曲库索引在一个会话里不过期，
            不点它就只能等下次启动才看到新曲 */}
        <button
          type="button"
          className={`off-refresh${refreshingCatalog ? ' is-busy' : ''}`}
          aria-label={t('projects.official.refresh')}
          title={t('projects.official.refresh')}
          disabled={refreshingCatalog}
          onClick={refreshCatalog}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
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
                    {/* 票 24：封面三态可区分 —— 加载中（微光 + spinner）/ 失败（整块可点重试）/ 无封面（裸图标） */}
                    {selected.jacketImage === '' ? (
                      <Music4 size={38} aria-hidden />
                    ) : coverFailed ? (
                      <button type="button" className="off-cover__retry" onClick={retryCover}>
                        <Music4 size={30} aria-hidden />
                        <span className="off-cover__retry-text">{t('projects.official.coverFailed')}</span>
                      </button>
                    ) : (
                      <>
                        {/* spinner 与微光层平级、各自绝对定位居中 —— 不做微光层的子元素（见 LoadingShimmer 注释）；
                          验收回修：150ms 内就绪（缓存秒开）不出动效 */}
                        {!coverReady && coverSlow && (
                          <>
                            <LoadingShimmer />
                            <i className="off-cover__spin" aria-hidden />
                          </>
                        )}
                        <img
                          key={coverNonce}
                          ref={coverImgRef}
                          src={coverUseDirect ? jacketPreviewUrl(selected) : jacketLocalUrl(selected)}
                          alt=""
                          className={coverReady ? 'is-in' : ''}
                          onLoad={() => setCoverReady(true)}
                          onError={() => {
                            // 本机没有（未缓存，票 16）→ 落回直链；直链也不成（请求终态）→ 失败态可就地重试
                            if (coverUseDirect) setCoverFailed(true);
                            else setCoverUseDirect(true);
                          }}
                        />
                      </>
                    )}
                  </div>
                  <b className="off-preview__title">{selected.title}</b>
                  <span className="pp-muted off-preview__artist">{selected.artist || t('projects.artistMissing')}</span>
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
                    // 票 25：删 detail 门禁 —— 开关不依赖 detail（toggleSync 只用 selected），
                    // 换歌瞬间禁用闪灰像 BUG；「创建」仍另行等 detail，语义不变。
                    // 「detail 拉取中」的加载信号由下面试听条槽位的骨架微光承担
                    className={`off-sync${withChart ? ' is-on' : ''}`}
                    aria-pressed={withChart}
                    onClick={toggleSync}
                  >
                    <span className={`off-switch${withChart ? ' is-on' : ''}`} aria-hidden><i /></span>
                    {t('projects.official.withChart')}
                  </button>
                  {/* 票 23 反馈 4（复）：试听条移进 stack、跟在同步开关下面（自然流最后一项，
                     剩余空白沉到栏底）；detailError / 骨架 / 真条占同一槽位 */}
                  {detailError ? (
                    <p className="off-status">{detailError}</p>
                  ) : detail == null ? (
                    // 票 21 验收回修 + 票 25 职责收窄：等高骨架占位 —— `.off-compact-audio` 本身就是
                    // 32px 定高，detail 到位后原地换成真试听条，尺寸不变 = 零布局变化
                    <div className="off-compact-audio is-skeleton" aria-hidden>
                      <LoadingShimmer />
                    </div>
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
                      volume={settings.audio.volume}
                      onVolumeChange={setAudioVolume}
                      onError={() => {
                        // 本机没有（这歌没导入过，票 16）→ 落回直链边下边播；直链也败 → 组件内切重试态
                        if (!audioUseDirect) setAudioUseDirect(true);
                      }}
                      onRetry={() => {
                        // 票 22：重挂 `<audio>` 重走「本机 → 直链」降级链
                        setAudioUseDirect(false);
                      }}
                    />
                  )}
                </div>
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
