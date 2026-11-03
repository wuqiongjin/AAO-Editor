/**
 * 谱面导入的唯一序列（票 08 / 09 / 26 的共同骨架，架构评审 2026-11-03 候选 1）。
 *
 * 这条序列此前在 `officialImport.ts` 与 `communityImport.ts` 各写一份：
 *   trail → ids / now / staged → audio → cover → chart（可选）→ Apply → save → probe → notify
 * 源差异（官方素材 / 社区帖素材、谱面可降级 / 必达、工程元数据）全部留在源适配器；
 * 本模块只拥有顺序、abort 检查点、Apply 闸门与落盘后的时长校正。
 *
 * 行为等价红线（票 11 定案）：每个 abort 检查点、stage 发射时机、Apply 失败返回、
 * 探针失败留初值、二次落盘不重发 stage / notify 都与原两份实现逐条一致。
 */
import { probeProjectDuration } from '../../audio/projectAudio';
import type { AudioBytesDecoder } from '../../audio/probeAudioDuration';
import type { ValidationError } from '../../chart/editing/ChartConverter';
import { trail } from '../../diagnostics/trail';
import {
  newChartId,
  newProjectId,
  type ChartDifficulty,
  type ChartProject,
  type ProjectBinarySources,
  type SongSource,
} from '../../project/ChartProject';
import { createOfficialProject } from '../../project/projectCatalog';

/** 导入来源（只用于 trail 的 meta.kind；文案由界面层按来源区分） */
export type ImportKind = 'official' | 'community';

/** 导入阶段（弹窗据此出提示文案；网关是一次性请求，没有字节级进度） */
export type ImportStage = 'audio' | 'cover' | 'chart' | 'save';

/** 源适配器交出的一份暂存素材：缓存路径 + 落进工程后记的名字 */
export interface ImportAsset {
  path: string;
  name: string;
}

/** 谱面原文与它是否走了官方那支的「网络失败降级」 */
export interface ImportChartOutcome {
  codeText: string;
  degraded: boolean;
}

/**
 * 工程元数据里**由来源决定**的那部分。
 * id / chartId / now / chartCodeText / audioName / coverName 归 core 所有，适配器不得碰。
 */
export interface ImportProjectMeta {
  name: string;
  artist: string | null;
  source: SongSource;
  durationSeconds: number;
  diff: ChartDifficulty;
  level: number | null;
}

/**
 * 一个谱面来源（端口）。
 *
 * - `validate` 是可选的输入 misuse 校验：core 在 ids/now/staged 之后、abort / stage audio 之前调用，
 *   保持社区 bandori 帖缺曲库候选时「先抛 misuse、不发 stage」的原时序。
 * - `chart` 只在 `input.withChart` 时被调用；官方那支的网络失败降级在适配器内部完成。
 * - `projectMeta` 是同步的：它只读 source 自己的数据与已落定的 chart 结果。
 */
export interface ChartImportSource<Input extends { withChart: boolean }> {
  readonly kind: ImportKind;
  validate?(input: Input): void;
  audio(input: Input): Promise<ImportAsset>;
  cover(input: Input): Promise<ImportAsset | null>;
  chart(input: Input): Promise<ImportChartOutcome>;
  projectMeta(input: Input, chart: { degraded: boolean } | null): ImportProjectMeta;
}

export interface ImportStore {
  save(project: ChartProject, staged?: ProjectBinarySources): Promise<void>;
  get(id: string): Promise<ChartProject | null>;
}

/** 与来源无关的依赖；transport 由源工厂自己闭包，core 不知道社区出口 */
export interface ImportDeps {
  store: ImportStore;
  /** 落盘成功后通知工程目录 / 详情行刷新 */
  notifyCatalogChanged: () => void;
  onStage?: (stage: ImportStage) => void;
  /** 新 id / 时刻（测试注入固定值） */
  newIds?: () => { projectId: string; chartId: string };
  now?: () => number;
  /** 探音频时长（默认离线探针；测试注入） */
  probeDuration?: (file: Blob, decode?: AudioBytesDecoder) => Promise<number>;
  /** 票 45：关窗 / 取消 = 不建工程 */
  signal?: AbortSignal;
}

export type ImportResult =
  | {
    ok: true;
    project: ChartProject;
    chartId: string;
    coverImported: boolean;
    /** 官方谱面网络失败降级；社区恒 false */
    chartDegraded: boolean;
  }
  | { ok: false; reason: 'apply'; errors: ValidationError[] }
  | { ok: false; reason: 'download'; error: unknown }
  | { ok: false; reason: 'cancelled' };

/** 时长校正的容差（秒）：与 useChartProjectPersistence 对齐 —— 毫秒级差异不值得再写一次盘 */
const DURATION_TOLERANCE_SECONDS = 0.5;

export function isImportCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function throwIfImportAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('import-cancelled');
  error.name = 'AbortError';
  throw error;
}

/**
 * 跑完一次谱面导入。两个来源只提供素材 / 谱面原文 / 工程元数据；
 * 顺序、取消、Apply 与落盘后校正都在这里。
 */
export async function importChart<Input extends { withChart: boolean }>(
  source: ChartImportSource<Input>,
  deps: ImportDeps,
  input: Input,
): Promise<ImportResult> {
  const started = Date.now();
  trail.record({ module: 'chart', action: 'import-start', meta: { kind: source.kind } });
  try {
    const result = await runChartImport(source, deps, input);
    const outcome = result.ok ? 'ok' : result.reason === 'cancelled' ? 'cancel' : 'fail';
    trail.record({
      module: 'chart',
      action: 'import-end',
      result: outcome,
      durationMs: Date.now() - started,
      meta: { kind: source.kind },
    });
    return result;
  } catch (err) {
    trail.record({
      module: 'chart',
      action: 'import-end',
      result: isImportCancelled(err) ? 'cancel' : 'fail',
      durationMs: Date.now() - started,
      meta: { kind: source.kind },
    });
    throw err;
  }
}

async function runChartImport<Input extends { withChart: boolean }>(
  source: ChartImportSource<Input>,
  deps: ImportDeps,
  input: Input,
): Promise<ImportResult> {
  const ids = deps.newIds?.() ?? { projectId: newProjectId(), chartId: newChartId() };
  const now = deps.now?.() ?? Date.now();
  const staged: ProjectBinarySources = {};

  // 源自己的 misuse 判定先于 abort / stage：与旧社区编排的抛错时机一致。
  source.validate?.(input);

  throwIfImportAborted(deps.signal);
  deps.onStage?.('audio');
  const audio = await source.audio(input);
  staged.audioStagedPath = audio.path;

  throwIfImportAborted(deps.signal);
  deps.onStage?.('cover');
  const cover = await source.cover(input);
  if (cover) staged.coverStagedPath = cover.path;

  let chart: ImportChartOutcome | null = null;
  if (input.withChart) {
    throwIfImportAborted(deps.signal);
    deps.onStage?.('chart');
    chart = await source.chart(input);
  }

  const meta = source.projectMeta(input, chart == null ? null : { degraded: chart.degraded });
  const built = createOfficialProject({
    id: ids.projectId,
    chartId: ids.chartId,
    now,
    ...meta,
    chartCodeText: chart?.codeText ?? '',
    audioName: audio.name,
    coverName: cover?.name ?? null,
  });
  if (!built.ok) return { ok: false, reason: 'apply', errors: built.errors };

  throwIfImportAborted(deps.signal);
  deps.onStage?.('save');
  await deps.store.save(built.project, staged);

  // 音频刚落地：把初值校正成**实际音频**时长（ADR-0005 §4「有音频 = 音频时长」）。
  // 探不到就留初值 —— 创建不该因为一次探针失败而回退。
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
  return {
    ok: true,
    project: built.project,
    chartId: built.chart.id,
    coverImported: cover != null,
    chartDegraded: chart?.degraded ?? false,
  };
}
