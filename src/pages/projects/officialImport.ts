/**
 * 「从官方谱面导入」的编排（票 08 + 14）：素材缓存 → 建工程 → 落盘。
 *
 * 三件事按顺序做，且**二进制走素材缓存**（票 14：命中即零网络；未命中由网关下载并留在
 * `<数据根>/cache/community/`，决定导入才写进工程）：
 *   1. 官方音频（主线，约 4MB，走主进程网关）；
 *   2. 官方封面（可选：平台没有这张图就不带封面，不挡主线）；
 *   3. 官方谱面代码（可选，默认关）：原文交给 Apply 闸门，过不了就**整笔不建**。
 *
 * 落盘走 `store.save(project, { audioStagedPath, coverStagedPath })`：缓存路径交给主进程拷进
 * 工程目录，字节不过 IPC（07 定案）。落盘后 `get()` 一次把字节顶回内存（否则下一次保存会
 * 以为「手里没有音频」，见 ChartProject 的 STAGED_ON_DISK），并顺手按**实际音频**校正时长。
 */
import { probeProjectDuration } from '../../audio/projectAudio';
import type { AudioBytesDecoder } from '../../audio/probeAudioDuration';
import { formatValidationError, type ValidationError } from '../../chart/editing/ChartConverter';
import { officialDiffIndex, type OfficialDifficulty } from '../../community/bestdori/endpoints';
import { songLevel, type OfficialSongDetail, type SongCandidate } from '../../community/bestdori/mapping';
import {
  audioFileName,
  coverFileName,
  fetchOfficialAudio,
  fetchOfficialChartText,
  fetchOfficialCover,
} from '../../community/bestdori/songs';
import { isCommunityError, type CommunityErrorKind } from '../../community/transport';
import type { CommunityTransport } from '../../community/transport';
import { t, type MessageKey } from '../../i18n';
import {
  newChartId,
  newProjectId,
  type ChartDifficulty,
  type ChartProject,
  type ProjectBinarySources,
} from '../../project/ChartProject';
import { createOfficialProject } from '../../project/projectCatalog';

/** 不勾「带官方谱面」时的默认难度：Expert（票 08 定案：默认产出 = 一张空 Expert 谱面） */
const DEFAULT_DIFF: ChartDifficulty = 3;

/** 时长校正的容差（秒）：与 useChartProjectPersistence 对齐 —— 毫秒级差异不值得再写一次盘 */
const DURATION_TOLERANCE_SECONDS = 0.5;

/** 导入阶段（弹窗据此出提示文案；网关是一次性请求，没有字节级进度） */
export type OfficialImportStage = 'audio' | 'cover' | 'chart' | 'save';

export interface OfficialImportInput {
  song: SongCandidate;
  detail: OfficialSongDetail;
  /** 是否把官方谱面内容一起 Apply 进这张谱面（B 选项，默认关） */
  withChart: boolean;
  /** 勾了 B 时的官方难度；不勾时忽略（产出 Expert） */
  diff: OfficialDifficulty;
}

export interface OfficialImportStore {
  save(project: ChartProject, staged?: ProjectBinarySources): Promise<void>;
  get(id: string): Promise<ChartProject | null>;
}

export interface OfficialImportDeps {
  store: OfficialImportStore;
  transport: CommunityTransport;
  /** 落盘成功后通知工程目录 / 详情行刷新 */
  notifyCatalogChanged: () => void;
  onStage?: (stage: OfficialImportStage) => void;
  /** 新 id / 时刻（测试注入固定值） */
  newIds?: () => { projectId: string; chartId: string };
  now?: () => number;
  /** 探音频时长（默认离线探针；测试注入） */
  probeDuration?: (file: Blob, decode?: AudioBytesDecoder) => Promise<number>;
}

export type OfficialImportResult =
  | { ok: true; project: ChartProject; chartId: string; coverImported: boolean }
  | { ok: false; reason: 'apply'; errors: ValidationError[] }
  | { ok: false; reason: 'download'; error: unknown };

export async function importOfficialSong(
  deps: OfficialImportDeps,
  input: OfficialImportInput,
): Promise<OfficialImportResult> {
  const { song, detail } = input;
  const ids = deps.newIds?.() ?? { projectId: newProjectId(), chartId: newChartId() };
  const now = deps.now?.() ?? Date.now();
  const staged: ProjectBinarySources = {};

  deps.onStage?.('audio');
  const audio = await fetchOfficialAudio(deps.transport, song, detail);
  staged.audioStagedPath = audio.path;

  deps.onStage?.('cover');
  const cover = await fetchOfficialCover(deps.transport, song);
  if (cover) staged.coverStagedPath = cover.path;

  let chartCodeText = '';
  if (input.withChart) {
    deps.onStage?.('chart');
    chartCodeText = await fetchOfficialChartText(deps.transport, song.id, input.diff);
  }

  const built = createOfficialProject({
    id: ids.projectId,
    chartId: ids.chartId,
    now,
    name: song.title,
    artist: song.artist === '' ? null : song.artist,
    source: { type: 'bandori', id: song.id },
    durationSeconds: detail.lengthSeconds,
    // 官方难度编号与工程难度同值（endpoints.officialDiffIndex 只此一张表）
    diff: input.withChart ? (officialDiffIndex(input.diff) as ChartDifficulty) : DEFAULT_DIFF,
    // 等级是作品属性：不勾 B 就不预填（人还没作谱）
    level: input.withChart ? songLevel(song, input.diff) : null,
    chartCodeText,
    audioName: audioFileName(detail),
    coverName: cover ? coverFileName(song) : null,
  });
  if (!built.ok) return { ok: false, reason: 'apply', errors: built.errors };

  deps.onStage?.('save');
  await deps.store.save(built.project, staged);

  // 音频刚落地：把官方 length 校正成**实际音频**时长（ADR-0005 §4「有音频 = 音频时长」）。
  // 探不到就留着官方值 —— 创建不该因为一次探针失败而回退。
  const saved = await deps.store.get(built.project.id);
  if (saved?.audioBlob) {
    try {
      const seconds = await probeProjectDuration(saved.audioBlob, deps.probeDuration);
      if (Math.abs(seconds - saved.durationSeconds) > DURATION_TOLERANCE_SECONDS) {
        await deps.store.save({ ...saved, durationSeconds: seconds });
      }
    } catch {
      // 探针失败：官方 length 就是最终值
    }
  }

  deps.notifyCatalogChanged();
  return { ok: true, project: built.project, chartId: built.chart.id, coverImported: cover != null };
}

/**
 * 失败文案：按统一错误域的 kind 走 i18n（票 07 口径：message 只作诊断，不当界面文案）。
 * 界面文案键是**导入口这一处**的，不写进能力层。
 */
const KIND_MESSAGE_KEYS: Partial<Record<CommunityErrorKind, MessageKey>> = {
  // 超时与离线在 KIND_TRAITS 里同属「连不上」，用户侧看不出区别，共用一句
  offline: 'projects.official.err.offline',
  timeout: 'projects.official.err.offline',
  'rate-limited': 'projects.official.err.rateLimited',
  'unsupported-runtime': 'projects.official.err.desktopOnly',
  // 本机写不进去（磁盘满 / 权限）不是网络问题，别混进「读取失败」
  'staging-failed': 'projects.official.err.staging',
};

export function officialErrorText(error: unknown): string {
  if (isCommunityError(error)) {
    const key = KIND_MESSAGE_KEYS[error.kind];
    if (key) return t(key);
  }
  return t('projects.official.err.generic');
}

/** Apply 闸门拒绝时的文案（与「新增谱面」那条路同口径：点名第一个错） */
export function officialApplyErrorText(errors: ValidationError[]): string {
  const first = errors[0];
  return t('projects.official.err.apply', { message: first ? formatValidationError(first) : 'invalid' });
}
