/**
 * 领域映射（issue 06 能力 16 的官方曲部分，票 08）：社区平台形状 → 中立领域对象。
 *
 * 为什么要有这一层：曲库条目的字段名（`musicTitle` / `jacketImage` / `difficulty["3"].playLevel`）
 * 是平台实现细节，界面上一个都不该出现。界面只认 `SongCandidate`，将来换平台（CONTEXT「社区平台」
 * 说当前只有 Bestdori）只需再写一份映射，界面不动。
 *
 * 映射里的三条**实测口径**（2026-10-09，见 docs/research/bestdori-api.md §1 与 §6）：
 *   1. 本地化数组的服序是 [jp, en, tw, cn, kr] —— 即 **index 3 才是简中**、index 2 是繁中
 *      （研究文档 §1 原来写的 [ja, en, zh-Hans, zh-Hant, ko] 与实盘数据不符，已回写）。
 *   2. 曲库条目与单曲详情**都没有 artist 字段**：官方歌手只能取乐队索引的 `bandName`。
 *   3. `difficulty` 里**出现的键即已实装难度**：没出现的不产出条目（Special 常常没有）。
 */
import type { UiLanguage } from '../../i18n/resolveUiLanguage';
import {
  DEFAULT_ASSET_SERVER,
  OFFICIAL_ASSET_SERVERS,
  OFFICIAL_DIFFICULTIES,
  type OfficialAssetServer,
  type OfficialDifficulty,
} from './endpoints';

/**
 * 本地化字段的取值序（按服）：第一个非空值胜出。
 * zh-CN 走简中（index 3），取不到再退繁中 → 日文原名 → 英文；en 走英文 → 日文原名。
 */
const LOCALE_INDEX: Record<UiLanguage, readonly number[]> = {
  'zh-CN': [3, 2, 0, 1, 4],
  en: [1, 0, 2, 3, 4],
};

/** 一个已实装的难度的等级（未实装的难度**不产出条目**） */
export interface SongDifficultyCandidate {
  diff: OfficialDifficulty;
  /** 官方等级（`playLevel`），导入时「勾了谱面内容」才跟着带上 */
  level: number;
}

/**
 * 中立「曲目候选」：选曲界面与导入流程只认这一份，不再回看平台形状。
 * `jacketImage` / `server` 是**素材指针**（拼封面与音频 URL 用，见 endpoints）：中立指的是
 * 「界面不解析平台字段」，不是「界面不知道素材在哪」。
 */
export interface SongCandidate {
  id: number;
  /** 乐队身份（筛选用）；曲库条目没有合法 bandId 时为 null */
  bandId: number | null;
  /** 曲库标题（当前界面语言；全部语言都空则不产出候选） */
  title: string;
  /** 官方歌手 = 乐队名；乐队索引里查不到时为空串（界面按「未填歌手」处理） */
  artist: string;
  /** 封面名（封面 URL 的组成部分） */
  jacketImage: string;
  /** 素材服务器：合作曲只在首发服有素材，见 endpoints.OFFICIAL_ASSET_SERVERS */
  server: OfficialAssetServer;
  /** 已实装难度，按 0..4 序 */
  difficulties: SongDifficultyCandidate[];
}

/** 这首歌某个难度的官方等级；没实装就是 null（界面按「未实装」显示） */
export function songLevel(song: SongCandidate, diff: OfficialDifficulty): number | null {
  return song.difficulties.find((entry) => entry.diff === diff)?.level ?? null;
}

/**
 * 这首歌里能选的难度：当前难度不可用时退 Expert，再退到最高的那一张。
 * 「选曲面板的默认难度」与「换歌后要落到哪个难度」共用这一处判断。
 */
export function resolveSongDiff(song: SongCandidate, current: OfficialDifficulty): OfficialDifficulty {
  const available = song.difficulties.map((entry) => entry.diff);
  if (available.includes(current)) return current;
  if (available.includes('expert')) return 'expert';
  return available[available.length - 1] ?? 'expert';
}

/** 单曲详情里导入要用的两样（其余字段不映射：用不到就不搬） */
export interface OfficialSongDetail {
  /** 音频文件名主干（如 `bgm001`）—— 音频 URL 由它拼，工程音频名也用它的 `.mp3` */
  bgmId: string;
  /** 官方曲长（秒）—— 工程时长的初始值（写进工程后由音频实际时长校正） */
  lengthSeconds: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** 本地化数组取当前语言的值（空串 / null 都算没有，按 LOCALE_INDEX 依次退） */
export function localizedField(raw: unknown, language: UiLanguage): string {
  if (!Array.isArray(raw)) return '';
  for (const index of LOCALE_INDEX[language]) {
    const value = raw[index];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
}

/**
 * 素材服务器：按发布记录挑（`publishedAt` 非空即该服有这首曲子）。
 * 全都没发布（未知 / 未上线）时回默认服 —— 素材大概率取不到，由调用方按回退页降级。
 */
export function pickAssetServer(publishedAt: unknown): OfficialAssetServer {
  if (!Array.isArray(publishedAt)) return DEFAULT_ASSET_SERVER;
  for (let index = 0; index < OFFICIAL_ASSET_SERVERS.length; index += 1) {
    const at = publishedAt[index];
    if (typeof at === 'number' && at > 0) return OFFICIAL_ASSET_SERVERS[index];
    if (typeof at === 'string' && at.trim() !== '' && at.trim() !== '0') return OFFICIAL_ASSET_SERVERS[index];
  }
  return DEFAULT_ASSET_SERVER;
}

/** `difficulty` 映射：出现的键即已实装；`playLevel` 不是有限数的那条也不产出 */
export function toSongDifficulties(raw: unknown): SongDifficultyCandidate[] {
  if (!isPlainObject(raw)) return [];
  const out: SongDifficultyCandidate[] = [];
  OFFICIAL_DIFFICULTIES.forEach((diff, index) => {
    const node = raw[String(index)];
    if (!isPlainObject(node)) return;
    const level = node.playLevel;
    if (typeof level !== 'number' || !Number.isFinite(level)) return;
    out.push({ diff, level });
  });
  return out;
}

function toBandId(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function toBandName(bands: unknown, bandId: unknown, language: UiLanguage): string {
  if (!isPlainObject(bands)) return '';
  const band = bands[String(bandId)];
  if (!isPlainObject(band)) return '';
  return localizedField(band.bandName, language);
}

/**
 * 曲库条目 → 曲目候选。取不到任何语言的标题时返回 null（没有可显示的东西，
 * 不产出比产出「曲 123」诚实）。
 */
export function toSongCandidate(
  id: number,
  entry: unknown,
  bands: unknown,
  language: UiLanguage,
): SongCandidate | null {
  if (!isPlainObject(entry)) return null;
  const title = localizedField(entry.musicTitle, language);
  if (title === '') return null;
  const jacket = Array.isArray(entry.jacketImage) ? entry.jacketImage : [];
  const jacketImage = jacket.find((name): name is string => typeof name === 'string' && name.trim() !== '') ?? '';
  return {
    id,
    bandId: toBandId(entry.bandId),
    title,
    artist: toBandName(bands, entry.bandId, language),
    jacketImage,
    server: pickAssetServer(entry.publishedAt),
    difficulties: toSongDifficulties(entry.difficulty),
  };
}

/** 全量曲库索引 → 曲目候选（按 id 升序；坏条目跳过） */
export function toSongCandidates(index: unknown, bands: unknown, language: UiLanguage): SongCandidate[] {
  if (!isPlainObject(index)) return [];
  const ids = Object.keys(index)
    .map((key) => Number(key))
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);
  const out: SongCandidate[] = [];
  for (const id of ids) {
    const candidate = toSongCandidate(id, index[String(id)], bands, language);
    if (candidate) out.push(candidate);
  }
  return out;
}

/** 单曲详情 → 导入要用的两样；形态不对返回 null（调用方翻成统一错误域） */
export function toSongDetail(raw: unknown): OfficialSongDetail | null {
  if (!isPlainObject(raw)) return null;
  const bgmId = typeof raw.bgmId === 'string' ? raw.bgmId.trim() : '';
  const length = raw.length;
  if (bgmId === '' || typeof length !== 'number' || !Number.isFinite(length) || length <= 0) return null;
  return { bgmId, lengthSeconds: length };
}

/* ---------------- 社区帖（票 09：post/list · post/details 的映射部分） ----------------
 * 帖子形状依据 docs/research/bestdori-api.md §2（2026-09 实测）：
 *   - `song` 三种形态：custom（帖内音频+封面直链）/ bandori / llsif（按曲库 id 引用）；
 *   - 等级 / 难度没有服务端过滤字段（§2.2），`diff` 0..4、`level` 可缺。
 * 口径（2026-10-12 拍板）：**llsif 帖不产出候选** —— 音频 / 封面在网关白名单之外
 * （card.niconi.co.ni，未实测），摆一条永远导不进来的条目不诚实；素材域实测后再放开。
 * ----------------------------------------------------------------------------- */

export type PostSongKind = 'custom' | 'bandori';

export type PostSongRef =
  | { kind: 'custom'; /** 帖内音频直链（站内上传文件地址，域名不出端点文件） */ audioUrl: string; /** 帖内封面直链；帖子没给时为 null */ coverUrl: string | null }
  | { kind: 'bandori'; /** 官方曲库 id（素材与歌曲元数据都从曲库那条路走，见 songs.ts） */ songId: number };

/**
 * 中立「帖子候选」：社区谱列表 / 导入只认这一份。字段即帖子自带的事实，
 * 不掺任何「我们打算怎么用」——原帖标题与谱师**只进导入会话**，落不落工程由编排层定（票 09）。
 */
export interface PostCandidate {
  postId: number;
  /** 原帖标题；帖子没填为空串（界面按「无标题」处理） */
  title: string;
  /** 谱师展示名（nickname 优先，退 username）；两者都缺为空串 */
  charter: string;
  /** 帖子自报的歌曲 artists（自填文本，与曲库歌手无关） */
  artists: string;
  /** 谱面难度 0..4（与工程难度同值） */
  diff: number;
  /** 谱师自报等级；帖子没给为 null */
  level: number | null;
  /** 发布时间（ms）；取不到为 null */
  time: number | null;
  song: PostSongRef;
}

function toCharter(raw: unknown): string {
  if (!isPlainObject(raw)) return '';
  const nickname = typeof raw.nickname === 'string' ? raw.nickname.trim() : '';
  if (nickname !== '') return nickname;
  const username = typeof raw.username === 'string' ? raw.username.trim() : '';
  return username;
}

function toPostSong(raw: unknown): PostSongRef | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type === 'custom') {
    const audioUrl = typeof raw.audio === 'string' ? raw.audio.trim() : '';
    if (audioUrl === '') return null;
    const coverUrl = typeof raw.cover === 'string' && raw.cover.trim() !== '' ? raw.cover.trim() : null;
    return { kind: 'custom', audioUrl, coverUrl };
  }
  if (raw.type === 'bandori') {
    const songId = raw.id;
    if (typeof songId !== 'number' || !Number.isFinite(songId)) return null;
    return { kind: 'bandori', songId };
  }
  // llsif（与未知形态）：素材域在网关白名单之外，2026-10-12 拍板不产出候选
  return null;
}

/** 一条帖子 → 候选。缺 id / song / diff（或 song 是 llsif）都不产出。 */
export function toPostCandidate(raw: unknown, fallbackId?: number): PostCandidate | null {
  if (!isPlainObject(raw)) return null;
  const rawId = raw.id;
  const postId = typeof rawId === 'number' && Number.isFinite(rawId)
    ? rawId
    : (typeof fallbackId === 'number' && Number.isFinite(fallbackId) ? fallbackId : null);
  if (postId == null) return null;
  const song = toPostSong(raw.song);
  if (!song) return null;
  const diff = raw.diff;
  if (typeof diff !== 'number' || !Number.isFinite(diff) || diff < 0 || diff > 4) return null;
  const level = typeof raw.level === 'number' && Number.isFinite(raw.level) ? raw.level : null;
  const time = typeof raw.time === 'number' && Number.isFinite(raw.time) ? raw.time : null;
  return {
    postId,
    title: typeof raw.title === 'string' ? raw.title : '',
    charter: toCharter(raw.author),
    artists: typeof raw.artists === 'string' ? raw.artists : '',
    diff: Math.trunc(diff),
    level,
    time,
    song,
  };
}

/**
 * 列表响应 → 一页候选。total 是平台侧的过滤后总数（分页终点用它判断，§2.1 实测）；
 * `rawCount` 是这一页的**原始条数**（含被丢弃的 llsif / 坏条目）—— 翻页的 offset 游标
 * 必须按它走：候选被映射层丢了几条，服务端序列并不因此缩短。
 */
export function toPostPage(raw: unknown): { total: number; rawCount: number; posts: PostCandidate[] } | null {
  if (!isPlainObject(raw) || raw.result !== true) return null;
  if (!Array.isArray(raw.posts)) return null;
  const posts: PostCandidate[] = [];
  for (const entry of raw.posts) {
    const candidate = toPostCandidate(entry);
    if (candidate) posts.push(candidate);
  }
  const total = typeof raw.count === 'number' && Number.isFinite(raw.count) ? raw.count : posts.length;
  return { total, rawCount: raw.posts.length, posts };
}

/**
 * 帖子详情 → 候选 + 谱面代码原文（`chart` 数组是完整谱面，交给 Apply 闸门，票 09）。
 * 平台事实（票 27 实测）：`post/details` 的 `post` 对象不包含 `id`，必须由调用方传入 `fallbackId`（即请求 URL 中的 postId）。
 */
export function toPostDetail(raw: unknown, fallbackId?: number): { post: PostCandidate; chartCodeText: string } | null {
  if (!isPlainObject(raw) || raw.result !== true) return null;
  if (!isPlainObject(raw.post)) return null;
  if (!Array.isArray(raw.post.chart)) return null;
  const post = toPostCandidate(raw.post, fallbackId);
  if (!post) return null;
  return { post, chartCodeText: JSON.stringify(raw.post.chart) };
}
