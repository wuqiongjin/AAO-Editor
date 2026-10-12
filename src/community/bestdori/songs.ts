/**
 * 官方曲库能力（票 08；issue 06 能力 1–5）：曲库索引 / 歌曲详情 / 官方谱面代码 / 官方音频 / 官方封面。
 *
 * 三条贯穿本文件的口径：
 *   - **只递 HTTP 事实**：收发全交给注入的 `CommunityTransport`（唯一实现是走 IPC 的那条，
 *     静态演示版 / 浏览器是 `kind: 'none'`）。退避重试只给这些**幂等读**用（rateLimit 的分工）。
 *   - **谱面代码取原文**：`requestText` 拿回原始 JSON 文本交给 Apply 闸门（`parseCodeText` 是全仓
 *     唯一的 JSON.parse 点，ADR-0014 的保真也靠原文：pristine 时导出直接发原文）。
 *   - **二进制只回缓存路径**：音频 / 封面由主进程落到 `<数据根>/cache/community/`（票 14 的素材缓存），
 *     这里只拿 `{ path }`（票 07 定案：字节不过 IPC）。平台对不存在的资源回 **200 + SPA 回退页**，
 *     落地前必须认出来。
 */
import { getActiveUiLanguage, type UiLanguage } from '../../i18n';
import { assetRawUrl, assetThumbUrl } from '../assetUrls';
import { withRetry, type RetryNotice } from '../rateLimit';
import { CommunityError, type CommunityTransport, type StagedBinary } from '../transport';
import {
  BESTDORI_BINARY_TIMEOUT_MS,
  BESTDORI_COVER_TIMEOUT_MS,
  BESTDORI_JSON_TIMEOUT_MS,
  BESTDORI_RETRY_POLICY,
  bandsIndexUrl,
  bestdoriHeaders,
  isPlatformFallbackPage,
  officialAudioUrl,
  officialChartUrl,
  officialJacketUrl,
  songDetailUrl,
  songsIndexUrl,
  type OfficialDifficulty,
} from './endpoints';
import {
  toSongCandidates,
  toSongDetail,
  type OfficialSongDetail,
  type SongCandidate,
} from './mapping';

function invalidResponse(message: string): CommunityError {
  return new CommunityError(message, { kind: 'invalid-response', message });
}

async function fetchJson(
  transport: CommunityTransport,
  url: string,
  onRetry?: (notice: RetryNotice) => void,
  revalidate = false,
  freshFirst = false,
): Promise<unknown> {
  return withRetry(
    () => transport.requestJson({
      url,
      method: 'GET',
      headers: bestdoriHeaders(),
      timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
      // 用户主动刷新（票 09 的刷新钮，官方 / 社区共用）：跳过网关的 24h 副本，真打一发
      ...(revalidate ? { revalidate: true } : {}),
      // 启动后首次访问穿透请求最新，失败自动回退磁盘缓存（票 29）
      ...(freshFirst ? { freshFirst: true } : {}),
    }),
    { policy: BESTDORI_RETRY_POLICY, onRetry },
  );
}

type CatalogCache = { language: UiLanguage; songs: SongCandidate[] };
let catalogCache: CatalogCache | null = null;
let catalogInflight: { language: UiLanguage; promise: Promise<SongCandidate[]> } | null = null;

/** 测试与语言切换：清掉进程内曲库缓存（票 13 #4） */
export function clearSongCatalogCache(): void {
  catalogCache = null;
  catalogInflight = null;
}

async function fetchStaged(
  transport: CommunityTransport,
  url: string,
  suggestedName: string,
  timeoutMs: number = BESTDORI_BINARY_TIMEOUT_MS,
): Promise<StagedBinary> {
  return withRetry(
    () => transport.requestBinary({
      url,
      method: 'GET',
      headers: bestdoriHeaders('*/*'),
      timeoutMs,
      suggestedName,
    }),
    { policy: BESTDORI_RETRY_POLICY },
  );
}

/**
 * 曲库**一次拉全**（822 首 / 约 400KB）+ 乐队索引，映射成中立曲目候选；
 * 搜索在本地做（见 `searchSongCandidates`），不再打网络。
 * 票 29：启动后首次访问使用 freshFirst 穿透请求最新，失败回退本地磁盘缓存；
 * 会话运行期间只要语言不切、不主动刷新，复用内存缓存 catalogCache。
 */
export async function fetchSongCatalog(
  transport: CommunityTransport,
  language: UiLanguage = getActiveUiLanguage(),
  onRetry?: (notice: RetryNotice) => void,
): Promise<SongCandidate[]> {
  if (catalogCache && catalogCache.language === language) return catalogCache.songs;
  if (catalogInflight && catalogInflight.language === language) return catalogInflight.promise;

  const promise = Promise.all([
    fetchJson(transport, songsIndexUrl(), onRetry, false, true),
    fetchJson(transport, bandsIndexUrl(), onRetry, false, true),
  ]).then(([index, bands]) => {
    const songs = toSongCandidates(index, bands, language);
    catalogCache = { language, songs };
    return songs;
  }).finally(() => {
    if (catalogInflight?.language === language) catalogInflight = null;
  });
  catalogInflight = { language, promise };
  return promise;
}

/**
 * 用户主动刷新曲库（官方 / 社区共用一颗钮）：先丢**会话内**的模块缓存（它在一个会话里不过期，
 * 不清就永远看不见新数据），再带 `revalidate` 让网关跳过 24h 副本真打一发 —— 网关的 SWR
 * 只管「后台补枪」，新数据要等会话重开才可见，用户主动刷新不该等。失败由调用方保留旧列表。
 */
export function refreshSongCatalog(
  transport: CommunityTransport,
  language: UiLanguage = getActiveUiLanguage(),
  onRetry?: (notice: RetryNotice) => void,
): Promise<SongCandidate[]> {
  clearSongCatalogCache();
  return Promise.all([
    fetchJson(transport, songsIndexUrl(), onRetry, true),
    fetchJson(transport, bandsIndexUrl(), onRetry, true),
  ]).then(([index, bands]) => {
    const songs = toSongCandidates(index, bands, language);
    catalogCache = { language, songs };
    return songs;
  });
}

/** 单曲详情（选中某首歌时才拉）：导入要的 `bgmId` 与官方曲长 */
export async function fetchSongDetail(
  transport: CommunityTransport,
  songId: number,
): Promise<OfficialSongDetail> {
  const raw = await fetchJson(transport, songDetailUrl(songId));
  const detail = toSongDetail(raw);
  if (!detail) throw invalidResponse(`单曲详情不是预期形态（song ${songId}）`);
  return detail;
}

/**
 * 官方谱面代码的**原文**（数组 JSON）。不在这里解析：整段文本交给 Apply 闸门
 * （`AddChartInput.codeText` 那条路），解析 / 校验 / 转 notes / 保真标记都在那里一处做。
 */
export async function fetchOfficialChartText(
  transport: CommunityTransport,
  songId: number,
  diff: OfficialDifficulty,
): Promise<string> {
  return withRetry(
    () => transport.requestText({
      url: officialChartUrl(songId, diff),
      method: 'GET',
      headers: bestdoriHeaders(),
      timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
    }),
    { policy: BESTDORI_RETRY_POLICY },
  );
}

/**
 * 落进缓存的字节对不对得上要的东西：
 * - 平台的 SPA 回退页（`text/html`）与别的类型 ⇒ 不是它；
 * - **拿不到 content-type 等于没信号，放行** —— 平台万一哪天不回这个头，拒绝它会让整条导入主线断掉，
 *   而回退页只要带了头就一定认得出来（实测 `text/html`）。
 */
function looksLikeMedia(contentType: string | null, media: 'audio' | 'image'): boolean {
  if (isPlatformFallbackPage(contentType)) return false;
  if (contentType == null) return true;
  if (media === 'image') return /^image\//i.test(contentType);
  return /^audio\//i.test(contentType) || /^application\/octet-stream/i.test(contentType);
}

/**
 * 官方音频 → 素材缓存（约 4MB 完整曲）。
 * 平台没有这首曲子的音频时回的是 SPA 回退页 —— 那是「截到一张网页」，不是音频，
 * 直接判成响应非法，别让 4MB 的坑位里躺着一张 HTML。
 */
export async function fetchOfficialAudio(
  transport: CommunityTransport,
  song: SongCandidate,
  detail: OfficialSongDetail,
): Promise<StagedBinary> {
  const staged = await fetchStaged(transport, officialAudioUrl(detail.bgmId, song.server), audioFileName(detail));
  if (!looksLikeMedia(staged.contentType, 'audio')) {
    throw invalidResponse(`官方音频取不到（拿到的不是音频）：song ${song.id} · ${staged.contentType ?? '无 content-type'}`);
  }
  return staged;
}

/**
 * 官方封面 → 素材缓存；平台没有这张图时回 **null**（= 这次导入不带封面）。
 * 不抛错：封面缺失不该挡住「工程 + 音频」这条主线（合作曲在非首发服就是这种情况）。
 * `timeoutMs` 只有「列表背景取图」那条路会改小（票 17），导入走默认的 120s。
 */
export async function fetchOfficialCover(
  transport: CommunityTransport,
  song: SongCandidate,
  timeoutMs: number = BESTDORI_BINARY_TIMEOUT_MS,
): Promise<StagedBinary | null> {
  const staged = await fetchStaged(transport, jacketPreviewUrl(song), coverFileName(song), timeoutMs);
  return looksLikeMedia(staged.contentType, 'image') ? staged : null;
}

/** 音频落进工程后记的名字（也是缓存文件名建议）：`bgm001.mp3` */
export function audioFileName(detail: OfficialSongDetail): string {
  return `${detail.bgmId}.mp3`;
}

/** 封面落进工程后记的名字：`yes_bang_dream.png`（没有封面名时退回曲号） */
export function coverFileName(song: SongCandidate): string {
  return `${song.jacketImage === '' ? `jacket-${song.id}` : song.jacketImage}.png`;
}

/* ---------------- 就地预览用的直链（不走网关） ----------------
 * 媒体标签（`<img>` / `<audio>`）的按需预览**不属**「渲染进程直连社区平台」的禁区：
 * 研究文档 §0 实测媒体标签不受 CORS 限制，ADR-0011 §2 的限定条款与 §4 的「外链官方音频/封面」
 * 是这条口径的来源。取数（导入 / 拉索引）仍一律走主进程网关。
 * ------------------------------------------------------------ */

/** 封面预览的**直链**（预览区本机 404 时的落点；也是封面进缓存的寻址 upstream） */
export function jacketPreviewUrl(song: SongCandidate): string {
  return officialJacketUrl(song.id, song.jacketImage, song.server);
}

/**
 * 行内缩略图的本机 URL（票 15）：读的是素材缓存里那张 96×96（原图进缓存时顺手产出的，见
 * `electron/assetThumbnails.cjs`）。**用之前得先把封面收进缓存**（`ensureOfficialCoverCached`），
 * 否则协议回 404、行内降级成图标。
 */
export function jacketThumbUrl(song: SongCandidate): string {
  return assetThumbUrl(jacketPreviewUrl(song));
}

/**
 * 预览区大图的本机 URL（票 16）：读缓存里那张原图（`aao-asset://raw/`，只认**已缓存**的）。
 * 已缓存 → 零网络秒出；未缓存 → 协议 404，预览区落回 `jacketPreviewUrl` 直链（体感同现状）。
 */
export function jacketLocalUrl(song: SongCandidate): string {
  return assetRawUrl(jacketPreviewUrl(song));
}

/** 同一首歌的「收封面进缓存」并发只发一次：行内缩略图在 StrictMode 下会跑两遍 effect */
const coverInflight = new Map<string, Promise<StagedBinary | null>>();

/**
 * 把封面收进素材缓存（票 15 行内缩略图 / 16 预览复用）：走网关的 cache-first —— 命中零网络，
 * 未命中下载 97KB 左右的整图并留在缓存里（原图给预览区大图，缩略图给列表）。
 * 平台没有这张图时回 null（合作曲在非首发服就是这种情况），不抛错。
 * 超时用封面那一档（30s，票 17）：这是**背景取图**，卡住的链路要尽快让出素材档的队位。
 */
export function ensureOfficialCoverCached(
  transport: CommunityTransport,
  song: SongCandidate,
): Promise<StagedBinary | null> {
  const url = jacketPreviewUrl(song);
  const inflight = coverInflight.get(url);
  if (inflight) return inflight;
  const promise = fetchOfficialCover(transport, song, BESTDORI_COVER_TIMEOUT_MS).finally(() => {
    if (coverInflight.get(url) === promise) coverInflight.delete(url);
  });
  coverInflight.set(url, promise);
  return promise;
}

/** 试听直链（`<audio src>` 的降级落点；Chromium 会按 Range 边下边播，不必先导入） */
export function audioPreviewUrl(song: SongCandidate, detail: OfficialSongDetail): string {
  return officialAudioUrl(detail.bgmId, song.server);
}

/**
 * 试听的本机 URL（票 16）：音频进缓存的唯一路径是**导入**（预览不替用户下 4MB，Q2 定案只收封面），
 * 所以这条只对导入过的歌命中 —— 命中后拖进度条读本地（协议含 Range）；未命中 404，落回直链。
 */
export function audioLocalUrl(song: SongCandidate, detail: OfficialSongDetail): string {
  return assetRawUrl(audioPreviewUrl(song, detail));
}

/** 就地搜索：命中标题或歌手（大小写不敏感；空查询 = 全部） */
export function searchSongCandidates(
  candidates: readonly SongCandidate[],
  query: string,
): SongCandidate[] {
  return filterSongCandidates(candidates, { query });
}

/** 选曲台筛选（票 13 #9）：本地、与搜索叠加。等级左右填反按数值 min/max，不硬夹。 */
export interface SongCatalogFilter {
  query?: string;
  /** 按乐队身份；null / 省略 = 全部 */
  bandId?: number | null;
  /** 必须已实装该难度；省略 = 不限 */
  difficulty?: OfficialDifficulty | null;
  levelMin?: number;
  levelMax?: number;
}

/** 筛选条默认等级窗；填了别的才算「等级筛选生效」（摘要 / 清除点） */
export const SONG_LEVEL_FILTER_DEFAULT = { min: 1, max: 35 } as const;

export function filterSongCandidates(
  candidates: readonly SongCandidate[],
  filter: SongCatalogFilter,
): SongCandidate[] {
  const needle = (filter.query ?? '').trim().toLowerCase();
  const hasLo = typeof filter.levelMin === 'number' && Number.isFinite(filter.levelMin);
  const hasHi = typeof filter.levelMax === 'number' && Number.isFinite(filter.levelMax);
  const lo = hasLo || hasHi
    ? Math.min(filter.levelMin ?? filter.levelMax as number, filter.levelMax ?? filter.levelMin as number)
    : null;
  const hi = lo == null
    ? null
    : Math.max(filter.levelMin ?? filter.levelMax as number, filter.levelMax ?? filter.levelMin as number);
  const needDiff = filter.difficulty ?? null;
  const bandId = filter.bandId ?? null;
  return candidates.filter((song) => {
    if (needle !== '' && !song.title.toLowerCase().includes(needle) && !song.artist.toLowerCase().includes(needle)) {
      return false;
    }
    if (bandId != null && song.bandId !== bandId) return false;
    const pool = needDiff ? song.difficulties.filter((entry) => entry.diff === needDiff) : song.difficulties;
    if (needDiff && pool.length === 0) return false;
    if (lo != null && hi != null && !pool.some((entry) => entry.level >= lo && entry.level <= hi)) return false;
    return true;
  });
}

/** 筛选下拉里的乐队：按 bandId 去重，显示名取候选上已映射的 artist */
export function catalogBandOptions(songs: readonly SongCandidate[]): { id: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const song of songs) {
    if (song.bandId == null || seen.has(song.bandId)) continue;
    seen.set(song.bandId, song.artist);
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
