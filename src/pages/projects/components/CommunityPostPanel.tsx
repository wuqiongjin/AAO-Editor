// 「从社区谱面导入」的帖子面板（票 09）：骨架与交互完全照 OfficialSongPanel（票 13 #5/#6：
// 官方 / 社区同一颗 lg 窗；票 21 手风琴；票 24 封面三态；票 16 试听本机优先）。
// 内容换成帖子：原帖标题 + 谱师 + 乐队 + 发布时间 + 难度等级芯片 + 试听（custom 帖内音频 /
// bandori 官方音频）+ 「同步导入谱面」芯片。
//
// 与官方面板的四处结构性不同：
//   1. **列表走服务端分页**（post/list，一次 50 条）+ **上拉加载**：滚到底自动拉下一页；
//      关键字搜索也是服务端的（防抖 350ms，改查询重置列表与选中）。
//   2. **等级 / 难度筛选只在客户端、只作用于已加载的条目，且不自动补扫**：筛选条件拼不进
//      服务端请求（§2.2），补扫按全库命中率算太贵（Expert 33+ 4% → 13 页 ≈ 34s）；
//      搜索是服务端的、结果通常很小，两者叠加本就完整 —— 范围由列表尾那行明说。
//   3. **发布时间进列表行**：行右列 = 难度等级芯片 + 时间小字；预览栏不重复时间 ——
//      它是「什么时候」的维度，跟谱师（谁作的）挤一行会互相拖累。
//   4. bandori 帖的封面 / 试听 / 导入素材都从曲库那条路走（面板照常拉曲库索引，命中会话缓存）。
//   5. **纯数字查询走两路**（票 32）：服务端 `search=<数字>` + `post/details?id=<数字>` 直查，
//      直查命中置顶、两路按 postId 去重、直查失败静默忽略；命中那条进会话内 id 缓存（翻页 / 重开不重发）。
//   6. **postId 常驻展示**（票 32 + 验收回修）：只放**列表行**（与日期同一档的右列小字）——
//      ID 搜索出多条时要能辨别目标，而列表就在预览栏旁边，预览栏再写一遍是重复。
//
// 「同步导入谱面」芯片与官方那颗同形同义（默认开）：关掉 = 只建工程 + 音频 + 封面，
// 产出对齐官方「没勾 B」（空 Expert、等级不预填），并且连帖子详情都不请求。
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ListFilter, Music4, RefreshCw, X } from 'lucide-react';
import { useConfig } from '../../../app/providers/ConfigProvider';
import { OFFICIAL_DIFFICULTIES, officialDiffIndex } from '../../../community/bestdori/endpoints';
import type { OfficialSongDetail, PostCandidate, SongCandidate } from '../../../community/bestdori/mapping';
import {
  clearPostIdLookupCache,
  customAudioLocalUrl,
  customAudioPreviewUrl,
  customCoverLocalUrl,
  fetchPostPage,
  fetchPostSearchPage,
  filterPostCandidates,
  peekPostPage,
  postPageInflight,
} from '../../../community/bestdori/posts';
import {
  audioLocalUrl,
  audioPreviewUrl,
  ensureOfficialCoverCached,
  fetchSongCatalog,
  fetchSongDetail,
  jacketLocalUrl,
  jacketPreviewUrl,
  SONG_LEVEL_FILTER_DEFAULT,
} from '../../../community/bestdori/songs';
import { createCommunityTransport } from '../../../community/electronTransport';
import { isJsonFromCache, type CommunityTransport } from '../../../community/transport';
import { DIFF_COLORS, DIFF_SHORT } from '../../../project/projectCatalog';
import { t } from '../../../i18n';
import CompactAudio from '../../../ui/CompactAudio';
import LoadingShimmer, { useSlowLoading } from '../../../ui/LoadingShimmer';
import { showToast } from '../../../ui/Toast';
import { communityErrorText } from '../communityImport';
import CommunityPostThumb from './CommunityPostThumb';

/** 面板交给页面的东西：帖子 + （bandori 帖）选中的曲库候选与歌曲元数据 + 是否带谱面 */
export interface CommunityPostSelection {
  post: PostCandidate;
  song?: SongCandidate;
  detail?: OfficialSongDetail;
  withChart: boolean;
}

/** 服务端搜索的防抖（ms）：post/list 一次往返不便宜，别每敲一个字发一发 */
const SEARCH_DEBOUNCE_MS = 350;

function formatPostDate(time: number | null): string {
  if (time == null) return '';
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 难度芯片文案：与官方支同一套记号（勾中的那张带 ✓） */
function chipLabel(diff: number, level: number | null, picked: boolean): string {
  const text = `${DIFF_SHORT[diff]}${level != null ? ` ${level}` : ''}`;
  return picked ? `✓ ${text}` : text;
}

export function CommunityPostPanel({
  onSelectionChange,
  transport,
}: {
  onSelectionChange: (selection: CommunityPostSelection | null) => void;
  /** 注入点：不传就走 IPC 出口（静态演示版为 'none'，界面呈现「仅桌面版」） */
  transport?: CommunityTransport;
}) {
  const net = useMemo(() => transport ?? createCommunityTransport(), [transport]);
  const { settings, setAudioVolume, setImportWithChart } = useConfig();

  // 列表：服务端分页 + 上拉加载。rawCount 是服务端游标（含被映射层丢弃的 llsif / 坏条目），
  // 翻页 offset 与翻完判定都按它走 —— 候选数 ≠ 服务端序列长度
  const [posts, setPosts] = useState<PostCandidate[] | null>(null);
  const [rawCount, setRawCount] = useState(0);
  const [endReached, setEndReached] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  // 等级 / 难度：客户端过滤（§2.2），只作用于已加载的条目（不自动补扫）
  const [needDiff, setNeedDiff] = useState<number | null>(null);
  const [lvMin, setLvMin] = useState<number>(SONG_LEVEL_FILTER_DEFAULT.min);
  const [lvMax, setLvMax] = useState<number>(SONG_LEVEL_FILTER_DEFAULT.max);
  const [filterOpen, setFilterOpen] = useState(false);

  // bandori 帖要用的曲库（会话缓存，切 tab 回来不重拉）
  const [catalog, setCatalog] = useState<SongCandidate[] | null>(null);

  // 选中 / 预览（票 21：expanded 与 selected 分开，收起只关窗不清内容）
  const [selected, setSelected] = useState<PostCandidate | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [song, setSong] = useState<SongCandidate | null>(null);
  const [detail, setDetail] = useState<OfficialSongDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [coverReady, setCoverReady] = useState(false);
  const [coverUseDirect, setCoverUseDirect] = useState(false);
  const [audioUseDirect, setAudioUseDirect] = useState(false);
  const [coverNonce, setCoverNonce] = useState(0);
  /** 票 28：「同步导入谱面」跨官方/社区共用偏好 settings.projects.importWithChart（默认开） */
  const withChart = settings.projects.importWithChart;

  // 防抖搜索：350ms 内的连续输入只发最后一发
  useEffect(() => {
    const timer = setTimeout(() => setActiveQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // 防抖后的防陈旧卫兵：慢响应回来时查询已变，丢弃
  const loadSeq = useRef(0);
  const [waitSlow, setWaitSlow] = useState(false);
  const loadFirst = useCallback((q: string) => {
    if (net.kind === 'none') return;
    const seq = ++loadSeq.current;
    const peeked = peekPostPage(q, 0);
    const inflight = postPageInflight(q, 0);
    if (peeked) {
      setPosts(peeked.posts);
      setRawCount(peeked.rawCount);
      setEndReached(peeked.rawCount >= peeked.total || peeked.posts.length === 0);
      setLoadError(null);
      if (inflight == null) return;
    } else {
      setPosts(null);
      setRawCount(0);
      setEndReached(false);
      setLoadError(null);
    }
    setRetrying(false);
    setRefreshing(true);
    // 票 32：首屏走「两路」入口（纯数字查询时并发 id 直查）；深页（loadMore）只走服务端那一页
    void fetchPostSearchPage(net, { query: q, offset: 0, onRetry: () => setRetrying(true) })
      .then((page) => {
        if (seq !== loadSeq.current) return;
        setPosts(page.posts);
        setRawCount(page.rawCount);
        setEndReached(page.rawCount >= page.total || page.posts.length === 0);
        setLoadError(null);
        if (isJsonFromCache(page)) showToast(t('projects.community.loadFailCache'), 'warn');
      })
      .catch((error: unknown) => {
        if (seq !== loadSeq.current) return;
        const fallback = peekPostPage(q, 0);
        if (fallback) {
          setPosts(fallback.posts);
          setRawCount(fallback.rawCount);
          setEndReached(fallback.rawCount >= fallback.total || fallback.posts.length === 0);
          setLoadError(null);
          showToast(t('projects.community.loadFailCache'), 'warn');
          return;
        }
        setLoadError(communityErrorText(error));
      })
      .finally(() => {
        if (seq !== loadSeq.current) return;
        setRetrying(false);
        setRefreshing(false);
      });
  }, [net]);

  const loadCatalog = useCallback(() => {
    if (net.kind === 'none') return;
    void fetchSongCatalog(net).then(setCatalog).catch(() => {
      // 曲库失败不挡帖子列表（custom 帖不受影响）；bandori 帖的行退图标、选中退提示
      setCatalog(null);
    });
  }, [net]);

  // 首屏：帖子第一页 + 曲库索引（并行；曲库是 bandori 帖的辅助数据，失败不挡主线）
  useEffect(() => {
    loadFirst(activeQuery);
    loadCatalog();
  }, [activeQuery, loadFirst, loadCatalog]);

  const waitingBlank = posts == null && loadError == null && net.kind !== 'none';
  useEffect(() => {
    setWaitSlow(false);
    if (!waitingBlank) return;
    const timer = setTimeout(() => setWaitSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [waitingBlank]);

  const loadingRef = useRef(false);

  // 上拉加载：滚到底翻下一页。loadingRef 在同步段置位，重渲染也不会双发
  const loadMore = useCallback(() => {
    if (net.kind === 'none' || loadingRef.current) return;
    if (posts == null || endReached || loadError != null) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    void fetchPostPage(net, { query: activeQuery, offset: rawCount, onRetry: () => setRetrying(true) })
      .then((page) => {
        setPosts((prev) => {
          if (prev == null) return page.posts;
          // 翻页期间有新帖插入会造成漂移：按 postId 去重，宁可少一条也不重复
          const seen = new Set(prev.map((post) => post.postId));
          return [...prev, ...page.posts.filter((post) => !seen.has(post.postId))];
        });
        const scanned = rawCount + page.rawCount;
        setRawCount(scanned);
        // 空页也当翻完：total 是平台侧 count，新帖插入/丢弃条目都可能让它对不上
        setEndReached(scanned >= page.total || page.posts.length === 0);
      })
      .catch((error: unknown) => setLoadMoreError(communityErrorText(error)))
      .finally(() => {
        loadingRef.current = false;
        setLoadingMore(false);
        setRetrying(false);
      });
  }, [net, posts, endReached, loadError, activeQuery, rawCount]);

  // 用户主动刷新（票 09 反馈 #2 的出口）：丢掉会话内页缓存 + 让网关重拉第一页。
  // 失败**保留旧列表、不弹错**（"上次结果继续用" 的口径）；成功则整段换成新的一页。
  const refresh = useCallback(() => {
    if (net.kind === 'none' || refreshing) return;
    setRefreshing(true);
    // 票 32：刷新重问数字 id；票 44：不清页缓存，失败仍出示上一份
    clearPostIdLookupCache();
    void fetchPostSearchPage(net, { query: activeQuery, offset: 0, force: true, onRetry: () => setRetrying(true) })
      .then((page) => {
        setPosts(page.posts);
        setRawCount(page.rawCount);
        setEndReached(page.rawCount >= page.total || page.posts.length === 0);
        setLoadError(null);
        setLoadMoreError(null);
      })
      .catch(() => {
        showToast(t('projects.community.refreshFail'), 'danger');
      })
      .finally(() => {
        setRefreshing(false);
        setRetrying(false);
      });
  }, [net, refreshing, activeQuery]);

  // 上拉加载哨兵：进视口（提前 200px）就翻下一页。observer 挂在 effect 里，重渲染重挂也只留一份
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const node = sentinelRef.current;
    if (node == null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, endReached, loadError, posts]);

  // 客户端筛选：只作用于已加载的条目（**不自动补扫** —— 首次扫描成本太高，见文件头；
  // 范围与命中数由列表尾那行明说，用户自己决定要不要继续上拉或加关键字）
  const levelFilterActive = lvMin !== SONG_LEVEL_FILTER_DEFAULT.min
    || lvMax !== SONG_LEVEL_FILTER_DEFAULT.max;
  const filterActive = needDiff != null || levelFilterActive;
  const clearFilters = () => {
    setNeedDiff(null);
    setLvMin(SONG_LEVEL_FILTER_DEFAULT.min);
    setLvMax(SONG_LEVEL_FILTER_DEFAULT.max);
  };
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (needDiff != null) parts.push(DIFF_SHORT[needDiff]);
    if (levelFilterActive) parts.push(`${lvMin}–${lvMax}`);
    return parts.join(' · ');
  }, [needDiff, levelFilterActive, lvMin, lvMax]);

  const filtered = useMemo(
    () => (posts == null
      ? []
      : filterPostCandidates(posts, {
          diff: needDiff,
          levelMin: levelFilterActive ? lvMin : undefined,
          levelMax: levelFilterActive ? lvMax : undefined,
        })),
    [posts, needDiff, levelFilterActive, lvMin, lvMax],
  );

  const catalogById = useMemo(() => {
    const map = new Map<number, SongCandidate>();
    for (const entry of catalog ?? []) map.set(entry.id, entry);
    return map;
  }, [catalog]);

  // 票 20 一族的守卫：重复点同一行不重跑整条链
  const pick = useCallback((post: PostCandidate) => {
    const same = selected?.postId === post.postId;
    setSelected(post);
    setExpanded(true);
    if (!same) {
      // 封面四态只在换帖时重置：`<img src>` 不变不会再发 onLoad，重置会让封面永久消失
      setSong(null);
      setDetail(null);
      setDetailError(null);
      setLoadingDetail(false);
      setCoverFailed(false);
      setCoverReady(false);
      setCoverUseDirect(false);
      setAudioUseDirect(false);
    }
    if (post.song.kind !== 'bandori') return;
    const found = catalogById.get(post.song.songId) ?? null;
    setSong(found);
    if (found == null) {
      setDetailError(t('projects.community.err.songMissing'));
      return;
    }
    // 选中即把官方封面收进素材缓存（票 16 口径）：预览大图与导入零下载的保险
    void ensureOfficialCoverCached(net, found).catch(() => undefined);
    // 详情已到手 / 正在取：重复点击什么都不做。取失败了才重跑（唯一的重试入口）
    if (same && (detail != null || loadingDetail)) return;
    setDetail(null);
    setDetailError(null);
    setLoadingDetail(true);
    void fetchSongDetail(net, found.id)
      .then(setDetail)
      .catch((error: unknown) => setDetailError(communityErrorText(error)))
      .finally(() => setLoadingDetail(false));
  }, [net, selected, detail, loadingDetail, catalogById]);

  const collapse = useCallback(() => setExpanded(false), []);

  // 票 24：封面失败态的就地重试（只在 onError 终态后可触发；nonce 强制重挂重走降级链）
  const retryCover = useCallback(() => {
    setCoverFailed(false);
    setCoverReady(false);
    setCoverUseDirect(false);
    setCoverNonce((n) => n + 1);
  }, []);

  // 票 24 · 缓存图竞态护栏：img 在 onLoad 挂上前已 complete 时补判一次
  const coverImgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = coverImgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setCoverReady(true);
  }, [selected, coverUseDirect, coverNonce]);

  const noCover = selected == null
    || (selected.song.kind === 'custom' && selected.song.coverUrl == null)
    || (selected.song.kind === 'bandori' && (song?.jacketImage ?? '') === '');
  const coverSlow = useSlowLoading(
    selected == null || coverReady || coverFailed || noCover,
    selected == null ? '' : `${selected.postId}:${coverUseDirect}:${coverNonce}`,
  );

  // 查询变了 = 列表是另一份了：选中与预览一并撤（上层「创建」随之禁用）
  useEffect(() => {
    setSelected(null);
    setExpanded(false);
  }, [activeQuery]);

  // 上报选区：custom 帖选中即就绪；bandori 帖等曲库候选 + 歌曲元数据到位
  useEffect(() => {
    const ready = selected != null && expanded
      && (selected.song.kind === 'custom' || (song != null && detail != null));
    onSelectionChange(ready && selected
      ? {
          post: selected,
          ...(song != null ? { song } : {}),
          ...(detail != null ? { detail } : {}),
          withChart,
        }
      : null);
  }, [selected, expanded, song, detail, withChart, onSelectionChange]);

  // 列表尾部的状态行：加载失败 / 加载中 / **筛选范围** / 翻完了
  const listTail = (() => {
    if (loadMoreError != null) {
      return (
        <li className="off-status off-status--list" role="alert">
          {loadMoreError}
          <button type="button" onClick={loadMore}>{t('projects.community.retry')}</button>
        </li>
      );
    }
    if (loadingMore || retrying) {
      return (
        <li className="off-foot">
          <i className="off-spinner" aria-hidden />
          {retrying ? t('projects.community.retrying') : t('projects.community.loadingMore')}
        </li>
      );
    }
    // 筛选生效：说清「只筛了已加载的这么多」—— 平台没有服务端筛选字段，这是唯一诚实的说法
    if (filterActive && posts != null) {
      return (
        <li className="off-status off-status--list">
          {t('projects.community.filterScope', { loaded: posts.length, hits: filtered.length })}
        </li>
      );
    }
    // 票 46：浏览翻完用 A 的「没有更多了」；搜索短结果不写（顶部已有计数）
    if (endReached && posts != null && posts.length > 0 && activeQuery === '') {
      return <li className="off-foot is-quiet">{t('projects.community.noMore')}</li>;
    }
    return null;
  })();

  if (net.kind === 'none') {
    return <p className="off-status">{t('projects.community.err.desktopOnly')}</p>;
  }

  /** 试听的 src：custom 帖走帖内音频，bandori 帖走官方音频；都是本机优先 → 直链 */
  const audioSrc = (() => {
    if (!expanded || selected == null) return null;
    if (selected.song.kind === 'custom') {
      return audioUseDirect ? customAudioPreviewUrl(selected) : customAudioLocalUrl(selected);
    }
    if (song != null && detail != null) {
      return audioUseDirect ? audioPreviewUrl(song, detail) : audioLocalUrl(song, detail);
    }
    return null;
  })();

  /** 预览区封面的 src：custom 帖走帖内封面，bandori 帖走官方 jacket；都是本机优先 */
  const coverSrc = (() => {
    if (selected == null) return '';
    if (selected.song.kind === 'custom') {
      return coverUseDirect ? selected.song.coverUrl ?? '' : customCoverLocalUrl(selected);
    }
    if (song != null) {
      return coverUseDirect ? jacketPreviewUrl(song) : jacketLocalUrl(song);
    }
    return '';
  })();

  return (
    <div className="off-panel">
      <div className="off-bar">
        <input
          className="off-search"
          value={query}
          placeholder={t('projects.community.searchPlaceholder')}
          aria-label={t('projects.community.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* 主动刷新（票 09 反馈 #2）：不清列表，拉回第一页再整段替换；失败保留旧数据 */}
        <button
          type="button"
          className={`off-refresh${refreshing ? ' is-busy' : ''}`}
          aria-label={t('projects.community.refresh')}
          title={t('projects.community.refresh')}
          disabled={refreshing}
          onClick={refresh}
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
        {posts != null && (
          <span className="pp-muted off-count">{t('projects.community.count', { n: posts.length })}</span>
        )}
      </div>

      {filterOpen && (
        <div className="off-filters">
          <div className="off-filters__diffs" role="group" aria-label={t('projects.community.filterDiff')}>
            {OFFICIAL_DIFFICULTIES.map((id) => {
              const index = officialDiffIndex(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`off-chip${needDiff === index ? ' is-on' : ''}`}
                  style={{ '--chip': DIFF_COLORS[index] } as CSSProperties}
                  onClick={() => setNeedDiff((current) => (current === index ? null : index))}
                >
                  {DIFF_SHORT[index]}
                </button>
              );
            })}
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
        <div className="off-blank" role="alert">
          <b>{t('projects.community.loadFailRetry')}</b>
        </div>
      ) : posts == null ? (
        <div className="off-blank" role="status">
          <i className="off-spinner" aria-hidden />
          <b>{retrying ? t('projects.community.retrying') : activeQuery !== '' ? t('projects.community.searching') : (waitSlow ? t('projects.community.loadingSlow') : t('projects.community.loading'))}</b>
        </div>
      ) : (
        <div className={`off-split${expanded ? '' : ' is-collapsed'}`}>
          <aside className={`off-preview${expanded ? '' : ' is-collapsed'}`} aria-hidden={!expanded}>
            {selected != null && (
              <div className="off-preview__inner">
                <div className="off-preview__stack">
                  <div className="off-cover">
                    {noCover ? (
                      <Music4 size={38} aria-hidden />
                    ) : coverFailed ? (
                      <button type="button" className="off-cover__retry" onClick={retryCover}>
                        <Music4 size={30} aria-hidden />
                        <span className="off-cover__retry-text">{t('projects.official.coverFailed')}</span>
                      </button>
                    ) : (
                      <>
                        {!coverReady && coverSlow && (
                          <>
                            <LoadingShimmer />
                            <i className="off-cover__spin" aria-hidden />
                          </>
                        )}
                        <img
                          key={coverNonce}
                          ref={coverImgRef}
                          src={coverSrc}
                          alt=""
                          className={coverReady ? 'is-in' : ''}
                          onLoad={() => setCoverReady(true)}
                          onError={() => {
                            if (coverUseDirect) setCoverFailed(true);
                            else setCoverUseDirect(true);
                          }}
                        />
                      </>
                    )}
                  </div>
                  <b className="off-preview__title">{selected.title !== '' ? selected.title : t('projects.community.noTitle')}</b>
                  {/* 信息层级照官方面板：标题下是「人」（谱师），再下一行才是「这首歌的乐队」 */}
                  <span className="pp-muted off-preview__artist">
                    {selected.charter !== '' ? selected.charter : t('projects.community.charterMissing')}
                  </span>
                  {selected.artists !== '' && (
                    <span className="pp-muted off-preview__artist">{selected.artists}</span>
                  )}
                  <div className={`off-preview__levels${withChart ? ' is-pick' : ''}`}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={withChart ? 'is-picked' : ''}
                      style={{ '--chip': DIFF_COLORS[selected.diff] } as CSSProperties}
                    >
                      {chipLabel(selected.diff, selected.level, withChart)}
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`off-sync${withChart ? ' is-on' : ''}`}
                    aria-pressed={withChart}
                    onClick={() => setImportWithChart(!withChart)}
                  >
                    <span className={`off-switch${withChart ? ' is-on' : ''}`} aria-hidden><i /></span>
                    {t('projects.official.withChart')}
                  </button>
                  {selected.song.kind === 'bandori' && detailError != null ? (
                    <p className="off-status">{detailError}</p>
                  ) : selected.song.kind === 'bandori' && detail == null ? (
                    <div className="off-compact-audio is-skeleton" aria-hidden>
                      <LoadingShimmer />
                    </div>
                  ) : (
                    <CompactAudio
                      src={audioSrc}
                      volume={settings.audio.volume}
                      onVolumeChange={setAudioVolume}
                      onError={() => {
                        if (!audioUseDirect) setAudioUseDirect(true);
                      }}
                      onRetry={() => setAudioUseDirect(false)}
                    />
                  )}
                </div>
              </div>
            )}
          </aside>

          {posts.length === 0 ? (
            <div className="off-blank">
              <b>{t('projects.community.empty')}</b>
            </div>
          ) : filtered.length === 0 ? (
            /* 筛选后为空：说清是「已加载的这些里没有」——不是全站没有（筛选只作用于已加载条目） */
            <div className="off-blank">
              <b>{t('projects.community.emptyFiltered', { loaded: posts.length })}</b>
            </div>
          ) : (
            <ul className="off-list" role="listbox" aria-label={t('projects.community.listAria')}>
              {filtered.map((post) => (
                <li key={post.postId} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={expanded && post.postId === selected?.postId}
                    className={`off-row${expanded && post.postId === selected?.postId ? ' is-active' : ''}`}
                    onClick={() => (post.postId === selected?.postId
                      ? (expanded ? collapse() : setExpanded(true))
                      : pick(post))}
                  >
                    <CommunityPostThumb
                      post={post}
                      song={post.song.kind === 'bandori' ? catalogById.get(post.song.songId) : undefined}
                      transport={net}
                    />
                    <span className="off-row__text">
                      <span className="off-row__title">{post.title !== '' ? post.title : t('projects.community.noTitle')}</span>
                      <span className="off-row__artist pp-muted">{post.charter !== '' ? post.charter : t('projects.community.charterMissing')}</span>
                    </span>
                    {/* 票 32：帖 id 常驻（右列小字，与难度芯片 / 时间并排；不进 .off-row__levels ——
                        那条规则会给里面每个 span 套边框，id 会变成第二枚徽章） */}
                    <span className="off-row__id pp-muted" title={t('projects.community.idLabel')}>#{post.postId}</span>
                    <span className="off-row__levels">
                      <span style={{ borderColor: DIFF_COLORS[post.diff] }}>
                        {DIFF_SHORT[post.diff]}{post.level != null ? ` ${post.level}` : ''}
                      </span>
                    </span>
                    {/* 发布时间：列表本身就是时间序，右列与难度等级并排 */}
                    <span className="off-row__date">{formatPostDate(post.time)}</span>
                  </button>
                </li>
              ))}
              {listTail}
              {/* 上拉加载哨兵：进视口（提前 200px）就翻下一页 */}
              {!endReached && loadError == null && <li className="off-sentinel" role="presentation" ref={sentinelRef} aria-hidden />}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
