/**
 * 发布能力（票 11；issue 06 能力 11–13）：三步二进制上传 + 发帖。
 *
 * 口径（issue 06 Q13 定案 + docs/research/bestdori-community-upload.md §3–5 实测）：
 *   - **上传 / 发布二分**：上传 = 发字节（音频 / 封面），产物按内容寻址（SHA-1），
 *     已存在即 `ALREADY_UPLOADED` 直接复用；发布 = 发帖（`POST /api/post`），产生帖子 id。
 *     谱面代码**不走文件上传** —— 它以内联 `chart` 数组进发帖 body（官网前端同形态）。
 *   - **静默 sanitize**：待发布的谱面先过 `sanitizeChartForBestdoriUpload`（剥 System /
 *     charge），不弹「谱面不合法」（issue 156 定案）—— 官方谱原样 POST 会 POST_INVALID。
 *   - **必填预检**：发帖前按字段点名缺什么（CONTEXT「工程信息」：缺的字段上传时再拦）。
 *   - **谱面域预检（issue 49）**：平台不收的域外值（Directional width ∉ 1..3 等）在
 *     **任何网络之前**拦下（custom 渠道连音频都不传），`chart-invalid` 档点名到音符；
 *     规则清单住 `chart/editing/ChartDomainRules.ts`（进清单判据：实测或在野证据）。
 *   - **写路径不套退避**（07 口径）：prepare / upload / post 三个 POST 超时都可能
 *     「服务端已经收了」，重发只会多造一份上传 / 多发一帖；轮询 status 是幂等读，照常退避。
 *   - **每张谱面至多一条上传记录**（ADR-0015 §4）：`input.published` 为真时任何网络都不发。
 *
 * 记录写入不在本模块：`src/community` 零 `src/project` 依赖（锁测见
 * tests/static/PublishDialogShell 的分层断言），「发布成功后写 upload 记录」
 * 经注入的 `writeUploadRecord` 接缝由页面侧用 mutateProject 装配。
 */
import type { ChartCodeNote, ValidationError } from '../../chart/editing/ChartConverter';
import { checkChartDomainRules } from '../../chart/editing/ChartDomainRules';
import { sanitizeChartForBestdoriUpload } from './sanitizeChart';
import {
  BESTDORI_BINARY_TIMEOUT_MS,
  BESTDORI_JSON_TIMEOUT_MS,
  BESTDORI_RETRY_POLICY,
  BESTDORI_UPLOAD_VER,
  POST_CONTENT_MAX_CHARS,
  POST_LEVEL_MAX,
  POST_LEVEL_MIN,
  bestdoriHeaders,
  postCreateUrl,
  postEditUrl,
  uploadPrepareUrl,
  uploadStatusUrl,
  uploadUrl,
  uploadedFileUrl,
} from './endpoints';
import { withRetry } from '../rateLimit';
import { trail } from '../../diagnostics/trail';
import { invalidResponse, isCommunityError, type CommunityTransport } from '../transport';
import { t } from '../../i18n';

/** multipart 上传的表单字段名（平台固定 `file`，见 bestdori-api.md §4） */
export const UPLOAD_FILE_FIELD = 'file';

/** 平台「这份字节已经上传过」的业务码（内容寻址的复用信号，不是错误） */
const ALREADY_UPLOADED_CODE = 'ALREADY_UPLOADED';

/** 上传状态轮询：间隔与次数（wrapper 口径「最多重试 5 次」的放宽版；未就绪就明说，不静默成功） */
const UPLOAD_STATUS_ATTEMPTS = 10;
const UPLOAD_STATUS_INTERVAL_MS = 1000;

/** 一个待上传文件的引用（页面从 projectStore.uploadRefs 拿；字节不过 IPC） */
export interface PublishUploadFile {
  /** 主进程侧的文件路径（multipart 由网关读它） */
  path: string;
  /** 递给平台的文件名（工程里的音频名 / 封面名） */
  fileName: string;
  /** 字节数（prepare 的 `size`） */
  size: number;
  /** SHA-1（prepare 的 `hash`；内容寻址的键） */
  hash: string;
}

/** 发帖的 `song` 字段：bandori 只传曲库 id；custom 要先上传音频（必需）与封面（可选） */
export type PublishSong =
  | { kind: 'bandori'; songId: number }
  // audio 为 null = 工程没有音频（预检点名「缺音频」；发布时它已在，不会是 null）
  | { kind: 'custom'; audio: PublishUploadFile | null; cover: PublishUploadFile | null };

/** 发布入参（页面把工程 / 谱面 / 用户填的描述翻成这一份中立形状） */
export interface PublishInput {
  /** 这张谱面已发布过（页面按 `chart.upload` 传）——为真时直接拒，一张谱面至多一条上传记录 */
  published: boolean;
  /** 帖子标题 = 谱面名称（未填时动态跟随工程名称，页面已解析好；空 = 缺） */
  title: string;
  /** 歌手（工程信息；空 = 缺，站点不替你填曲库艺人名） */
  artists: string;
  /** 难度 0..4（工程谱面的 diff） */
  diff: number;
  /** 等级（谱面信息；缺或越界 = 缺） */
  level: number | null;
  /** 描述正文（帖子 content；空或超长 = 缺） */
  content: string;
  /** 谱面代码（页面用编辑器的导出转换 `convertNotesToChartCode` 备好；发布前静默 sanitize） */
  chartCode: readonly ChartCodeNote[];
  song: PublishSong;
  /** 社区帖标签（票 51）；缺省 = `[]` */
  tags?: readonly PostTextTag[];
}

/** 发帖 / 改帖标签元素（与平台 `{type:"text", data}` 同形） */
export interface PostTextTag {
  type: 'text';
  data: string;
}

/** 必填预检能点名出的字段（界面按它取文案，一档一条 hint） */
export type PublishMissingField =
  | 'title' | 'artists' | 'song' | 'diff' | 'level' | 'content' | 'chart' | 'audio';

export interface PublishPrecheck {
  ok: boolean;
  missing: PublishMissingField[];
  /**
   * 谱面域规则点名（issue 49）：平台不收的值（Directional width ∉ 1..3 等），逐条带定位。
   * 与 missing / ok **分道**——弹窗的「发布」按钮不因它禁用（用户口径：点发布时报错硬拦），
   * `publishChart` 在**任何网络之前**（custom 含上传音频）据此立 `chart-invalid`。
   */
  chartIssues: ValidationError[];
}

/**
 * 必填预检 + 谱面域预检（纯函数；弹窗与能力层共用同一份，别在两边各写一套）。
 * `missing` 的顺序即票面字段表：title / artists / song / diff / level / chart / content；
 * `chartIssues` 是另一条道（issue 49）：平台值域规则点名（width ∉ 1..3 等），不并入
 * `ok` / `missing` —— 缺字段由弹窗就地标红、按钮禁用，而域外值按用户口径走
 * 「点发布时报错硬拦」，由 `publishChart` 立 `chart-invalid`。
 * `song` / `diff` 查的是**取值合法性**而不是「用户填没填」——bandori 的曲库 id 与
 * 谱面 diff 都是工程记录里的既有值（前者来自官方导入时的曲库选中），平台对越界值
 * 一概 `POST_INVALID`，与坏谱面分不开（bestdori-community-upload.md §3.2：曲 id
 * 发帖时不校验）。所以在这里先拦：id 必须是正整数，diff 必须落在 0..4。
 */
export function precheckPublish(input: PublishInput): PublishPrecheck {
  const missing: PublishMissingField[] = [];
  if (input.title.trim() === '') missing.push('title');
  if (input.artists.trim() === '') missing.push('artists');
  if (input.song.kind === 'custom') {
    if (input.song.audio == null) missing.push('audio');
  } else if (!Number.isInteger(input.song.songId) || input.song.songId <= 0) {
    missing.push('song');
  }
  if (!Number.isInteger(input.diff) || input.diff < 0 || input.diff > 4) missing.push('diff');
  if (
    input.level == null
    || !Number.isInteger(input.level)
    || input.level < POST_LEVEL_MIN
    || input.level > POST_LEVEL_MAX
  ) {
    missing.push('level');
  }
  const content = input.content.trim();
  if (content === '' || content.length > POST_CONTENT_MAX_CHARS) missing.push('content');
  // 谱面：先按上传口径静默清洗，再问「还有没有东西可发」—— 全是 System 的谱面
  // 洗出来就是空数组，那和没谱面一样发不出去（平台 CHART_INVALID）。
  const chart = sanitizeChartForBestdoriUpload(input.chartCode);
  if (chart.length === 0) missing.push('chart');
  // 谱面域规则（issue 49）：对**原始**谱面代码过「平台收什么」清单——sanitize 只丢
  // System / 未知 type、不碰 Directional，点名结果与清洗后等价，但序号落在用户谱面
  // 代码的真实坐标上（对清洗后数组算会因 System 前移而错位，也与代码弹窗的警告不同坐标）。
  // 域外值在这里点名、不发请求；规则只此一份（ChartDomainRules）。
  const chartIssues = checkChartDomainRules(input.chartCode);
  return { ok: missing.length === 0, missing, chartIssues };
}

/** 发布阶段（弹窗据此出提示文案；网关没有字节级进度，票 07 定案） */
export type PublishStage = 'audio' | 'cover' | 'post' | 'record';

/** 发布失败的立档（界面按它取 i18n，一档一句；平台码不上界面） */
export type PublishFailure =
  /** 必填预检没过（missing 里点名缺什么） */
  | 'missing-fields'
  /** 这张谱面已经发布过（重复调用被拒；任何网络都没发） */
  | 'already-published'
  /** 连不上 / 超时 */
  | 'offline'
  /** 平台限流 */
  | 'rate-limited'
  /** 会话失效（发布中途被平台踢掉） */
  | 'unauthorized'
  /** 运行环境不提供这个能力（静态演示版 / 通道坏了） */
  | 'unsupported'
  /** 平台拒了这次发布（POST_INVALID 等业务码 / 形态不对 / 5xx） */
  | 'rejected'
  /** 谱面含平台不收的值（issue 49；内部预检拦下，`chartIssues` 点名到音符，未发任何网络） */
  | 'chart-invalid'
  /** 本机问题：上传文件读不到 / 暂存写不进去（平台侧没问题） */
  | 'local'
  /** 其余 */
  | 'unknown';

export type PublishOutcome =
  | { ok: true; postId: number; /** 上传记录写没写进去（false = 帖子已在，本机记账失败） */ recordWritten: boolean }
  | { ok: false; failure: PublishFailure; missing?: PublishMissingField[]; chartIssues?: ValidationError[] };

export interface PublishDeps {
  transport: CommunityTransport;
  /**
   * 发布成功后的上传记录写入（页面用 mutateProject + recordChartUpload 装配）。
   * 回 false = 没写进去（已被拒 / 谱面没了）—— 帖子已经在平台上，结果仍是 ok。
   */
  writeUploadRecord: (record: { postId: number; at: number }) => Promise<boolean>;
  now?: () => number;
  /** 上传状态轮询的等待（测试注入假时钟） */
  sleep?: (ms: number) => Promise<void>;
  /** 阶段回报（弹窗的「正在上传音频…」那一行） */
  onStage?: (stage: PublishStage) => void;
}

/** 统一错误域 → 发布失败立档（界面只认这个，不认平台码） */
export function publishFailureOf(error: unknown): PublishFailure {
  if (!isCommunityError(error)) return 'unknown';
  switch (error.kind) {
    case 'offline':
    case 'timeout':
      return 'offline';
    case 'rate-limited':
      return 'rate-limited';
    case 'unauthorized':
      return 'unauthorized';
    case 'unsupported-runtime':
      return 'unsupported';
    case 'request-rejected':
    case 'staging-failed':
      return 'local';
    default:
      // invalid-response（业务码 / 形态不对）与 http（4xx / 5xx）：平台这边没成
      return 'rejected';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** `ALREADY_UPLOADED`：平台上已有这份字节（内容寻址的复用信号）—— 跳过上传与轮询 */
function isAlreadyUploaded(error: unknown): boolean {
  return isCommunityError(error) && error.platformCode === ALREADY_UPLOADED_CODE;
}

/** 上传响应 `{hash}`：取不到就用 prepare 那个（内容寻址，两边同值） */
function uploadedHashOf(raw: unknown, fallback: string): string {
  if (isPlainObject(raw) && typeof raw.hash === 'string' && raw.hash !== '') return raw.hash;
  return fallback;
}

/**
 * 三步二进制上传（票 11）：`prepare` → multipart `upload` → 轮询 `status`，回引用地址。
 * 遇 `ALREADY_UPLOADED` 直接回地址（第二步、第三步都不发生）。
 *
 * 三个 POST / GET 的分工：prepare 与 upload 是**写**（不套退避，超时可能已收），
 * status 轮询是**幂等读**（照常退避；未就绪只是还没好，不是错误）。
 */
async function uploadBinaryFile(
  transport: CommunityTransport,
  file: PublishUploadFile,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  try {
    await transport.requestJson({
      url: uploadPrepareUrl(),
      method: 'POST',
      headers: { ...bestdoriHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ ver: BESTDORI_UPLOAD_VER, hash: file.hash, size: file.size }),
      timeoutMs: BESTDORI_BINARY_TIMEOUT_MS,
    });
  } catch (error) {
    if (!isAlreadyUploaded(error)) throw error;
    return uploadedFileUrl(file.hash);
  }

  const uploaded = await transport.requestJson({
    url: uploadUrl(),
    method: 'POST',
    headers: bestdoriHeaders(),
    // 字节不过 IPC：渲染侧只递路径，主进程读文件拼 multipart（见 communityNet.cjs）
    multipart: { field: UPLOAD_FILE_FIELD, filePath: file.path, fileName: file.fileName },
    timeoutMs: BESTDORI_BINARY_TIMEOUT_MS,
  });
  const hash = uploadedHashOf(uploaded, file.hash);

  for (let attempt = 0; attempt < UPLOAD_STATUS_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(UPLOAD_STATUS_INTERVAL_MS);
    const status = await withRetry(
      () => transport.requestJson({
        url: uploadStatusUrl(hash),
        method: 'GET',
        headers: bestdoriHeaders(),
        timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
      }),
      { policy: BESTDORI_RETRY_POLICY },
    );
    // 就绪 = `{"status":"available"}`；别的值（处理中）继续等，次数用完明说
    if (isPlainObject(status) && status.status === 'available') {
      return uploadedFileUrl(hash);
    }
  }
  throw invalidResponse(`上传状态迟迟未就绪（${hash}）`);
}

/** 发帖 body 里的 `song`（官网前端同形：custom 带上传后的 URL，bandori 只带曲库 id） */
type PostSongBody =
  | { type: 'custom'; audio: string; cover?: string }
  | { type: 'bandori'; id: number };

export type PostContentBlock =
  | { type: 'text'; data: string }
  | { type: 'br' };

/**
 * 正文富文本块格式化（票 42 Q4）：纯文本 + 换行拆成 text 与 br 块。
 */
export function formatPostContent(raw: string): PostContentBlock[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  const blocks: PostContentBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) {
      blocks.push({ type: 'br' });
    }
    const line = lines[i];
    if (line.length > 0) {
      blocks.push({ type: 'text', data: line });
    }
  }
  return blocks;
}

/** 票 52：描述自动生成的事实。缺项跳过，不编歌词 / 玩法。 */
export interface PublishDescriptionFacts {
  title?: string | null;
  diffName?: string | null;
  level?: number | null;
  noteCount?: number | null;
  duration?: string | null;
  charter?: string | null;
}

function factLine(label: string, value: string): string {
  return `${label}：${value}`;
}

export function generatePublishDescription(facts: PublishDescriptionFacts): string {
  const lines: string[] = [];
  const title = facts.title?.trim();
  if (title) lines.push(factLine(t('projects.publish.field.title'), title));
  const diffName = facts.diffName?.trim();
  if (diffName || facts.level != null) {
    const value = [diffName, facts.level != null ? String(facts.level) : null].filter(Boolean).join(' ');
    lines.push(factLine(t('projects.publish.field.diff'), value));
  }
  if (facts.noteCount != null && facts.noteCount > 0) {
    lines.push(factLine(t('projects.publish.field.chart'), String(facts.noteCount)));
  }
  const duration = facts.duration?.trim();
  if (duration) lines.push(factLine(t('projects.publish.field.duration'), duration));
  const charter = facts.charter?.trim();
  if (charter) lines.push(factLine(t('projects.publish.field.charter'), charter));
  return lines.join('\n');
}

function normalizePostTags(tags: readonly PostTextTag[] | undefined): PostTextTag[] {
  const seen = new Set<string>();
  const out: PostTextTag[] = [];
  for (const tag of tags ?? []) {
    if (tag?.type !== 'text' || typeof tag.data !== 'string') continue;
    const data = tag.data.trim();
    if (!data || seen.has(data)) continue;
    seen.add(data);
    out.push({ type: 'text', data });
  }
  return out;
}

export interface EditChartInput {
  postId: number;
  diff: number;
  level: number;
  tags?: readonly PostTextTag[];
}

export type EditChartOutcome =
  | { ok: true }
  | { ok: false; failure: PublishFailure };

/**
 * 已发谱面改元数据（票 51）：`POST /api/post/edit`，body 只有 `{id, diff, level, tags}`。
 * 写路径不套退避（与发帖同口径）。失败映射为 PublishFailure，调用方负责本地不动。
 */
export async function editChartPost(
  deps: { transport: CommunityTransport },
  input: EditChartInput,
): Promise<EditChartOutcome> {
  try {
    const body = {
      id: input.postId,
      diff: input.diff,
      level: input.level,
      tags: normalizePostTags(input.tags),
    };
    const edited = await deps.transport.requestJson({
      url: postEditUrl(),
      method: 'POST',
      headers: { ...bestdoriHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: BESTDORI_JSON_TIMEOUT_MS,
    });
    if (!isPlainObject(edited) || edited.result !== true) {
      throw invalidResponse('改帖响应不是预期形态');
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, failure: publishFailureOf(error) };
  }
}

/**
 * 发布一张谱面（票 11）：预检 →（custom）上传音频 / 封面 → 发帖 → 写上传记录。
 *
 * 任何一个环节失败都不会「半发布」：帖子没发出去就没有记录；帖子发出去而记录写不进去，
 * 结果仍是 `ok`（带 `recordWritten: false`）—— 那意味着平台上已有这一帖，让用户重试
 * 只会多发一帖（ADR-0015 §4：发错只能另发一帖，社区没有作者自助下架）。
 */
export async function publishChart(deps: PublishDeps, input: PublishInput): Promise<PublishOutcome> {
  // 一张谱面至多一条上传记录：已发布过的直接拒，一个字节的网络都不发
  if (input.published) return { ok: false, failure: 'already-published' };

  const precheck = precheckPublish(input);
  // 谱面域规则硬拦（issue 49）：域外值在**任何网络之前**拒绝——custom 渠道尤其不能
  // 先把音频传上去（否则白传一次）。missing 让位：缺字段在弹窗里就地标红、按钮禁用，
  // 走到这里谱面域还不合法时，先报最靠近载荷、且预览阶段看不见的那个因。
  if (precheck.chartIssues.length > 0) {
    return { ok: false, failure: 'chart-invalid', chartIssues: precheck.chartIssues };
  }
  if (!precheck.ok) return { ok: false, failure: 'missing-fields', missing: precheck.missing };

  const chart = sanitizeChartForBestdoriUpload(input.chartCode);

  const t0 = Date.now();
  trail.record({ module: 'community', action: 'upload-start' });
  try {
    // 上传（custom 才有）：音频必需、封面可选（平台不强制 custom 帖带封面）
    let song: PostSongBody;
    if (input.song.kind === 'custom') {
      // 预检已挡下「没有音频」，这里是类型收口（audio 在上面的判定后必非空）
      if (input.song.audio == null) throw invalidResponse('custom 曲目缺少音频引用');
      deps.onStage?.('audio');
      const audioUrl = await uploadBinaryFile(deps.transport, input.song.audio, deps.sleep ?? defaultSleep);
      let coverUrl: string | null = null;
      if (input.song.cover != null) {
        deps.onStage?.('cover');
        coverUrl = await uploadBinaryFile(deps.transport, input.song.cover, deps.sleep ?? defaultSleep);
      }
      song = { type: 'custom', audio: audioUrl, ...(coverUrl != null ? { cover: coverUrl } : {}) };
    } else {
      song = { type: 'bandori', id: input.song.songId };
    }

    deps.onStage?.('post');
    const contentBlocks = formatPostContent(input.content);
    const body = {
      title: input.title,
      artists: input.artists,
      song,
      diff: input.diff,
      level: input.level,
      chart,
      // 正文富文本块（票 42 Q4：纯文本 + 换行拆成 br 块；富文本语法见 bestdori-api.md §5）
      content: contentBlocks,
      categoryName: 'SELF_POST',
      categoryId: 'chart',
      tags: normalizePostTags(input.tags),
    };
    const bodyText = JSON.stringify(body);
    // 载荷统计（issue 49）：发帖前记进 trail，只记统计不记内容（请求体原文不进 trail，
    // 凭据红线同口径）。现场没有这段时，平台拒了（POST_INVALID 不指因）只能像票 49 那样
    // 离线复现载荷逐项排除——width 分布就是那次排查最后才锁定的那格。
    trail.record({
      module: 'community',
      action: 'post-payload',
      meta: {
        bytes: utf8ByteLength(bodyText),
        chartBytes: utf8ByteLength(JSON.stringify(chart)),
        objects: countChartObjects(chart),
        widths: directionalWidthDistribution(chart),
        song: song.type,
        diff: input.diff,
        level: input.level,
        contentBlocks: contentBlocks.length,
      },
    });
    const posted = await deps.transport.requestJson({
      url: postCreateUrl(),
      method: 'POST',
      headers: { ...bestdoriHeaders(), 'content-type': 'application/json' },
      body: bodyText,
      timeoutMs: BESTDORI_BINARY_TIMEOUT_MS,
    });

    // 成功形态 = `{"result":true,"id":<postId>}`；`{result:false,code}` 已被网关翻成错误
    if (!isPlainObject(posted) || posted.result !== true || typeof posted.id !== 'number') {
      throw invalidResponse('发帖响应不是预期形态');
    }
    const postId = posted.id;

    deps.onStage?.('record');
    let recordWritten = false;
    try {
      recordWritten = await deps.writeUploadRecord({ postId, at: (deps.now ?? Date.now)() });
    } catch {
      // 记账失败不推翻「帖子已发」这个事实（见上面的口径）
      recordWritten = false;
    }
    trail.record({
      module: 'community',
      action: 'upload-end',
      result: 'ok',
      durationMs: Date.now() - t0,
    });
    return { ok: true, postId, recordWritten };
  } catch (error) {
    trail.record({
      module: 'community',
      action: 'upload-end',
      result: 'fail',
      durationMs: Date.now() - t0,
    });
    return { ok: false, failure: publishFailureOf(error) };
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** UTF-8 字节数（trail 载荷统计用）：`string.length` 是 UTF-16 码元数，title/content 含中文时会低估真实字节 */
function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 对象分桶（trail 载荷统计用）：type → 数量；脏数据没有字符串 type 归「unknown」桶 */
function countChartObjects(chart: readonly ChartCodeNote[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const note of chart) {
    const type = (note as { type?: unknown }).type;
    const key = typeof type === 'string' && type !== '' ? type : 'unknown';
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
  return buckets;
}

/** Directional width 分布（trail 载荷统计用）：width → 数量——票 49 的根因靠它一眼可见 */
function directionalWidthDistribution(chart: readonly ChartCodeNote[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const note of chart) {
    const raw = note as { type?: unknown; width?: unknown };
    if (raw.type !== 'Directional') continue;
    const key = String(raw.width);
    dist[key] = (dist[key] ?? 0) + 1;
  }
  return dist;
}
