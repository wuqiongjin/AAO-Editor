// 工程音频接缝（票 15 定案 8/9 / ADR-0015 §6）：按 projectId 读写工程记录里的音频与时长。
//
// 为什么不是 AudioSession：session 是「当前工程的播放会话」——它手里握着全站唯一那个共享
// AudioEngine（当前工程解码后的 buffer，也是播放器）。为了改非当前工程的音频去借它 load 一次，
// 会把工作台那份顶掉。所以音频页的写路径收在这里：读记录 → 改记录 → 落盘，作用对象由入参决定，
// 「当前 / 非当前」的差别只剩一条——**目标是当前工程时要先把在飞的编辑落盘**。
//
// 锁（ADR-0015 §4）：UI 禁用是第一道，这里再挡一次——纵深防御，别让"按钮忘了 disable"变成能写。
//
// 另一条 08 补的语义：**换音频即改归属**（Q12）——导入 / 更换时 `曲目来源` 置 `custom`，
// 见 importProjectAudio 的注解。
//
// 33 票（音频资源异常的检测与对齐）补的两族信号与两条修复写路径：
//   - 检测都落在**工作台 hydrate 路径**（丢失 = 半态判定，加载即可判；替换 = 解码后比对时长），
//     工程管理页不解码、不检测；
//   - 对齐口径与「更换音频」一致：修复写把 `durationSeconds` 改为音频实际时长、`source` 置
//     `custom`（音频已不是官方那首，同 06 Q12 理由），因此两条修复**不走锁闸**——
//     修复是记录与字节对齐、不是换音频；已上传谱面发布物不可变且按 song id 引用，本地修复
//     不影响社区。
import type { ChartDifficulty, ChartProject, ChartProjectStore, SongSource } from '../project/ChartProject';
import { mutateProject } from '../project/ChartProjectRecord';
import { isProjectAudioLocked } from '../project/workspaceProject';
import { clampChartDuration } from './chartDuration';
import { probeAudioDuration, type AudioBytesDecoder } from './probeAudioDuration';

/**
 * 替换信号的容差（秒）：hydrate 解码后 `engine.duration` 与记录 `durationSeconds` 差超过它
 * 即判「字节被替换」。沿用 `useChartProjectPersistence` 的现容差——离线探针与播放引擎对
 * 同一文件的秒数可能有极小差异，不设容差会退化成"每次加载都报警"。
 *
 * 已知缺口（33 票明记）：同时长替换 / 重编码检测不到；将来要补，最便宜是记录字节数，
 * 不必上哈希。
 */
export const AUDIO_DURATION_MISMATCH_TOLERANCE = 0.5;

/** 锁定工程音频视图里与「记录有没有音频字节」相关的两个字段（半态判定用） */
type AudioBytesFields = Pick<ChartProject, 'audioName' | 'audioBlob'>;

/**
 * 替换信号：记录时长与音频实际时长差 > 容差。`actualSeconds` 为 null（还没解码 / 无音频）
 * 时不触发——调用方（工作台）在解码完成后才问这一句。
 */
export function audioDurationMismatch(
  recordSeconds: number,
  actualSeconds: number | null,
  tolerance: number = AUDIO_DURATION_MISMATCH_TOLERANCE,
): boolean {
  if (actualSeconds == null) return false;
  return Math.abs(recordSeconds - actualSeconds) > tolerance;
}

/**
 * 丢失信号（半态判定）：记录说"有音频"（`audioName != null`）但手里没有字节
 * （`audioBlob == null`——主进程读 `audio.bin` 失败时的降级形状，见 projectStore.cjs
 * 的 `readBinIfPresent`）。加载即可判，零解码、零 IPC 改动，比替换信号更早。
 */
export function audioBytesLost(project: AudioBytesFields): boolean {
  return project.audioName != null && project.audioBlob == null;
}

/** 锁定原因（点名的已上传谱面）：横幅文案要能说清"为什么锁" */
export interface ProjectAudioLockSource {
  title: string | null;
  diff: ChartDifficulty;
  level: number | null;
}

/**
 * 按 projectId 读到的音频视图；读是全域开放的（包括锁定工程，ADR-0015 §6）。
 * 带 `name`（工程展示名）是因为作用域条要说清"我在管谁"——读的时候顺手带出来，
 * 免得调用方为了一个名字再回 store 跑一趟。
 */
export interface ProjectAudioView {
  projectId: string;
  name: string | null;
  audioName: string | null;
  hasAudio: boolean;
  durationSeconds: number;
  locked: boolean;
  lockedBy: ProjectAudioLockSource[];
  source?: SongSource;
}

export type ProjectAudioWriteResult =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'missing' | 'decode' | 'invalid' };

export interface ProjectAudioDeps {
  store: ChartProjectStore;
  /** 当前工程 id；null = 没有当前工程 */
  currentProjectId: string | null;
  /**
   * 把当前工程在飞的编辑落盘（Editor 注入的 flushPersist）。
   * 目标是当前工程时必须先做：下面的读-改-写会整条记录覆写，不先落盘就盖掉在飞内容。
   */
  flushPersist?: () => Promise<void>;
  /** 通知工程目录 / 详情行刷新（也让当前工程的会话按不变量重新对齐） */
  notifyCatalogChanged: () => void;
  /** 求时长；默认一次性离线探针，测试可注入 */
  probeDuration?: (file: Blob, decode?: AudioBytesDecoder) => Promise<number>;
}

function lockSourcesOf(project: ChartProject): ProjectAudioLockSource[] {
  return project.charts
    .filter((chart) => chart.upload != null)
    .map((chart) => ({ title: chart.title, diff: chart.diff, level: chart.level }));
}

/** 读某个工程的音频视图；工程不存在返回 null（调用方据此走空态 / 回落） */
export async function readProjectAudio(
  store: ChartProjectStore,
  projectId: string,
): Promise<ProjectAudioView | null> {
  const project = await store.get(projectId);
  if (!project) return null;
  return {
    projectId,
    name: project.name,
    audioName: project.audioName,
    hasAudio: project.audioName != null,
    durationSeconds: project.durationSeconds,
    locked: isProjectAudioLocked(project),
    lockedBy: lockSourcesOf(project),
    source: project.source,
  };
}

/** 一次可写读-改-写里「改成什么」：写、跳过（当前值已在位）、解码失败（整笔不写）。 */
type ChangeOutcome =
  | { outcome: 'write'; next: ChartProject }
  | { outcome: 'skip' }
  | { outcome: 'decode-failed' };

/**
 * 一条**可写**的读-改-写：次序（flush → get → fn → save → notify）由 `mutateProject` 统一拥有，
 * 锁判定与解码留在本文件（音频语义）。
 *
 * 次序的两条约束原样保留：
 * - 目标是当前工程时先落盘在飞编辑（否则整条记录覆写会盖掉工作台正在编辑的内容）；
 * - 锁判定在**解码之前**（探针是这条路径上最贵的一步，ADR-0015 §4 的第二道闸要在第一道上就拦住）。
 *
 * `bypassLock`（33 票）：修复类写路径（记录与字节对齐）不走锁闸——音频已被外部换掉 / 删掉时，
 * 「已上传谱面锁定」锁的是"用户主动换音频"这个动作，不是"记录与事实对齐"这个事实。
 */
async function mutateWritable(
  deps: ProjectAudioDeps,
  projectId: string,
  change: (project: ChartProject) => Promise<ChangeOutcome> | ChangeOutcome,
  bypassLock = false,
): Promise<ProjectAudioWriteResult> {
  // 不落盘时的失败原因（锁 / 解码）只有本文件懂，挂在 fn 的取消路径上带出来。
  let aborted: ProjectAudioWriteResult | null = null;
  const result = await mutateProject(
    {
      store: deps.store,
      ...(deps.currentProjectId === projectId && deps.flushPersist ? { flush: deps.flushPersist } : {}),
      notify: deps.notifyCatalogChanged,
    },
    projectId,
    async (project) => {
      if (!bypassLock && isProjectAudioLocked(project)) {
        aborted = { ok: false, reason: 'locked' };
        return null;
      }
      const outcome = await change(project);
      if (outcome.outcome === 'decode-failed') {
        aborted = { ok: false, reason: 'decode' };
        return null;
      }
      return outcome.outcome === 'write' ? outcome.next : null;
    },
  );
  if (aborted != null) return aborted;
  if (result.status === 'missing') return { ok: false, reason: 'missing' };
  return { ok: true };
}

/**
 * 探一次音频时长并夹到工程时长口径 —— **「音频 → 工程时长」的唯一算法**（探针 + `clampChartDuration`）。
 * 换音频、建官方曲工程（票 08）都走它，免得夹取在调用点各长一份（tests/static/ChartDurationWiring 盯着）。
 */
export async function probeProjectDuration(
  file: Blob,
  probe: (file: Blob, decode?: AudioBytesDecoder) => Promise<number> = probeAudioDuration,
): Promise<number> {
  return clampChartDuration(await probe(file));
}

/**
 * 导入 / 更换音频：时长先探出来（探不到就不写，不留"有音频但时长是旧的"这种半截态）。
 *
 * **换音频即改归属**（bestdori-integration 06 Q12 / 08）：音频一旦被用户换掉，它就不再是
 * 官方 / LLSIF 那首歌的音频了，`曲目来源` 一并回 `custom` —— 否则发布时会把别人曲子的
 * 音频按官方曲 id 填进 `song`。改回官方 / LLSIF 的出路还在「编辑工程信息」里，不封死。
 */
export async function importProjectAudio(
  deps: ProjectAudioDeps,
  projectId: string,
  file: File,
): Promise<ProjectAudioWriteResult> {
  return mutateWritable(deps, projectId, async (project) => {
    let duration: number;
    try {
      duration = await probeProjectDuration(file, deps.probeDuration);
    } catch {
      return { outcome: 'decode-failed' };
    }
    return {
      outcome: 'write',
      next: {
        ...project,
        audioName: file.name,
        audioBlob: file,
        source: { type: 'custom' },
        // 有音频 = 音频时长（ADR-0005 §4 / 票 15 定案 1）
        durationSeconds: duration,
      },
    };
  });
}

/**
 * 替换修复（33 票）：把工程记录对齐到磁盘上**实际那份**音频——时长 ← 入参（音频实际时长）、
 * `曲目来源` ← `custom`（同 importProjectAudio 的 Q12 理由：音频已不是官方那首），
 * `audioName` 不动（外部替换拿不到新文件名；纯展示字段，横幅文案说明音频已变——
 * 与 import 路径唯一的刻意分歧）。
 *
 * **不走锁闸**（与 importProjectAudio 的锁闸刻意相反，33 票定案）：这是记录与字节对齐，
 * 不是换音频；已上传谱面发布物不可变且按 song id 引用，本地修复不影响社区。
 */
export async function realignProjectAudio(
  deps: ProjectAudioDeps,
  projectId: string,
  seconds: number,
): Promise<ProjectAudioWriteResult> {
  if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: 'invalid' };
  return mutateWritable(deps, projectId, (project) => {
    // 没有音频名 = 记录本就无音频（并发清除已先行落地）：无从对齐，整笔不写。
    if (project.audioName == null) return { outcome: 'skip' };
    return {
      outcome: 'write',
      next: {
        ...project,
        durationSeconds: clampChartDuration(seconds),
        source: { type: 'custom' },
      },
    };
  }, true);
}

/**
 * 清除音频：时长保留当前值（与 session.clearAudio 同口径——时长是独立字段，不跟着归零）；
 * 曲目来源变更为自定义。
 *
 * `force`（33 票）：横幅的「清除音频记录」传 true 绕过锁闸——半态工程（记录说有音频、
 * 字节已丢）不清除就会永远卡在"幽灵音频"上，锁闸锁的是主动换音频，不是清理坏记录。
 * 音频页不传（UI 禁用不变）。
 */
export async function clearProjectAudio(
  deps: ProjectAudioDeps,
  projectId: string,
  force = false,
): Promise<ProjectAudioWriteResult> {
  return mutateWritable(deps, projectId, (project) => {
    if (project.audioName == null && project.audioBlob == null) return { outcome: 'skip' };
    const next: ChartProject = {
      ...project,
      audioName: null,
      source: { type: 'custom' },
    };
    delete next.audioBlob;
    return { outcome: 'write', next };
  }, force);
}

/** 手改谱面时长（只在无音频时有意义：有音频时时长跟随音频，与 session 的口径一致） */
export async function setProjectAudioDuration(
  deps: ProjectAudioDeps,
  projectId: string,
  seconds: number,
): Promise<ProjectAudioWriteResult> {
  if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: 'invalid' };
  return mutateWritable(deps, projectId, (project) => {
    if (project.audioName != null) return { outcome: 'skip' };
    const clamped = clampChartDuration(seconds);
    if (project.durationSeconds === clamped) return { outcome: 'skip' };
    return { outcome: 'write', next: { ...project, durationSeconds: clamped } };
  });
}
