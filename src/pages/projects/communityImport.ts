/**
 * 「从社区谱面导入」的编排（票 09）：素材缓存 → 谱面原文 → Apply 闸门 → 建工程 → 落盘。
 *
 * 与官方导入（officialImport.ts）同构，四处不同：
 *   1. **谱面默认是主线**：勾着「同步导入谱面」时帖子详情（`post.chart`）取不到就整笔不建 ——
 *      没有「降级成空白谱」这回事（票 26 的降级矩阵是官方导入的：那里谱面是可选项）；
 *      关掉同步导入 = 只建工程 + 音频 + 封面，产出与官方「没勾 B」一致（空 Expert、等级不预填），
 *      并且**连详情都不请求**；
 *   2. **曲目按帖子 `song.type`**：bandori 帖走官方素材那条路（曲库候选 + 歌曲元数据 +
 *      官方音频 / 封面，见 songs.ts），custom 帖按帖内 URL 下载音频与封面、曲目来源记 custom；
 *   3. **工程名称 / 歌手预填**（票 34 预填、票 36 修订名称口径）：工程名一律取**原帖标题**
 *      （bandori 帖标题缺省时退回官方曲名），歌手 = bandori 帖官方乐队名 / custom 帖帖子自报歌手；
 *      谱师署名仍只在导入会话里展示，不落进工程；
 *   4. **等级跟着帖子走，但只在带谱面时**：不导谱面还预填等级 = 给一张空谱挂个属于别人作品的等级。
 *
 * 落盘走 `store.save(project, staged)`：素材缓存路径交给主进程拷进工程目录，字节不过 IPC。
 */
import { probeProjectDuration } from '../../audio/projectAudio';
import type { AudioBytesDecoder } from '../../audio/probeAudioDuration';
import { formatValidationError, type ValidationError } from '../../chart/editing/ChartConverter';
import type { OfficialSongDetail, PostCandidate, SongCandidate } from '../../community/bestdori/mapping';
import {
  customAudioName,
  customCoverName,
  fetchCustomAudio,
  fetchCustomCover,
  fetchPostDetail,
} from '../../community/bestdori/posts';
import {
  audioFileName,
  coverFileName,
  fetchOfficialAudio,
  fetchOfficialCover,
} from '../../community/bestdori/songs';
import { isCommunityError, type CommunityErrorKind } from '../../community/transport';
import type { CommunityTransport } from '../../community/transport';
import { t, type MessageKey } from '../../i18n';
import { throwIfImportAborted } from './officialImport';
import {
  newChartId,
  newProjectId,
  type ChartDifficulty,
  type ChartProject,
  type ProjectBinarySources,
} from '../../project/ChartProject';
import { createOfficialProject } from '../../project/projectCatalog';

/** custom 帖没有官方曲长可依：先按「无音频默认时长」起，落盘后由实际音频校正 */
const CUSTOM_DURATION_PLACEHOLDER_SECONDS = 30;

/** 不导帖子谱面时的默认难度：Expert（与官方「没勾 B」的产出同口径） */
const DEFAULT_DIFF: ChartDifficulty = 3;

/** 时长校正的容差（秒）：与 officialImport / useChartProjectPersistence 对齐 */
const DURATION_TOLERANCE_SECONDS = 0.5;

/** 导入阶段（弹窗据此出提示文案；网关没有字节级进度） */
export type CommunityImportStage = 'audio' | 'cover' | 'chart' | 'save';

export interface CommunityImportInput {
  post: PostCandidate;
  /** bandori 帖必带：选中时面板已取好的曲库候选与歌曲元数据（素材 / 曲长都靠它们） */
  song?: SongCandidate;
  detail?: OfficialSongDetail;
  /**
   * 是否把帖子里的谱面代码 Apply 进工程（预览栏那颗「同步导入谱面」芯片，**默认开**）。
   * 关掉 = 只建工程 + 音频 + 封面：空 Expert 谱面、难度等级都不预填（与官方「没勾 B」同口径）。
   */
  withChart: boolean;
}

export interface CommunityImportStore {
  save(project: ChartProject, staged?: ProjectBinarySources): Promise<void>;
  get(id: string): Promise<ChartProject | null>;
}

export interface CommunityImportDeps {
  store: CommunityImportStore;
  transport: CommunityTransport;
  /** 落盘成功后通知工程目录 / 详情行刷新 */
  notifyCatalogChanged: () => void;
  onStage?: (stage: CommunityImportStage) => void;
  /** 新 id / 时刻（测试注入固定值） */
  newIds?: () => { projectId: string; chartId: string };
  now?: () => number;
  /** 探音频时长（默认离线探针；测试注入） */
  probeDuration?: (file: Blob, decode?: AudioBytesDecoder) => Promise<number>;
  /** 票 45：关窗 / 取消 = 不建工程 */
  signal?: AbortSignal;
}

export type CommunityImportResult =
  | { ok: true; project: ChartProject; chartId: string; coverImported: boolean }
  | { ok: false; reason: 'apply'; errors: ValidationError[] }
  | { ok: false; reason: 'download'; error: unknown }
  | { ok: false; reason: 'cancelled' };

export async function importCommunityPost(
  deps: CommunityImportDeps,
  input: CommunityImportInput,
): Promise<CommunityImportResult> {
  const { post } = input;
  const ids = deps.newIds?.() ?? { projectId: newProjectId(), chartId: newChartId() };
  const now = deps.now?.() ?? Date.now();
  const staged: ProjectBinarySources = {};

  // bandori 帖的素材从官方那条路走：曲库候选 + 歌曲元数据由面板选中时取好带进来。
  // 缺了就是编排 misuse（面板的「创建」等它到位才亮），当下载失败域抛出去。
  let song: SongCandidate | null = null;
  let songDetail: OfficialSongDetail | null = null;
  if (post.song.kind === 'bandori') {
    if (input.song == null || input.detail == null) {
      throw new Error(`帖子 ${post.postId} 是官方曲帖，但缺少曲库候选或歌曲元数据`);
    }
    song = input.song;
    songDetail = input.detail;
  }

  throwIfImportAborted(deps.signal);
  deps.onStage?.('audio');
  let audioName: string;
  if (song && songDetail) {
    const audio = await fetchOfficialAudio(deps.transport, song, songDetail);
    staged.audioStagedPath = audio.path;
    audioName = audioFileName(song);
  } else {
    const audio = await fetchCustomAudio(deps.transport, post);
    staged.audioStagedPath = audio.path;
    audioName = customAudioName(post);
  }

  throwIfImportAborted(deps.signal);
  deps.onStage?.('cover');
  let cover: { path: string; name: string } | null = null;
  if (song) {
    const stagedCover = await fetchOfficialCover(deps.transport, song);
    if (stagedCover) cover = { path: stagedCover.path, name: coverFileName(song) };
  } else {
    const stagedCover = await fetchCustomCover(deps.transport, post);
    if (stagedCover) cover = { path: stagedCover.path, name: customCoverName(post) };
  }

  // 谱面原文：帖子的本体。**默认（勾着同步导入）取不到就整笔不建**（没有「空白谱降级」这条支线）；
  // 用户主动关掉同步导入时不请求详情 —— 少一次网络，产出也回到官方「没勾 B」的形状。
  let chartCodeText = '';
  if (input.withChart) {
    throwIfImportAborted(deps.signal);
    deps.onStage?.('chart');
    const detail = await fetchPostDetail(deps.transport, post.postId);
    chartCodeText = detail.chartCodeText;
  }

  // 工程名称 / 歌手预填（票 34 预填、票 36 修订名称口径）：**工程名 = 帖标题**（谱师对这只谱的
  // 命名，bandori 与 custom 两支一样 —— 官方曲的社区谱一般也会自己起名，如「BLACK SHOUT 谱师版」）；
  // bandori 帖标题缺省时退回官方曲名（空名不如歌名有用）。歌手 = bandori 帖官方乐队名 / custom 帖
  // 帖子自报歌手。空串由 createOfficialProject 归一成 null。谱师署名仍只在导入会话里展示，不落盘。
  // 带谱面时难度等级跟帖子走。
  const built = createOfficialProject({
    id: ids.projectId,
    chartId: ids.chartId,
    now,
    name: post.title.trim() !== '' ? post.title : (song?.title ?? ''),
    artist: song && songDetail ? song.artist : post.artists,
    source: post.song.kind === 'bandori' ? { type: 'bandori', id: post.song.songId } : { type: 'custom' },
    durationSeconds: songDetail?.lengthSeconds ?? CUSTOM_DURATION_PLACEHOLDER_SECONDS,
    diff: input.withChart ? (post.diff as ChartDifficulty) : DEFAULT_DIFF,
    level: input.withChart ? post.level : null,
    chartCodeText,
    audioName,
    coverName: cover?.name ?? null,
  });
  if (!built.ok) return { ok: false, reason: 'apply', errors: built.errors };

  throwIfImportAborted(deps.signal);
  deps.onStage?.('save');
  await deps.store.save(built.project, { ...staged, ...(cover ? { coverStagedPath: cover.path } : {}) });

  // 音频刚落地：把时长校正成实际音频的（探不到就留初值）
  const saved = await deps.store.get(built.project.id);
  if (saved?.audioBlob) {
    try {
      const seconds = await probeProjectDuration(saved.audioBlob, deps.probeDuration);
      if (Math.abs(seconds - saved.durationSeconds) > DURATION_TOLERANCE_SECONDS) {
        await deps.store.save({ ...saved, durationSeconds: seconds });
      }
    } catch {
      // 探针失败：初值就是最终值
    }
  }

  deps.notifyCatalogChanged();
  return { ok: true, project: built.project, chartId: built.chart.id, coverImported: cover != null };
}

/**
 * 失败文案：按统一错误域的 kind 走 i18n（message 只作诊断）。
 * 错误域那几句是「从社区谱面导入」这一支自己的（不借官方那组的词）；
 * 「同步导入谱面」那颗中性控件沿用官方支的键（见 CommunityPostPanel，不重复造两份同义键）。
 */
const KIND_MESSAGE_KEYS: Partial<Record<CommunityErrorKind, MessageKey>> = {
  offline: 'projects.community.err.offline',
  timeout: 'projects.community.err.offline',
  'rate-limited': 'projects.community.err.rateLimited',
  'unsupported-runtime': 'projects.community.err.desktopOnly',
  'staging-failed': 'projects.community.err.staging',
};

export function communityErrorText(error: unknown): string {
  if (isCommunityError(error)) {
    const key = KIND_MESSAGE_KEYS[error.kind];
    if (key) return t(key);
  }
  return t('projects.community.err.generic');
}

/** Apply 闸门拒绝时的文案（与另两支同口径：点名第一个错） */
export function communityApplyErrorText(errors: ValidationError[]): string {
  const first = errors[0];
  return t('projects.community.err.apply', { message: first ? formatValidationError(first) : 'invalid' });
}
