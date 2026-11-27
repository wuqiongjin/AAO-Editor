// 「从社区谱面导入」的帖子面板（票 09）：骨架与交互完全照 OfficialSongPanel（票 13 #5/#6：
// 官方 / 社区同一颗 lg 窗；票 21 手风琴；票 24 封面三态；票 16 试听本机优先）。
// 内容换成帖子：原帖标题 + 歌手 + 谱师 + 发布时间 + 难度等级芯片 + 试听（custom 帖内音频 /
// bandori 官方音频）+ 「同步导入谱面」芯片。
//
// 与官方面板的结构性不同：
//   1. **列表走服务端分页**（post/list，一次 50 条）+ **上拉加载**：滚到底自动拉下一页；
//      关键字搜索也是服务端的（防抖 350ms，改查询重置列表与选中）。
//   2. **等级 / 难度筛选只在客户端、只作用于已加载的条目，且不自动补扫**：筛选条件拼不进
//      服务端请求（§2.2），补扫按全库命中率算太贵（Expert 33+ 4% → 13 页 ≈ 34s）；
//      搜索是服务端的、结果通常很小，两者叠加本就完整 —— 范围由列表尾那行明说。
//   3. **行右列拆两行**（票 60）：难度等级芯片 + `#id · 时间`。三行文本（标题 / 歌手 / 谱师）
//      单行截断后行高恒定；时间留在列表行、预览栏不重复 —— 它是「什么时候」的维度。
//   4. bandori 帖的封面 / 试听 / 导入素材都从曲库那条路走（面板照常拉曲库索引，命中会话缓存）。
//   5. **纯数字查询走两路**（票 32）：服务端 `search=<数字>` + `post/details?id=<数字>` 直查，
//      直查命中置顶、两路按 postId 去重、直查失败静默忽略；命中那条进会话内 id 缓存（翻页 / 重开不重发）。
//   6. **postId 常驻展示**（票 32）：只放**列表行**（与日期同一档的右列小字）——
//      ID 搜索出多条时要能辨别目标，而列表就在预览栏旁边，预览栏再写一遍是重复。
//   7. **谱师只有「精确账号名」这一条检索路**（票 59）：平台 `search` 不索引作者，`username`
//      又不认昵称 / 前缀 —— 所以给了两个入口（预览栏点谱师名、搜索框并发探测账号名），
//      探测只在关键字零命中时采用，见 posts.fetchPostSearchPage。
//
// 「同步导入谱面」芯片与官方那颗同形同义（默认开）：关掉 = 只建工程 + 音频 + 封面，
// 产出对齐官方「没勾 B」（空 Expert、等级不预填），并且连帖子详情都不请求。
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ListFilter, Music4, RefreshCw, X } from 'lucide-react';
import { useConfig } from '../../../app/providers/ConfigProvider';
import { OFFICIAL_DIFFICULTIES, officialDiffIndex } from '../../../community/bestdori/endpoints';
import {
  postArtist,
  type OfficialSongDetail,
  type PostCandidate,
  type SongCandidate,
} from '../../../community/bestdori/mapping';
import {
  clearPostIdLookupCache,
  commitPostPageCache,
  customAudioLocalUrl,
  customAudioPreviewUrl,
  customCoverLocalUrl,
  fetchPostPage,
  fetchPostSearchPage,
  filterPostCandidates,
  loadPostPageFromCache,
  peekPostPage,
  type PostSearchPage,
} from '../../../community/bestdori/posts';
import {
  audioLocalUrl,
  audioPreviewUrl,
  ensureOfficialCoverCached,
  fetchSongCatalog,
  fetchSongDetail,
  jacketLocalUrl,
  jacketPreviewUrl,
  loadSongCatalogFromCache,
  peekSongCatalog,
  SONG_LEVEL_FILTER_DEFAULT,
} from '../../../community/bestdori/songs';
import { createCommunityTransport } from '../../../community/electronTransport';
import { isCommunityError, isJsonFromCache, type CommunityTransport } from '../../../community/transport';
import { DIFF_COLORS, DIFF_SHORT } from '../../../project/projectCatalog';
import { t } from '../../../i18n';
import CompactAudio from '../../../ui/CompactAudio';
import LoadingShimmer, { useSlowLoading } from '../../../ui/LoadingShimmer';
import { showToast } from '../../../ui/Toast';
import { communityErrorText } from '../communityImport';
import CommunityPostThumb from './CommunityPostThumb';
import { useCancelCacheProbe } from './useCancelCacheProbe';

/** 面板交给页面的东西：帖子 + （bandori 帖）选中的曲库候选与歌曲元数据 + 是否带谱面 */
export interface CommunityPostSelection {
  post: PostCandidate;
  song?: SongCandidate;
  detail?: OfficialSongDetail;
  withChart: boolean;
}

/** 服务端搜索的防抖（ms）：post/list 一次往返不便宜，别每敲一个字发一发 */
const SEARCH_DEBOUNCE_MS = 350;

/** 谱师展示名：昵称优先，两者都缺统一显示「谱师未填」（列表行与预览栏同一口径） */
function charterName(post: PostCandidate): string {
  return post.charter !== '' ? post.charter : t('projects.community.charterMissing');
}

const SLOW_AFTER_MS = 15_000;
const CANCEL_AFTER_MS = 2_000;

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
  /**
   * 谱师筛选（票 59）：平台只认**精确账号名**（昵称 / 前缀一律 `REQUEST_INVALID`），
   * 所以这一层存账号名（身份），`name` 只用来显示。两个入口 —— 预览栏点谱师名、搜索框输入账号名。
   */
  const [charterFilter, setCharterFilter] = useState<{ username: string; name: string } | null>(null);
  const charterUsername = charterFilter?.username ?? '';
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
  const firstAbortRef = useRef<AbortController | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const activeQueryRef = useRef(activeQuery);
  activeQueryRef.current = activeQuery;

  const waitingBlank = posts == null && loadError == null && net.kind !== 'none';
  const probePageCache = useCallback(
    () => loadPostPageFromCache(
      net,
      { query: activeQuery, offset: 0, username: charterUsername },
      { rememberInSession: false },
    ),
    [net, activeQuery, charterUsername],
  );
  const {
    waitSlow,
    cachedReady: diskCachedPage,
    clearCached: clearDiskCachedPage,
  } = useCancelCacheProbe(waitingBlank, probePageCache, {
    slowAfterMs: SLOW_AFTER_MS,
    cancelAfterMs: CANCEL_AFTER_MS,
  });

  /**
   * 账号名探测命中（票 59）：把这一趟切成「只看这位谱师」。首屏与刷新共用同一处判断，
   * 否则刷新会把这趟空结果铺出去、还报「加载成功」。
   */
  const adoptAuthorHit = useCallback((page: PostSearchPage): boolean => {
    if (page.authorHit == null) return false;
    setCharterFilter({ username: page.authorHit.username, name: page.authorHit.name });
    // 搜索框一并清空 —— 留着账号名会变成 `search=<账号名> AND username=<账号名>`，交集为空。
    // 探测那一发已经把同一页写进会话缓存，切换后的重载零请求、零白屏。
    setQuery('');
    setActiveQuery('');
    return true;
  }, []);

  const loadFirst = useCallback((q: string, who: string) => {
    if (net.kind === 'none') return;
    const isBrowsing = q === '' && who === '';
    const seq = ++loadSeq.current;
    const peeked = peekPostPage(q, 0, who);
    if (peeked) {
      setPosts(peeked.posts);
      setRawCount(peeked.rawCount);
      setEndReached(peeked.rawCount >= peeked.total || peeked.posts.length === 0);
      setLoadError(null);
      // 会话内已有这一页就秒出、不再发请求：真在飞的那一趟（只可能是用户点的刷新）
      // 由它自己的 .then 整段替换。放行 inflight 只会把会话缓存页原样取回，
      // 还可能误报一条「使用上次拉取结果」（那一页是上次回退时存进来的，带缓存标）。
      return;
    } else {
      setPosts(null);
      setRawCount(0);
      setEndReached(false);
      setLoadError(null);
    }
    const controller = new AbortController();
    firstAbortRef.current = controller;
    clearDiskCachedPage();
    setRetrying(false);
    setRefreshing(true);
    // 票 32：首屏走「两路」入口（纯数字查询时并发 id 直查）；票 59：账号名查询并发探测。
    // 深页（loadMore）只走服务端那一页
    void fetchPostSearchPage(net, { query: q, offset: 0, username: who, onRetry: () => setRetrying(true), signal: controller.signal })
      .then((page) => {
        if (seq !== loadSeq.current) return;
        if (adoptAuthorHit(page)) return;
        setPosts(page.posts);
        setRawCount(page.rawCount);
        setEndReached(page.rawCount >= page.total || page.posts.length === 0);
        setLoadError(null);
        if (isJsonFromCache(page)) showToast(t('projects.community.loadFailCache'), 'warn');
        // 首屏（浏览，查询词为空）拉取成功也给一颗：与失败那颗成对，success 档绿底。
        // 搜索成功不弹 —— 结果列表本身就是反馈，别每搜一次吵一声
        else if (isBrowsing) showToast(t('projects.community.loadOk'), 'success');
      })
      .catch((error: unknown) => {
        if (seq !== loadSeq.current) return;
        if (isCommunityError(error) && error.kind === 'aborted') return;
        const fallback = peekPostPage(q, 0, who);
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
        if (firstAbortRef.current === controller) firstAbortRef.current = null;
        if (seq !== loadSeq.current) return;
        setRetrying(false);
        setRefreshing(false);
      });
  }, [net, clearDiskCachedPage, adoptAuthorHit]);

  const loadCatalog = useCallback(() => {
    if (net.kind === 'none') return;
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    void fetchSongCatalog(net, undefined, undefined, controller.signal).then((songs) => {
      if (!controller.signal.aborted) setCatalog(songs);
    }).catch(() => {
      if (controller.signal.aborted) return;
      // 曲库失败不挡帖子列表（custom 帖不受影响）；bandori 帖的行退图标、选中退提示
      setCatalog(null);
    }).finally(() => {
      if (catalogAbortRef.current === controller) catalogAbortRef.current = null;
    });
  }, [net]);

  // 首屏：帖子第一页 + 曲库索引（并行；曲库是 bandori 帖的辅助数据，失败不挡主线）
  useEffect(() => {
    loadFirst(activeQuery, charterUsername);
    loadCatalog();
  }, [activeQuery, charterUsername, loadFirst, loadCatalog]);

  const cancelToCache = useCallback(() => {
    if (!diskCachedPage) return;
    loadSeq.current += 1;
    firstAbortRef.current?.abort();
    firstAbortRef.current = null;
    catalogAbortRef.current?.abort();
    catalogAbortRef.current = null;
    const committed = commitPostPageCache(
      { query: activeQueryRef.current, offset: 0, username: charterUsername },
      diskCachedPage,
    );
    setPosts(committed.posts);
    setRawCount(committed.rawCount);
    setEndReached(committed.rawCount >= committed.total || committed.posts.length === 0);
    setLoadError(null);
    setRefreshing(false);
    setRetrying(false);
    clearDiskCachedPage();
    const cachedSongs = peekSongCatalog();
    if (cachedSongs) setCatalog(cachedSongs);
    else void loadSongCatalogFromCache(net).then((c) => { if (c) setCatalog(c); });
    showToast(t('projects.community.cancelToCache'), 'warn');
  }, [diskCachedPage, clearDiskCachedPage, net, charterUsername]);

  const loadingRef = useRef(false);

  // 上拉加载：滚到底翻下一页。loadingRef 在同步段置位，重渲染也不会双发
  const loadMore = useCallback(() => {
    if (net.kind === 'none' || loadingRef.current) return;
    if (posts == null || endReached || loadError != null) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    void fetchPostPage(net, {
      query: activeQuery,
      offset: rawCount,
      username: charterUsername,
      onRetry: () => setRetrying(true),
    })
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
  }, [net, posts, endReached, loadError, activeQuery, rawCount, charterUsername]);

  // 用户主动刷新（票 09 反馈 #2 的出口）：丢掉会话内页缓存 + 让网关重拉第一页。
  // 失败**保留旧列表、不弹错**（"上次结果继续用" 的口径）；成功则整段换成新的一页。
  const refresh = useCallback(() => {
    if (net.kind === 'none' || refreshing) return;
    setRefreshing(true);
    // 票 32：刷新重问数字 id；票 44：不清页缓存，失败仍出示上一份
    clearPostIdLookupCache();
    void fetchPostSearchPage(net, {
      query: activeQuery,
      offset: 0,
      username: charterUsername,
      force: true,
      onRetry: () => setRetrying(true),
    })
      .then((page) => {
        if (adoptAuthorHit(page)) return;
        setPosts(page.posts);
        setRawCount(page.rawCount);
        setEndReached(page.rawCount >= page.total || page.posts.length === 0);
        setLoadError(null);
        setLoadMoreError(null);
        // 刷新撞上还在飞的首拉时会并进同一趟（票 44）：那一趟的结果可能是 freshFirst 的
        // 缓存回退 —— 那不是刷新成功，按「使用上次拉取结果」报，别谎报成功
        if (isJsonFromCache(page)) showToast(t('projects.community.loadFailCache'), 'warn');
        else showToast(t('projects.community.loadOk'), 'success');
      })
      .catch(() => {
        showToast(t('projects.community.refreshFail'), 'danger');
      })
      .finally(() => {
        setRefreshing(false);
        setRetrying(false);
      });
  }, [net, refreshing, activeQuery, charterUsername, adoptAuthorHit]);

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

  /**
   * 只看这位谱师（票 59 的可靠入口）：用作者**账号名**做服务端过滤。
   * 账号名缺失（`charterUsername === ''`）就不做 —— 昵称拼不进 `username`，猜一个只会白跑一趟。
   */
  const focusCharter = useCallback((post: PostCandidate) => {
    if (post.charterUsername === '') return;
    setCharterFilter({
      username: post.charterUsername,
      name: post.charter !== '' ? post.charter : post.charterUsername,
    });
  }, []);

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

  // 查询或谱师筛选变了 = 列表是另一份了：选中与预览一并撤（上层「创建」随之禁用）
  useEffect(() => {
    setSelected(null);
    setExpanded(false);
  }, [activeQuery, charterUsername]);

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

  /** 谱师筛选生效时，搜索框是「在这个人的作品里搜」——placeholder 跟着换，免得误以为还在全站搜 */
  const searchPlaceholder = charterFilter != null
    ? t('projects.community.searchWithin', { name: charterFilter.name })
    : t('projects.community.searchPlaceholder');

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
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          // 账号名是平台唯一认的谱师检索键（且只认完全一致），放 hover 提示里，不占 placeholder
          title={charterFilter == null ? t('projects.community.searchHint') : undefined}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* 谱师筛选（票 59）：平台只认精确账号名，筛选一旦生效就把「在看谁」摆在搜索框旁边，
            点 ✕ 回到全站浏览。关键字仍在时与账号名是 AND（平台实测交集语义）。 */}
        {charterFilter != null && (
          <span className="off-scope">
            <span
              className="off-scope__text"
              title={t('projects.community.charterFilterHint', { name: charterFilter.name })}
            >
              {t('projects.community.charterChip', { name: charterFilter.name })}
            </span>
            <button
              type="button"
              className="off-scope__x"
              aria-label={t('projects.community.charterClear')}
              onClick={() => setCharterFilter(null)}
            >
              <X size={12} />
            </button>
          </span>
        )}
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
          {diskCachedPage != null && (
            <button type="button" className="off-blank__cancel" onClick={cancelToCache}>
              {t('projects.cancel')}
            </button>
          )}
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
                  {/* 信息层级（票 60 Q4=A）：标题是歌名 → 歌手是这首歌的属性 → 谱师换维度、带标签。
                      两个「人」若同档同样式，读者只能靠顺序猜谁是谁 */}
                  <span className="off-preview__artist pp-muted">
                    {postArtist(selected, song) || t('projects.artistMissing')}
                  </span>
                  {selected.charterUsername !== '' ? (
                    <button
                      type="button"
                      className="off-preview__charter"
                      title={t('projects.community.charterFilterHint', {
                        name: selected.charter !== '' ? selected.charter : selected.charterUsername,
                      })}
                      onClick={() => focusCharter(selected)}
                    >
                      {t('projects.community.charterLine', { name: charterName(selected) })}
                      {/* 展示名是昵称，平台只认账号名（票 59）：两者不同时把可检索的那个摆出来，
                          否则「点名字能筛、把名字输进搜索框却搜不到」永远说不清 */}
                      {selected.charterUsername !== selected.charter && (
                        <span className="off-preview__handle">@{selected.charterUsername}</span>
                      )}
                    </button>
                  ) : (
                    <span className="off-preview__charter is-static">
                      {t('projects.community.charterLine', { name: charterName(selected) })}
                    </span>
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
              {filtered.map((post) => {
                const title = post.title !== '' ? post.title : t('projects.community.noTitle');
                const artist = postArtist(
                  post,
                  post.song.kind === 'bandori' ? catalogById.get(post.song.songId) : undefined,
                );
                const charter = charterName(post);
                const artistLabel = artist !== '' ? artist : t('projects.artistMissing');
                const date = formatPostDate(post.time);
                return (
                  <li key={post.postId} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={expanded && post.postId === selected?.postId}
                      className={`off-row off-row--post${expanded && post.postId === selected?.postId ? ' is-active' : ''}`}
                      onClick={() => (post.postId === selected?.postId
                        ? (expanded ? collapse() : setExpanded(true))
                        : pick(post))}
                    >
                      <CommunityPostThumb
                        post={post}
                        song={post.song.kind === 'bandori' ? catalogById.get(post.song.songId) : undefined}
                        transport={net}
                      />
                      {/* 票 60 Q2=A：三行（标题 / 歌手 / 谱师）各自单行截断，全文交给 title。
                          展开预览后文本列只有 ~358px，标题与「歌手 · 谱师」挤一行必折行、
                          行高随文案长短变；三行截断后行高与文案无关 */}
                      <span className="off-row__text">
                        <span className="off-row__title" title={title}>{title}</span>
                        <span className="off-row__artist" title={artistLabel}>{artistLabel}</span>
                        <span className="off-row__charter" title={charter}>
                          {t('projects.community.charterLine', { name: charter })}
                        </span>
                      </span>
                      {/* 右列拆两行（芯片 / #id · 日期）：芯片自己一行才让文本列从 282px 涨到 358px */}
                      <span className="off-row__aside">
                        <span className="off-row__levels">
                          <span style={{ borderColor: DIFF_COLORS[post.diff] }}>
                            {DIFF_SHORT[post.diff]}{post.level != null ? ` ${post.level}` : ''}
                          </span>
                        </span>
                        {/* 票 32：帖 id 常驻（不进 .off-row__levels —— 那条规则会给里面每个 span 套边框） */}
                        <span className="off-row__aside-meta">
                          <span className="off-row__id pp-muted" title={t('projects.community.idLabel')}>#{post.postId}</span>
                          {date !== '' && ` · ${date}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
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
